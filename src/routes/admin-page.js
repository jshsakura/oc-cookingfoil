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
 *   POST /admin/api/devices/admin   → { deviceKey, admin } make an approved console an admin device (it may
 *                                     change item settings, routes/admin-items.js) or not
 *   GET  /admin/api/admin-edits?limit=100 → item setting changes, newest first (meta/admin-edits.js)
 *   GET  /admin/api/server/status   → safe restart state, requests in flight (counts only)
 *   POST /admin/api/server/restart  → drain, then exit (the container comes back by its restart policy)
 *   GET  /admin/api/transfers       → download records: open, recent, the last day per route
 *
 * Every POST/PUT/PATCH/DELETE refuses another site's Origin (403
 * { error: "origin mismatch" }) before its handler; GETs are untouched.
 *
 * The surface is always mounted: a TOTP secret is auto-provisioned when the
 * operator hasn't supplied one, so "I can't get into /admin, so I can't approve
 * anything" is no longer a reachable state.
 */
import { gravatarUrl } from "../helpers/gravatar.js";
import { clientRows } from "./device-pair.js";
import * as enrollTokens from "../security/enroll-tokens.js";
import express from "express";

import * as store from "../security/store.js";
import { lockoutRetryAfter, tooManyRequests } from "../security/retry-after.js";
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
import { mountManageApi } from "./admin/manage-api.js";
import { mountAccountsApi } from "./admin/accounts-api.js";
import { mountClientLogsApi } from "./admin/client-logs-api.js";
import { mountClientReleaseApi } from "./admin/client-release-api.js";
import { mountHomebrewApi } from "./admin/homebrew-api.js";
import { mountHomebrewAppsApi } from "./admin/homebrew-apps-api.js";
import { mountPatchesApi } from "./admin/patches-api.js";
import { mountDescriptionsApi } from "./admin/descriptions-api.js";
import { adminActor, adminApprover, mayAdminister } from "../security/admin-actor.js";
import { forbiddenPage } from "./admin/forbidden-page.js";
import { mountUploadApi } from "./admin/upload-api.js";
import { mountTwoFactorApi } from "./admin/two-factor-api.js";
import { mountIntegrationsApi } from "./admin/integrations-api.js";
import { mountAlertsApi } from "./admin/alerts-api.js";
import { mountRetroArtApi } from "./admin/retro-art-api.js";
import { mountRetroVariantsApi } from "./admin/retro-variants-api.js";
import { mountRetroCoresApi } from "./admin/retro-cores-api.js";
import { mountRetroPackApi } from "./admin/retro-pack-api.js";
import { mountApiTokensApi } from "./admin/api-tokens-api.js";
import { mountServerSettingsApi } from "./admin/server-settings-api.js";
import { mountKeysApi } from "./admin/keys-api.js";
import { mountContentApi } from "./admin/content-api.js";
import { mountLibraryFilesApi } from "./admin/library-files-api.js";
import { mountLibraryOrganizeApi } from "./admin/library-organize-api.js";
import { mountLibraryBrowseApi } from "./admin/library-browse-api.js";
import { mountInboxApi } from "./admin/inbox-api.js";
import { mountServerApi } from "./admin/server-api.js";
import { mountNszApi } from "./admin/nsz-api.js";
import { mountTransfersApi } from "./admin/transfers-api.js";
import { clientBuildStatus } from "./client-update.js";
import { normalizeDeviceKey } from "../security/pairing.js";
import { devicePairing } from "../helpers/envs.js";
import { authLanes, configWarnings } from "../security/config-health.js";
import { hintFor } from "../security/deny-reasons.js";
import { recordDeny, clientIp, DENY } from "../security/deny.js";
import { recordFailure } from "../security/auth-guard.js";
import * as totpGuard from "../security/totp-guard.js";
import { isPrivateCaller, trustedHere } from "../security/net.js";
import { gatePage } from "./admin/gate-page.js";
import { enrollPage } from "./admin/enroll-page.js";
import { dashboardPage } from "./admin/dashboard-page.js";
import * as adminEdits from "../meta/admin-edits.js";
import debug from "../debug.js";
import fs from "fs";
import { fileURLToPath } from "url";

const GUIDE = fs.readFileSync(fileURLToPath(new URL("../views/guide.md", import.meta.url)), "utf8");
import { readPairLink, deviceCode, normalizeDeviceCode } from "../security/pairing-link.js";
import { approvePairLink, approveWaitingDevice } from "../security/pairing-approve.js";
import { pairPage } from "./admin/pair-page.js";
import { guidePage } from "./admin/guide-page.js";
import { resolveOrigin } from "../helpers/origin.js";
import { publicBaseUrl } from "../helpers/envs.js";
import { sameOriginWrites } from "../security/same-origin.js";
import { sendVendor } from "./admin/grid.js";

const DENIAL_WINDOW_MS = 24 * 60 * 60 * 1000;
// One authenticator secret guards /admin, so its wrong codes share one account counter.
const TOTP_ACCOUNT = "admin";

