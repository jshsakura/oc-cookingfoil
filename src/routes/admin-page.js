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
 *   POST /admin/api/devices/dismiss → drop a waiting console's request; an approved console is left alone
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
import { bindingOf, giveToAccount, ownerChoices, suspension } from "../security/device-owner.js";
import { pluginEvents } from "../plugins/instance.js";
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
import { mountAccessHistoryApi, withoutIps } from "./admin/access-history-api.js";
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
import { mountRetroArtApi, startArtSync } from "./admin/retro-art-api.js";
import { watchRetroArt } from "../retro/art/auto.js";
import { mountStorageGuideApi } from "./admin/storage-guide-api.js";
import { mountRetroVariantsApi } from "./admin/retro-variants-api.js";
import { mountRetroKoApi } from "./admin/retro-ko-api.js";
import { mountRetroPatchApi } from "./admin/retro-patch-api.js";
import { mountRetroCoresApi } from "./admin/retro-cores-api.js";
import { mountRetroPackApi } from "./admin/retro-pack-api.js";
import { mountApiTokensApi } from "./admin/api-tokens-api.js";
import { mountServerSettingsApi } from "./admin/server-settings-api.js";
import { mountChatApi } from "./admin/chat-api.js";
import { mountKeysApi } from "./admin/keys-api.js";
import { mountContentApi } from "./admin/content-api.js";
import { mountLibraryFilesApi } from "./admin/library-files-api.js";
import { mountTrashApi } from "./admin/trash-api.js";
import { mountPluginsApi } from "./admin/plugins-api.js";
import { mountLibraryOrganizeApi } from "./admin/library-organize-api.js";
import { mountLibraryBrowseApi } from "./admin/library-browse-api.js";
import { mountFilesApi } from "./admin/files-api.js";
import { mountInboxApi } from "./admin/inbox-api.js";
import { mountServerApi } from "./admin/server-api.js";
import { mountNszApi } from "./admin/nsz-api.js";
import { mountTransfersApi } from "./admin/transfers-api.js";
import * as inboxStore from "../meta/inbox.js";
import * as googleAccounts from "../security/google-accounts.js";
import { clientBuildStatus } from "./client-update.js";
import { TOP_WORDS } from "./admin/top-i18n.js";
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
import { ADMIN_PAGES, ADMIN_PAGE_BY_PATH } from "./admin/admin-pages.js";
import { splitPageFor } from "./admin/admin-split.js";
import { mountOverviewApi } from "./admin/overview-api.js";
import * as adminEdits from "../meta/admin-edits.js";
import debug from "../debug.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const GUIDE = Object.fromEntries(["ko", "en"].map((l) => [l, fs.readFileSync(fileURLToPath(new URL(`../views/guide.${l}.md`, import.meta.url)), "utf8")]));
// The guide is kept in Korean and English; any other language, Japanese and Chinese included, reads English. Without ?lang= it stays Korean.
const guideLang = (req) => (typeof req.query?.lang === "string" && parseLang(req.query.lang) !== "ko" ? "en" : "ko");
import { readPairLink, deviceCode, normalizeDeviceCode } from "../security/pairing-link.js";
import { approvePairLink, approveWaitingDevice, pairLinkView } from "../security/pairing-approve.js";
import { deviceLimitRefusal } from "../security/device-limit.js";
import { apiWord } from "./admin/api-words.js";
import { pairPage } from "./admin/pair-page.js";
import { guidePage } from "./admin/guide-page.js";
import { resolveOrigin } from "../helpers/origin.js";
import { publicBaseUrl } from "../helpers/envs.js";
import * as envs from "../helpers/envs.js";
import { sameOriginWrites } from "../security/same-origin.js";
import { sendVendor } from "./admin/grid.js";
import { securityText } from "../security/security-messages.js";
import { parseLang, requestLang } from "../meta/langs.js";

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
/**
 * A rejected client build, as an overview warning. The page words it from the reason, message and
 * version in its dictionary; title and detail are the English fallback for any other reader.
 */
