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
  issueSession,
  clearSession,
  hasValidSession,
  provisioningUri,
} from "../security/admin-session.js";
import { adminSecret, isEnrolled } from "../security/admin-secret.js";
import { getUsersFromEnv } from "../authUsersParser.js";
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
import { isPrivateIp } from "../security/net.js";
import { gatePage } from "./admin/gate-page.js";
import { enrollPage } from "./admin/enroll-page.js";
import { dashboardPage } from "./admin/dashboard-page.js";
import debug from "../debug.js";

const DENIAL_WINDOW_MS = 24 * 60 * 60 * 1000;

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
  const configured = Object.keys(getUsersFromEnv() ?? {});

  // Configured users first (so never-seen accounts still show), then any
  // historical user no longer in the env list.
  const users = configured.map((user) => {
    const a = byUser.get(user);
    byUser.delete(user);
    return {
      user,
      configured: true,
      lastAt: a?.lastAt ?? null,
      firstAt: a?.firstAt ?? null,
      count: a?.count ?? 0,
      lastIp: a?.lastIp ?? null,
      ips: a?.ips ?? [],
    };
  });
  const historical = Array.from(byUser.values()).map((a) => ({ ...a, configured: false }));
  return { users: [...users, ...historical], access };
}

export default function adminPageRouter() {
  const router = express.Router();
  router.use(express.json());

  router.get("/", async (req, res) => {
    if (hasValidSession(req)) {
      res.type("html").send(dashboardPage());
      return;
    }
    // First run: the operator has never proven they hold the generated secret.
    // Show it — but only to the local network, and only until they enroll.
    const wantsGate = req.query.enrolled !== undefined;
    if (!wantsGate && !isEnrolled() && isPrivateIp(clientIp(req))) {
      const uri = await provisioningUri();
      res.set("Cache-Control", "no-store");
      res.type("html").send(enrollPage({ secret: adminSecret(), uri }));
      return;
    }
    res.type("html").send(gatePage());
  });

  router.post("/verify", async (req, res) => {
    const ok = await verifyTotp(req.body?.code);
    if (!ok) {
      recordDeny(req, { reason: DENY.ADMIN_BAD_TOTP, status: 401 });
      debug.log("admin 2fa: failed code attempt");
      res.status(401).json({ ok: false });
      return;
    }
    issueSession(res);
    res.json({ ok: true });
  });

  router.post("/logout", (_req, res) => {
    clearSession(res);
    res.json({ ok: true });
  });

  router.get("/api/stats", (req, res) => {
    if (!requireSession(req, res)) return;

    const { users, access } = buildUserRows();
    const lockouts = store.snapshot().lockouts;
    const lanes = authLanes();
    const denials = store.denialsSnapshot({ limit: 100 });
    const denied24h = store.denialsSnapshot({ sinceMs: DENIAL_WINDOW_MS }).recent.length;

    res.set("Cache-Control", "no-store");
    res.json({
      generatedAt: Date.now(),
      lanes,
      warnings: configWarnings(lanes),
      users,
      lockouts,
      // The hint is what turns a reason code into an action the operator can take.
      denials: {
        ...denials,
        recent: denials.recent.map((d) => ({ ...d, hint: hintFor(d.reason) })),
      },
      totals: {
        configuredUsers: Object.keys(getUsersFromEnv() ?? {}).length,
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
    res.json({ pairingEnabled: devicePairing, ...store.devicesSnapshot() });
  });

  router.post("/api/devices/approve", (req, res) => {
    if (!requireSession(req, res)) return;
    const deviceKey = normalizeDeviceKey(req.body?.deviceKey);
    if (!deviceKey) {
      res.status(400).json({ error: "invalid deviceKey" });
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

  return router;
}