/**
 * What the admin page's own check takes: "code" (authenticator only),
 * "password" (admin password only), or "either" (one of the two).
 */
function loginMode() {
  if (!adminPasswordMode()) return "code";
  return isEnrolled() ? "either" : "password";
}

/** Session check that also leaves a trail when it fails. */
const BUILD_REASONS = {
  empty: "파일이 비어 있습니다", "not-nro": "NRO 파일이 아닙니다(0x10 에 NRO0 가 없습니다)", truncated: "파일이 잘렸습니다(헤더가 말하는 크기보다 작습니다)",
  "trailing-bytes": "헤더가 말하는 크기 뒤에 군더더기가 붙어 있습니다", "no-assets": "ASET 자산이 없습니다", "no-nacp": "NACP 가 없습니다",
  "bad-version": "NACP 표시 버전이 x.y.z 형식이 아닙니다", downgrade: "지금 내보내는 버전보다 낮습니다", "too-large": "파일이 너무 큽니다",
};

/** A rejected client build, as an overview warning. */
function clientBuildWarnings() {
  const { published, rejected } = clientBuildStatus();
  if (!rejected) return [];
  return [{
    code: "client-build-rejected", severity: "warn",
    title: "새 클라이언트 파일을 내보내지 않았습니다",
    detail: `data/client/cookingfoil.nro 가 검사를 통과하지 못했습니다: ${BUILD_REASONS[rejected.code] ?? rejected.code} (${rejected.message}). ${published ? `기기에는 ${published.version} 을 계속 내보냅니다.` : "아직 내보내는 버전이 없습니다."}`,
  }];
}

// What an automation token may not change: who can sign in and how (accounts, consoles and
// their approval, client downloads), the alerts that carry the approval
// buttons, whether the server runs, and the binaries every console installs (the client build
// and where its releases come from, uploaded homebrew, which GitHub homebrew is followed and
// which release file of it, uploaded patches and which of them a game requires), and deleting
// files from the game library (retro roms and kept NSZ originals too), which has no trash to bring
// them back from. Routes match
// case-insensitively and Express decodes params, so this tests the decoded path case-insensitively.
export const TOKEN_BLOCKED_RE = /^\/api\/(?:(?:users|accounts|google|tokens|2fa|admin-password|server|devices|pair|clients|alerts|integrations\/telegram|client-release|keys|upload\/(?:client|homebrew|patch)|patches\/(?:required|[^/]+\/info)|content\/patch\/(?:move|remove)|library\/(?:files|other)\/remove|retro-art\/games\/remove|nsz\/purge-kept)(?:\/|$)|homebrew(?:\/asset)?\/?$)/i;

