/**
 * /admin — 2FA-gated operator dashboard.
 *
 *   GET  /admin                     → enrollment (first run), TOTP gate, or dashboard
 *   POST /admin/verify              → { code } → mint session cookie
 *   POST /admin/logout              → drop the session
 *   GET  /admin/api/stats           → lanes, warnings, users, lockouts, denials
 *   POST /admin/api/unlock          → { ip } → lift an IP lockout
 *   POST /admin/api/denials/clear   → reset the denial log
 *   GET  /admin/api/devices         → approved + pending devices
 *   POST /admin/api/devices/approve → approve (or rotate the key of) a device
 *   POST /admin/api/devices/revoke  → revoke a device
 *
 * The surface is always mounted: a TOTP secret is auto-provisioned when the
 * operator hasn't supplied one, so "I can't get into /admin, so I can't approve
 * anything" is no longer a reachable state.
 */
import express from "express";

import * as store from "../security/store.js";
import {
  verifyTotp,
  verifyPassword,
  adminPasswordMode,
  issueSession,
  clearSession,
  hasValidSession,
  provisioningUri,
  adminOwner,
} from "../security/admin-session.js";
import { adminSecret, isEnrolled } from "../security/admin-secret.js";
import * as users from "../security/users.js";
import * as deviceLogins from "../security/device-logins.js";
import { mountManageApi } from "./admin/manage-api.js";
import { mountAccountsApi } from "./admin/accounts-api.js";
import { mountClientLogsApi } from "./admin/client-logs-api.js";
import { mountHomebrewApi } from "./admin/homebrew-api.js";
import { adminActor, mayAdminister } from "../security/admin-actor.js";
import { forbiddenPage } from "./admin/forbidden-page.js";
import { mountUploadApi } from "./admin/upload-api.js";
import { mountTwoFactorApi } from "./admin/two-factor-api.js";
import {
  normalizeDeviceKey,
  generateAccessKey,
  hashAccessKey,
  stageAccessKeyDelivery,
} from "../security/pairing.js";
import { devicePairing } from "../helpers/envs.js";
import { authLanes, configWarnings } from "../security/config-health.js";
import { hintFor } from "../security/deny-reasons.js";
import { recordDeny, clientIp, DENY } from "../security/deny.js";
import { recordFailure } from "../security/auth-guard.js";
import { isLoopbackIp } from "../security/net.js";
import { trustLoopback } from "../security/limits.js";
import { isPrivateIp } from "../security/net.js";
import { gatePage } from "./admin/gate-page.js";
import { enrollPage } from "./admin/enroll-page.js";
import { dashboardPage } from "./admin/dashboard-page.js";
import debug from "../debug.js";
import { readPairLink, deviceCode, normalizeDeviceCode } from "../security/pairing-link.js";
import { approvePairLink } from "../security/pairing-approve.js";
import { pairPage } from "./admin/pair-page.js";
import { resolveOrigin } from "../helpers/origin.js";
import { publicBaseUrl } from "../helpers/envs.js";

const DENIAL_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * What the admin page's own check takes: "code" (authenticator only),
 * "password" (admin password only), or "either" (one of the two).
 */
function loginMode() {
  if (!adminPasswordMode()) return "code";
  return isEnrolled() ? "either" : "password";
}

/** Session check that also leaves a trail when it fails. */
function requireSession(req, res) {
  if (hasValidSession(req)) return true;
  recordDeny(req, { reason: DENY.ADMIN_NO_SESSION, status: 401 });
  res.status(401).json({ error: "2fa required" });
  return false;
}

function buildUserRows() {
  const access = store.accessSnapshot();
  const byUser = new Map(access.map((a) => [a.user, a]));
  // Configured users first (so never-seen accounts still show), then any
  // historical user that has since been removed.
  const rows = users.list().map(({ name: user, enabled, role }) => {
    const a = byUser.get(user);
    byUser.delete(user);
    return {
      user,
      configured: true,
      enabled,
      role,
      lastAt: a?.lastAt ?? null,
      firstAt: a?.firstAt ?? null,
      count: a?.count ?? 0,
      lastIp: a?.lastIp ?? null,
      ips: a?.ips ?? [],
    };
  });
  const historical = Array.from(byUser.values()).map((a) => ({ ...a, configured: false }));
  return { users: [...rows, ...historical], access };
}

/** The waiting console whose code this is, or null. */
function pendingKeyForCode(raw) {
  const code = normalizeDeviceCode(raw);
  if (!code) return null;
  return store.devicesSnapshot().pending.find((p) => deviceCode(p.deviceKey) === code)?.deviceKey ?? null;
}