function clientBuildWarnings() {
  const { published, rejected } = clientBuildStatus();
  if (!rejected) return [];
  const en = TOP_WORDS.en;
  const fill = (text, vars) => Object.entries(vars).reduce((t, [k, v]) => t.split(`{${k}}`).join(v), text);
  return [{
    code: "client-build-rejected", severity: "warn",
    reason: rejected.code, message: rejected.message, version: published?.version ?? null,
    title: en["ov.w.buildT"],
    detail: `${fill(en["ov.w.buildLead"], { code: en[`ov.w.buildR.${rejected.code}`] ?? rejected.code, msg: rejected.message })} ${published ? fill(en["ov.w.buildKept"], { v: published.version }) : en["ov.w.buildNone"]}`,
  }];
}

// What an automation token may not change: who can sign in and how (accounts, consoles and
// their approval, client downloads), the alerts that carry the approval
// buttons, whether the server runs, and the binaries every console installs (the client build
// and where its releases come from, uploaded homebrew, which GitHub homebrew is followed and
// which release file of it, uploaded patches and which of them a game requires), removing
// files from the game library (retro roms and kept NSZ originals too), moving a user's
// RetroArch core to the trash or back (retro-cores official and user-version), patching a
// retro ROM in place or putting its original back (retro-patch apply and restore), and emptying
// the trash, the one delete nothing brings back. Restoring from the trash and undoing a move
// stay open. Routes match
// case-insensitively and Express decodes params, so this tests the decoded path case-insensitively.
export const TOKEN_BLOCKED_RE = /^\/api\/(?:(?:users|accounts|google|tokens|chat|2fa|admin-password|server|devices|pair|clients|alerts|integrations\/(?:telegram|chat)|client-release|keys|upload\/(?:client|homebrew|patch)|patches\/(?:required|[^/]+\/info)|content\/patch\/(?:move|remove)|library\/(?:files|other)\/remove|files\/(?:mkdir|rename|move|copy|info|sizes|shares?|trash|upload|zip)|retro-art\/games\/remove|retro-cores\/(?:official|user-version)|retro-patch\/[^/]+\/(?:apply|restore)|nsz\/purge-kept|trash\/empty|plugins\/(?:rescan|restore|recommended\/install|install(?:\/confirm)?|[^/]+\/(?:enabled|trash|cache\/clear)))(?:\/|$)|homebrew(?:\/asset)?\/?$)/i;

// Reads a token may not make either: the token list (tokens never handle tokens), the chat
// (a person's tool), the admin login's second step, and where consoles and accounts connected from.
export const TOKEN_BLOCKED_READ_RE = /^\/api\/(?:(?:tokens|chat|2fa|access-history|counts)(?:\/|$)|plugins\/[^/]+\/download\/?$|files\/(?:download\/?$|zip(?:\/|$)|copy\/|shares\/?$))/i;

/**
 * Whether an automation token is refused `method path`, with the path decoded and as this router
 * sees it (no /admin mount). requireSession enforces it; src/capabilities/define.js asks it too,
 * so what the registry offers tokens never drifts from what the server allows.
 */
export function tokenBlocked(method, path) {
  // Express answers a HEAD with the GET handler, so it is read like one.
  const m = method.toUpperCase();
  return (m === "GET" || m === "HEAD" ? TOKEN_BLOCKED_READ_RE : TOKEN_BLOCKED_RE).test(path);
}