/** The path as the route handlers see it, or null when its percent-encoding is malformed. */
function decodedPath(raw) {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

function requireSession(req, res) {
  if (req.apiToken && req.method !== "GET") {
    const path = decodedPath(req.path);
    if (path === null) {
      res.status(400).json({ error: "malformed path" });
      return false;
    }
    if (TOKEN_BLOCKED_RE.test(path)) {
      res.status(403).json({ error: "automation tokens cannot do this; sign in to the admin page" });
      return false;
    }
  }
  // An automation token stands in for the admin's second step (auth-guard checked it).
  if (hasValidSession(req) || req.apiToken) return true;
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


// A Google account shows its Gravatar on the account button.
const withAvatar = (me) => (me?.kind === "google" ? { ...me, avatar: gravatarUrl(me.email) } : me);
export default function adminPageRouter() {
  const router = express.Router();
  // Every change here (accounts, homebrew, integrations, ...) must come from
  // this site's own page: another site's Origin is refused before any handler.
  router.use(sameOriginWrites());
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
    const result = approvePairLink(req.params.token, { label: req.body?.label, addedBy: adminApprover(req) });
    if (result === "expired") return res.status(410).json({ error: "pair link expired" });
    if (result === "used") return res.status(409).json({ error: "pair link already approved" });
    res.json({ ok: true });
  });

  router.get("/vendor/:file", (req, res) => {
    if (!hasValidSession(req)) return res.status(401).send("sign in");
    sendVendor(req, res);
  });

  router.get("/", async (req, res) => {
    if (hasValidSession(req)) {
      res.type("html").send(dashboardPage());
      return;
    }
    // First run: the operator has never proven they hold the generated secret.
    // Show it — but only to the local network, and only until they enroll.
    const wantsGate = req.query.enrolled !== undefined;
    if (!adminPasswordMode() && !wantsGate && !isEnrolled() && isPrivateCaller(req)) {
      const uri = await provisioningUri();
      res.set("Cache-Control", "no-store");
      res.type("html").send(enrollPage({ secret: adminSecret(), uri, owner: adminOwner() }));
      return;
    }
    res.type("html").send(gatePage({ owner: adminOwner(), mode: loginMode() }));
  });

  // The operator's guide, which is also what an AI assistant is handed with a token.
  router.get("/guide.md", (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store").type("text/markdown; charset=utf-8").send(GUIDE);
  });

  // The same guide as a page to read; /guide.md stays the raw text an AI helper is handed.
  router.get("/guide", (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store").type("html").send(guidePage(GUIDE));
  });

  router.post("/verify", async (req, res) => {
    // The admin password or the authenticator code, whichever the server has (either, when both).
    const mode = loginMode();
    const ip = clientIp(req);
    const trusted = trustedHere(req);
    if (!trusted && store.isLocked(ip)) return tooManyRequests(res, lockoutRetryAfter(ip)).json({ ok: false });
    const byPassword = mode !== "code" && typeof req.body?.password === "string" && verifyPassword(req.body.password);
    const triesCode = !byPassword && mode !== "password" && req.body?.code !== undefined;
    // Wrong codes are counted with no loopback or sign-in exemption (security/totp-guard.js).
    const codeWait = triesCode ? totpGuard.lockedFor(TOTP_ACCOUNT, ip) : 0;
    if (codeWait) {
      recordDeny(req, { reason: DENY.ADMIN_BAD_TOTP, status: 429, detail: "too many wrong codes" });
      return tooManyRequests(res, codeWait).json({ ok: false, error: "otp-locked", message: totpGuard.LOCKED_MESSAGE });
    }
    const byCode = triesCode && (await verifyTotp(req.body.code));
    if (triesCode) {
      if (byCode) totpGuard.reset(TOTP_ACCOUNT, ip);
      else totpGuard.recordFailure(TOTP_ACCOUNT, ip);
    }
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
      me: withAvatar(adminActor(req)),
      lanes,
      warnings: [...configWarnings(lanes), ...clientBuildWarnings()],
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

  // ── Device pairing ──────────────────────────────────────────────────────
  // Approved + pending devices, plus approve/revoke. Session-gated like stats;
  // the cf_admin cookie (Path=/admin) rides along automatically from the page.
  router.get("/api/devices", (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    const snapshot = store.devicesSnapshot();
    const withCode = (row) => ({ ...row, code: deviceCode(row.deviceKey) });
    res.json({ pairingEnabled: devicePairing, ...snapshot, pending: snapshot.pending.map(withCode), approved: snapshot.approved.map(withCode), clients: clientRows(), since: Date.now() - Math.round(process.uptime() * 1000) });
  });

  router.post("/api/clients/:id/revoke", (req, res) => {
    if (!requireSession(req, res)) return;
    if (!/^[0-9a-f]{8}$/.test(req.params.id) || !enrollTokens.revoke(req.params.id)) return res.status(404).json({ error: "no such download waiting" });
    res.json({ ok: true });
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
    // Mint a fresh accessKey, persist only its hash, stage the plaintext for the
    // device's next status poll (one-time, in-memory). Re-approving rotates it.
    const label = approveWaitingDevice(deviceKey, { label: req.body?.label, addedBy: adminApprover(req) });
    debug.log("admin: approved device %s… (%s)", deviceKey.slice(0, 12), label || "no label");
    res.json({ ok: true, deviceKey });
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

  // An admin device may change item settings from the console (security/device-admin.js). Off by default.
  router.post("/api/devices/admin", (req, res) => {
    if (!requireSession(req, res)) return;
    if (typeof req.body?.admin !== "boolean") return res.status(400).json({ error: "admin must be true or false" });
    const deviceKey = normalizeDeviceKey(req.body?.deviceKey);
    if (!deviceKey || !store.setDeviceAdmin(deviceKey, req.body.admin)) return res.status(404).json({ error: "no such device" });
    debug.log("admin: device %s… admin device %s", deviceKey.slice(0, 12), req.body.admin ? "on" : "off");
    res.json({ ok: true, admin: store.isDeviceAdmin(deviceKey) });
  });

  router.get("/api/admin-edits", (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    res.json({ edits: adminEdits.recent(req.query.limit) });
  });

  mountManageApi(router, requireSession);
  mountAccountsApi(router, requireSession);
  mountClientLogsApi(router, requireSession);
  mountClientReleaseApi(router, requireSession);
  mountHomebrewApi(router, requireSession);
  mountHomebrewAppsApi(router, requireSession);
  mountPatchesApi(router, requireSession);
  mountDescriptionsApi(router, requireSession);
  mountUploadApi(router, requireSession);
  mountTwoFactorApi(router, { requireSession });
  mountIntegrationsApi(router, requireSession);
  mountAlertsApi(router, requireSession);
  mountRetroArtApi(router, requireSession);
  mountRetroVariantsApi(router, requireSession);
  mountRetroCoresApi(router, requireSession);
  mountRetroPackApi(router, requireSession);
  mountApiTokensApi(router, requireSession);
  mountServerSettingsApi(router, requireSession);
  mountKeysApi(router, requireSession);
  mountContentApi(router, requireSession);
  mountLibraryFilesApi(router, requireSession);
  mountLibraryOrganizeApi(router, requireSession);
  mountLibraryBrowseApi(router, requireSession);
  mountInboxApi(router, requireSession);
  mountServerApi(router, requireSession);
  mountNszApi(router, requireSession);
  mountTransfersApi(router, requireSession);

  return router;
}