export default function adminPageRouter() {
  const router = express.Router();
  router.use(express.json());
  // Admin accounts only; a regular account is told to sign in as an admin.
  router.use((req, res, next) => {
    if (mayAdminister(req)) return next();
    recordDeny(req, { reason: DENY.ADMIN_NO_SESSION, status: 403 });
    res.set("Cache-Control", "no-store");
    if (req.path.startsWith("/api/")) return res.status(403).json({ error: "admin accounts only" });
    res.status(403).type("html").send(forbiddenPage());
  });

  router.get("/pair/:token", (req, res) => {
    res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY" });
    if (!devicePairing) return res.status(404).send("not found");
    const link = readPairLink(req.params.token);
    if (!link) return res.status(410).type("html").send(pairPage({ expired: true }));
    res.type("html").send(pairPage({
      code: link.code,
      authenticated: hasValidSession(req),
      approved: link.used || store.isDeviceApproved(link.deviceKey),
    }));
  });

  router.post("/api/pair/:token/approve", (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!devicePairing) return res.status(404).send("not found");
    if (!requireSession(req, res)) return;
    const origin = req.get("Origin");
    if (origin && origin !== resolveOrigin(req, publicBaseUrl))
      return res.status(403).json({ error: "origin mismatch" });
    const result = approvePairLink(req.params.token, { label: req.body?.label, addedBy: "admin" });
    if (result === "expired") return res.status(410).json({ error: "pair link expired" });
    if (result === "used") return res.status(409).json({ error: "pair link already approved" });
    res.json({ ok: true });
  });

  router.get("/", async (req, res) => {
    if (hasValidSession(req)) {
      res.type("html").send(dashboardPage());
      return;
    }
    // First run: the operator has never proven they hold the generated secret.
    // Show it — but only to the local network, and only until they enroll.
    const wantsGate = req.query.enrolled !== undefined;
    if (!adminPasswordMode() && !wantsGate && !isEnrolled() && isPrivateIp(clientIp(req))) {
      const uri = await provisioningUri();
      res.set("Cache-Control", "no-store");
      res.type("html").send(enrollPage({ secret: adminSecret(), uri, owner: adminOwner() }));
      return;
    }
    res.type("html").send(gatePage({ owner: adminOwner(), mode: loginMode() }));
  });

  router.post("/verify", async (req, res) => {
    // The admin password or the authenticator code, whichever the server has (either, when both).
    const mode = loginMode();
    const ip = clientIp(req);
    const trusted = trustLoopback && isLoopbackIp(ip);
    if (!trusted && store.isLocked(ip)) return res.status(429).json({ ok: false });
    const byPassword = mode !== "code" && typeof req.body?.password === "string" && verifyPassword(req.body.password);
    const byCode = !byPassword && mode !== "password" && req.body?.code !== undefined && (await verifyTotp(req.body.code));
    if (!byPassword && !byCode) {
      recordDeny(req, { reason: DENY.ADMIN_BAD_TOTP, status: 401 });
      debug.log("admin login: failed attempt");
      // Wrong guesses count toward the same lockout as a wrong account password.
      if (!trusted) recordFailure(ip, req);
      res.status(401).json({ ok: false });
      return;
    }
    store.clearFailure(ip);
    issueSession(res);
    res.json({ ok: true });
  });

  router.post("/logout", (_req, res) => {
    clearSession(res);
    res.json({ ok: true });
  });

  router.get("/api/stats", (req, res) => {
    if (!requireSession(req, res)) return;

    const { users: userRows, access } = buildUserRows();
    const lockouts = store.snapshot().lockouts;
    const lanes = authLanes();
    const denials = store.denialsSnapshot({ limit: 100 });
    const denied24h = store.denialsSnapshot({ sinceMs: DENIAL_WINDOW_MS }).recent.length;

    res.set("Cache-Control", "no-store");
    res.json({
      generatedAt: Date.now(),
      me: adminActor(req),
      lanes,
      warnings: configWarnings(lanes),
      users: userRows,
      lockouts,
      // The hint is what turns a reason code into an action the operator can take.
      denials: {
        ...denials,
        recent: denials.recent.map((d) => ({ ...d, hint: hintFor(d.reason) })),
      },
      totals: {
        configuredUsers: users.list().length,
        activeUsers: access.length,
        totalRequests: access.reduce((s, a) => s + (a.count || 0), 0),
        lockouts: lockouts.length,
        denied24h,
      },
    });
  });

  router.post("/api/unlock", (req, res) => {
    if (!requireSession(req, res)) return;
    const ip = String(req.body?.ip ?? "").trim();
    if (!ip) {
      res.status(400).json({ error: "ip required" });
      return;
    }
    if (ip === "all") {
      let n = 0;
      for (const l of store.snapshot().lockouts) if (store.unlock(l.ip)) n++;
      debug.log("admin: unlocked %d IPs (bulk)", n);
      res.json({ ok: true, unlocked: n });
      return;
    }
    const removed = store.unlock(ip);
    debug.log("admin: unlock %s → %s", ip, removed);
    res.json({ ok: true, unlocked: removed ? 1 : 0, ip });
  });

  router.post("/api/denials/clear", (req, res) => {
    if (!requireSession(req, res)) return;
    store.clearDenials();
    res.json({ ok: true });
  });

  // ── Device pairing (CyberFoil) ──────────────────────────────────────────
  // Approved + pending devices, plus approve/revoke. Session-gated like stats;
  // the cf_admin cookie (Path=/admin) rides along automatically from the page.
  router.get("/api/devices", (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    const snapshot = store.devicesSnapshot();
    const withCode = (row) => ({ ...row, code: deviceCode(row.deviceKey) });
    res.json({ pairingEnabled: devicePairing, ...snapshot, pending: snapshot.pending.map(withCode), approved: snapshot.approved.map(withCode), since: Date.now() - Math.round(process.uptime() * 1000) });
  });

  router.post("/api/devices/approve", (req, res) => {
    if (!requireSession(req, res)) return;
    // The console's 8-character code works as well as its full key: the admin
    // reads it off the console's screen and types it here.
    const deviceKey = normalizeDeviceKey(req.body?.deviceKey) ?? pendingKeyForCode(req.body?.code ?? req.body?.deviceKey);
    if (!deviceKey) {
      res.status(req.body?.code !== undefined ? 404 : 400).json({ error: req.body?.code !== undefined ? "no device is waiting with that code" : "invalid deviceKey" });
      return;
    }
    const label = String(req.body?.label ?? "").slice(0, 64).trim();

    // Mint a fresh accessKey, persist only its hash, stage the plaintext for the
    // device's next status poll (one-time, in-memory). Re-approving rotates it.
    const accessKey = generateAccessKey();
    store.approveDevice(deviceKey, {
      label,
      addedBy: "admin",
      accessKeyHash: hashAccessKey(accessKey),
    });
    stageAccessKeyDelivery(deviceKey, accessKey);
    debug.log("admin: approved device %s… (%s)", deviceKey.slice(0, 12), label || "no label");
    res.json({ ok: true, deviceKey });
  });

  // Per-device logins (CyberFoil, Tinfoil): every account's, plus the admin's own.
  router.get("/api/device-logins", (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    res.json({ enabled: users.hasUsers(), logins: deviceLogins.list() });
  });

  router.post("/api/device-logins", (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    if (!users.hasUsers()) return res.status(409).json({ error: "device logins need shop accounts" });
    try {
      const login = deviceLogins.create({ owner: "admin", label: req.body?.label });
      const origin = resolveOrigin(req, publicBaseUrl);
      res.json({ ...login, shopUrl: origin ? `${origin}/` : "/" });
    } catch (err) {
      res.status(409).json({ error: err.message });
    }
  });

  router.post("/api/device-logins/:name/revoke", (req, res) => {
    if (!requireSession(req, res)) return;
    try {
      deviceLogins.revoke(req.params.name);
      res.json({ ok: true });
    } catch {
      res.status(404).json({ error: "no such device login" });
    }
  });

  router.post("/api/devices/label", (req, res) => {
    if (!requireSession(req, res)) return;
    const deviceKey = normalizeDeviceKey(req.body?.deviceKey);
    if (!deviceKey || !store.renameDevice(deviceKey, req.body?.label)) return res.status(404).json({ error: "no such device" });
    res.json({ ok: true });
  });

  router.post("/api/devices/revoke", (req, res) => {
    if (!requireSession(req, res)) return;
    const deviceKey = normalizeDeviceKey(req.body?.deviceKey);
    if (!deviceKey) {
      res.status(400).json({ error: "invalid deviceKey" });
      return;
    }
    const removed = store.revokeDevice(deviceKey);
    debug.log("admin: revoke device %s… → %s", deviceKey.slice(0, 12), removed);
    res.json({ ok: true, revoked: removed ? 1 : 0 });
  });

  mountManageApi(router, requireSession);
  mountAccountsApi(router, requireSession);
  mountClientLogsApi(router, requireSession);
  mountHomebrewApi(router, requireSession);
  mountUploadApi(router, requireSession);
  mountTwoFactorApi(router, { requireSession });

  return router;
}