/** The path as the route handlers see it, or null when its percent-encoding is malformed. */
function decodedPath(raw) {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

function requireSession(req, res) {
  if (req.apiToken) {
    const path = decodedPath(req.path);
    if (path === null) {
      res.status(400).json({ error: "malformed path" });
      return false;
    }
    if (tokenBlocked(req.method, path)) {
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
    const login = store.lastLogin(user);
    const consoles = store.lastActiveOf(user);
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
      lastLoginAt: login?.at ?? null,
      lastLoginMethod: login?.method ?? null,
      lastLoginIp: login?.ip ?? null,
      // Its web requests and the consoles it approved, whichever was later.
      lastActiveAt: Math.max(a?.lastAt ?? 0, consoles ?? 0) || null,
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
    res.status(403).type("html").send(forbiddenPage(requestLang(req)));
  });

  router.get("/pair/:token", (req, res) => {
    res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY" });
    if (!devicePairing) return res.status(404).send("not found");
    const link = readPairLink(req.params.token);
    if (!link) return res.status(410).type("html").send(pairPage({ expired: true }));
    const { view, repair } = pairLinkView(link, adminApprover(req));
    res.type("html").send(pairPage({
      code: link.code,
      authenticated: hasValidSession(req),
      approved: view === "done",
      repair,
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
    if (result === "limit") return deviceLimitRefusal(req, res);
    res.json({ ok: true });
  });

  router.get("/vendor/:file", (req, res) => {
    if (!hasValidSession(req)) return res.status(401).send("sign in");
    sendVendor(req, res);
  });

  // One job per URL. Every page below goes through the same checks as "/" did:
  // the admin account gate, the first-run enrollment and the TOTP/password check.
  // A page served without a session renders the gate, and its own "reload after
  // verify" lands the operator back on the very path and query they opened.
  // Only these literal paths exist, so /api, /verify, /pair, /vendor and /guide
  // keep their own handlers below and are never captured.
  async function serveAdminPage(req, res, page) {
    res.set("Cache-Control", "no-store");
    if (hasValidSession(req)) {
      const raw = page.param === "tab" ? req.query.tab : req.query.view;
      const view = typeof raw === "string" ? raw.slice(0, 40) : "";
      // Patches and saves were views of the games page before they got pages of their own.
      // Its server tab went into the server settings page.
      if (page.path === "/admin/games" && (view === "patches" || view === "saves" || view === "server")) {
        const rest = { ...req.query };
        delete rest.view;
        // Those old links meant the list, which now follows the folder tab.
        return redirectKeeping(res, view === "server" ? "/admin/settings/server" : `/admin/${view}`, view === "server" ? rest : { ...rest, tab: "list" });
      }
      // The split pages of the redesign carry only their own markup and script.
      const split = splitPageFor(page, view);
      if (split) {
        res.type("html").send(split);
        return;
      }
      res.type("html").send(dashboardPage(page, view));
      return;
    }
    // First run: the operator has never proven they hold the generated secret.
    // Show it, but only to the local network, and only until they enroll.
    const wantsGate = req.query.enrolled !== undefined;
    if (!adminPasswordMode() && !wantsGate && !isEnrolled() && isPrivateCaller(req)) {
      const uri = await provisioningUri();
      res.type("html").send(enrollPage({ secret: adminSecret(), uri, owner: adminOwner() }));
      return;
    }
    res.type("html").send(gatePage({ owner: adminOwner(), mode: loginMode() }));
  }

  router.get("/", async (req, res) => {
    await serveAdminPage(req, res, ADMIN_PAGE_BY_PATH.get("/admin"));
  });

  // The router is mounted at /admin, so each page registers by its path with
  // the mount prefix taken off ("/users", not "/admin/users"); the sidebar and
  // the bridge script keep the full address for the browser.
  for (const page of ADMIN_PAGES) {
    const rel = page.path.slice("/admin".length) || "/";
    if (rel === "/") continue;
    router.get(rel, async (req, res) => {
      await serveAdminPage(req, res, page);
    });
  }
  // The library's jobs became tabs of the games page and the temp folder moved under "incoming":
  // old bookmarks and alert links land on the new address, with their query kept.
  const MOVED = {
    "/titles": "/admin/games?view=info", "/integrity": "/admin/games?view=verify", "/organize": "/admin/incoming/temp",
  };
  const redirectKeeping = (res, to, query) => {
    const extra = new URLSearchParams(query).toString();
    res.redirect(302, extra ? `${to}${to.includes("?") ? "&" : "?"}${extra}` : to);
  };
  for (const [from, to] of Object.entries(MOVED)) router.get(from, (req, res) => redirectKeeping(res, to, req.query));
  // The standalone file browser is gone: each library page has the file browser of its own folder as its "파일" tab.
  const FILES_TAB = {
    games: "/admin/games", retro: "/admin/retro", homebrew: "/admin/homebrew", patches: "/admin/patches", saves: "/admin/saves",
  };
  router.get("/files", (req, res) => {
    const { root, ...rest } = req.query;
    if (root === "incoming") return redirectKeeping(res, "/admin/incoming/temp", rest);
    redirectKeeping(res, `${FILES_TAB[root] ?? FILES_TAB.games}?tab=folder`, rest);
  });
  // Alerts moved under the settings: an old bookmark lands on the new address.
  router.get("/notifications", (req, res) => res.redirect(301, "/admin/settings/notifications"));

  // The operator's guide, which is also what an AI assistant is handed with a token.
  router.get("/guide.md", (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store").type("text/markdown; charset=utf-8").send(GUIDE[guideLang(req)]);
  });

  // The same guide as a page to read; /guide.md stays the raw text an AI helper is handed.
  router.get("/guide", (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store").type("html").send(guidePage(GUIDE.ko, GUIDE.en));
  });

  router.post("/verify", async (req, res) => {
    // The admin password or the authenticator code, whichever the server has (either, when both).
    const mode = loginMode();
    const ip = clientIp(req);
    const trusted = trustedHere(req);
    if (!trusted && store.isLocked(ip)) return tooManyRequests(res, lockoutRetryAfter(ip)).json({ ok: false });
    const byPassword = mode !== "code" && typeof req.body?.password === "string" && (await verifyPassword(req.body.password));
    const triesCode = !byPassword && mode !== "password" && req.body?.code !== undefined;
    // Wrong codes are counted with no loopback or sign-in exemption (security/totp-guard.js).
    const codeWait = triesCode ? totpGuard.lockedFor(TOTP_ACCOUNT, ip) : 0;
    if (codeWait) {
      recordDeny(req, { reason: DENY.ADMIN_BAD_TOTP, status: 429, detail: "too many wrong codes" });
      return tooManyRequests(res, codeWait).json({ ok: false, error: "otp-locked", message: securityText(requestLang(req), "totp.locked") });
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
      users: req.apiToken ? userRows.map(withoutIps) : userRows,
      // An automation token gets the counts and reasons, never the addresses.
      lockouts: req.apiToken ? lockouts.map(({ ip: _ip, ...l }) => l) : lockouts,
      // The hint is what turns a reason code into an action the operator can take.
      denials: {
        ...denials,
        recent: denials.recent.map(({ ip, ...d }) => ({ ...d, ...(req.apiToken ? {} : { ip }), hint: hintFor(d.reason) })),
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
    const approved = snapshot.approved.map((row) => ({ ...withCode(row), suspended: suspension(row.deviceKey) }));
    res.json({ pairingEnabled: devicePairing, ...snapshot, pending: snapshot.pending.map(withCode), approved: req.apiToken ? approved.map(withoutIps) : approved, clients: clientRows(), owners: ownerChoices() });
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
    const result = approveWaitingDevice(deviceKey, { label: req.body?.label, addedBy: adminApprover(req) });
    if (!result.ok) return deviceLimitRefusal(req, res, result.limit);
    debug.log("admin: approved device %s… (%s)", deviceKey.slice(0, 12), result.label || "no label");
    res.json({ ok: true, deviceKey });
  });

  // A console no account holds goes to the account the admin picks, keeping its key (security/device-owner.js).
  router.post("/api/devices/owner", (req, res) => {
    if (!requireSession(req, res)) return;
    const deviceKey = normalizeDeviceKey(req.body?.deviceKey);
    if (!deviceKey) return res.status(400).json({ error: "invalid deviceKey" });
    const result = giveToAccount(deviceKey, String(req.body?.owner ?? ""));
    if (result.code === "device-limit") return deviceLimitRefusal(req, res, result.limit);
    if (!result.ok) return res.status(result.code === "no-device" ? 404 : 409).json({ error: apiWord(req, `device.${result.code}`), code: result.code });
    debug.log("admin: console %s… given to an account", deviceKey.slice(0, 12));
    res.json({ ok: true, binding: bindingOf(deviceKey) });
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

  // The waiting list's reject button. The list may be stale, so a console approved meanwhile keeps its approval.
  router.post("/api/devices/dismiss", (req, res) => {
    if (!requireSession(req, res)) return;
    const deviceKey = normalizeDeviceKey(req.body?.deviceKey);
    if (!deviceKey) {
      res.status(400).json({ error: "invalid deviceKey" });
      return;
    }
    const dismissed = store.dismissPending(deviceKey);
    debug.log("admin: dismiss request %s… → %s", deviceKey.slice(0, 12), dismissed);
    res.json({ ok: true, dismissed: dismissed ? 1 : 0, approved: store.isDeviceApproved(deviceKey) });
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

  // The shell's four sidebar numbers. The inbox count is the open (undone)
  // entries: each is a directory with note.json and status.json (done: true
  // once set aside). A 15s TTL keeps repeated polls from re-reading the disk.
  const inboxTTL = { at: 0, n: 0 };
  async function countOpenInbox() {
    if (Date.now() - inboxTTL.at < 15_000) return inboxTTL.n;
    let n = 0;
    const names = await fs.promises.readdir(inboxStore.INBOX_DIR).catch(() => []);
    for (const id of names.filter(inboxStore.isEntryId)) {
      const status = await fs.promises
        .readFile(`${inboxStore.INBOX_DIR}/${id}/status.json`, "utf8")
        .then((t) => JSON.parse(t), () => null)
        .catch(() => null);
      if (!status?.done) n++;
    }
    inboxTTL.at = Date.now();
    inboxTTL.n = n;
    return n;
  }
  /** What waits for the admin: the sidebar badges and the overview's to-do list read the same counts. */
  async function waitingCounts() {
    let pendingAccounts = 0;
    try { pendingAccounts = googleAccounts.list().filter((a) => a.status === "pending").length; } catch { /* none configured */ }
    return {
      inbox: await countOpenInbox(),
      pendingAccounts,
      pendingDevices: store.devicesSnapshot().pending.length,
      lockouts: store.snapshot().lockouts.length,
    };
  }
  router.get("/api/counts", async (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    res.json({ me: withAvatar(adminActor(req)), ...(await waitingCounts()) });
  });
  mountOverviewApi(router, requireSession, {
    warnings: () => [...configWarnings(authLanes()), ...clientBuildWarnings()],
    lanes: () => authLanes(),
    counts: waitingCounts,
  });

  mountManageApi(router, requireSession);
  mountAccountsApi(router, requireSession);
  mountAccessHistoryApi(router, requireSession);
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
  // Box art for ROMs a scan finds without any, as the retro tab's button fetches it (retroAutoArt).
  watchRetroArt({ dir: envs.retroDir, file: path.join(envs.dataDir, "retro-auto-art.json"), start: startArtSync, enabled: () => envs.retroAutoArt });
  mountStorageGuideApi(router, requireSession);
  mountRetroVariantsApi(router, requireSession);
  mountRetroKoApi(router, requireSession);
  mountRetroPatchApi(router, requireSession);
  mountRetroCoresApi(router, requireSession);
  mountRetroPackApi(router, requireSession);
  mountApiTokensApi(router, requireSession);
  mountServerSettingsApi(router, requireSession);
  mountChatApi(router, requireSession);
  mountKeysApi(router, requireSession);
  mountContentApi(router, requireSession);
  mountLibraryFilesApi(router, requireSession);
  mountTrashApi(router, requireSession);
  mountPluginsApi(router, requireSession, undefined, undefined, undefined, pluginEvents());
  mountLibraryOrganizeApi(router, requireSession);
  mountLibraryBrowseApi(router, requireSession);
  mountFilesApi(router, requireSession);
  mountInboxApi(router, requireSession);
  mountServerApi(router, requireSession);
  mountNszApi(router, requireSession);
  mountTransfersApi(router, requireSession);

  return router;
}
