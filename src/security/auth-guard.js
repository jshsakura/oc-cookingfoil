/**
 * Auth guard: the sign-in wall in front of everything but the pairing routes.
 *
 * What gets past it: an approved console (pairingGate set req.pairedDevice), a
 * console's session token (sessionGate set req.sessionLane), a person signed in
 * on the web (session cookie), or an automation token on the paths it may use.
 * Everything else is turned away: a page goes to /login, anything else gets a
 * plain 401 with no Basic challenge. A password authenticates nothing here; a
 * console uses its ID and password at most once, on the pairing routes, to be
 * approved (pairSignIn below), and its keys from then on.
 *
 * Brute force: a wrong password at pairing, the web form or an automation
 * token counts toward a per-address lockout (recordFailure). At the threshold
 * (default 5) the address gets a hard 429. Lockouts persist
 * (COOK_LOCKOUT_TTL_HOURS=0, default) until an admin unlocks via POST
 * /api/admin/unlock, OR auto-expire if the env sets a TTL.
 */
import { GAME_FILE_RE } from "../helpers/file-send.js";
import crypto from "crypto";
import debug from "../debug.js";
import { unauthorizedMessage, devicePairing, deviceAutoApprove, deviceAutoApproveAll } from "../helpers/envs.js";
import { approveSignedInDevice } from "./pairing-approve.js";
import * as users from "./users.js";
import { adminAwaitsSetup } from "./setup.js";
import * as store from "./store.js";
import { lockoutRetryAfter, tooManyRequests } from "./retry-after.js";
import { denyResponse, DENY } from "./deny.js";
import { noteProxyCollapse } from "./proxy-check.js";
import { trustedHere } from "./net.js";
import { maxAuthFailures as MAX_FAILURES } from "./limits.js";
import { envNumber } from "../helpers/env-read.js";
import { alert } from "../helpers/alerts.js";
import { noteFailure } from "./security-watch.js";
import { webUser } from "./user-session.js";
import * as apiTokens from "./api-tokens.js";
import * as googleAccounts from "./google-accounts.js";
import { basicRefusal, passwordOwnerOk } from "./password-policy.js";
import { noteRefusal } from "./auth-log.js";
import { deviceKeyFromHeaders } from "./pairing.js";
import { vouch } from "./server-id.js";

const LOCKOUT_TTL_MS = envNumber("COOK_LOCKOUT_TTL_HOURS", 0, { min: 0 }) * 60 * 60 * 1000;

export function clientIp(req) {
  // Prefers req.ip when `trust proxy` is on and an X-Forwarded-For arrived;
  // otherwise the socket address. Strip the leading ::ffff: from
  // IPv4-mapped IPv6 so the IP key matches what an admin would type.
  const raw = req.ip || req.socket?.remoteAddress || "unknown";
  return raw.replace(/^::ffff:/, "");
}

const BASIC_RE = /^Basic\s/i;

/**
 * Mounted right after the pairing routes: past them a Basic header is no
 * credential at all, so it is dropped and the request is judged by what else
 * it carries (its keys, a session token, a cookie), or as carrying nothing.
 */
export function ignoreBasic(req, _res, next) {
  if (BASIC_RE.test(req.headers.authorization ?? "")) delete req.headers.authorization;
  next();
}

export default function authGuard() {
  return (req, res, next) => {
    // Automation tokens: the admin API and the /games.json catalog only, acting as the admin who made them.
    if (apiTokens.presented(req)) return tokenLane(req, res, next, clientIp(req));

    // Accounts are managed live from /admin: no accounts means no sign-in wall,
    // except on a fresh install (nothing configured yet), where nothing is served until setup has run.
    if (!users.hasUsers()) return adminAwaitsSetup() ? untilSetup(req, res) : next();

    // An approved console (pairingGate) or a console's session token (sessionGate).
    if (req.pairedDevice || req.sessionLane) return next();

    const ip = clientIp(req);
    const who = req.headers.authorization ? null : webUser(req);
    if (who) {
      req.auth = { user: who.approver };
      req.webUser = who;
      if (who.kind === "password") store.recordAccess(who.name, ip);
      vouch(res);
      return next();
    }
    if (isBrowser(req)) return toLogin(req, res);
    // A link preview (KakaoTalk, Discord, Slack...) asks for the address with Accept: */* and no keys:
    // it goes where a browser goes, to /login, whose head carries the share card.
    if ((req.method === "GET" || req.method === "HEAD") && req.path === "/" && unsignedReason(req) === "no-credentials") {
      res.set("Cache-Control", "no-store");
      return res.redirect(302, "/login?next=%2F");
    }

    if (!trustedHere(req) && store.isLocked(ip)) {
      const lock = store.snapshot().lockouts.find((l) => l.ip === ip);
      return denyResponse(req, res, {
        reason: DENY.IP_LOCKED,
        status: 429,
        retryAfter: lockoutRetryAfter(ip),
        detail: lock?.reason ?? null,
        body: "Locked out after too many failed attempts. Contact the administrator.\n",
      });
    }
    const reason = unsignedReason(req);
    // A wrong key for a console an admin approved: the device key is one this server let in.
    // A pending one proves nothing, since any request with a made-up key queues it.
    noteRefusal(req, res, 401, reason, { proven: reason === "access-key-wrong" });
    res.set("Cache-Control", "no-store");
    res.status(401).type("text/plain").send(`${unauthorizedMessage}\n`);
  };
}

/**
 * Why a request that reached the wall carried nothing it accepts, for the log:
 *   access-key-wrong    an approved console sent a key that is not its own (replaced since)
 *   device-not-approved a console sent a key the server no longer approves, or never did
 *   no-access-key       a device key and no access key, approved or not (an approved
 *                       console that never took its key, or one still waiting)
 *   no-credentials      nothing at all
 */
function unsignedReason(req) {
  const device = deviceKeyFromHeaders(req);
  if (!device) return "no-credentials";
  if (!req.get("X-Access-Key")) return "no-access-key";
  return store.isDeviceApproved(device) ? "access-key-wrong" : "device-not-approved";
}

/** A request from a web browser (consoles and curl send no Sec-Fetch-* or text/html Accept). */
export function isBrowser(req) {
  return Boolean(req.get("sec-fetch-mode")) || /text\/html/.test(req.get("accept") ?? "");
}

/** Pages go to /login and come back; a page's own fetches get a plain 401 (no popup). */
function untilSetup(req, res) {
  res.set("Cache-Control", "no-store");
  if (req.method === "GET" && /text\/html/.test(req.get("accept") ?? "")) return res.redirect(302, "/setup");
  res.status(503).json({ error: "setup-required" });
}

function toLogin(req, res) {
  res.set("Cache-Control", "no-store");
  const navigate = req.method === "GET" && (req.get("sec-fetch-mode") ? req.get("sec-fetch-mode") === "navigate" : /text\/html/.test(req.get("accept") ?? ""));
  if (navigate) return res.redirect(302, `/login?next=${encodeURIComponent(req.originalUrl)}`);
  noteRefusal(req, res, 401, "browser-not-signed-in");
  res.status(401).json({ error: "sign in at /login" });
}

/**
 * COOK_DEVICE_AUTO_APPROVE: a console that knocks on the pairing routes with
 * a real account (Basic) and its device key is approved without a QR scan, and
 * uses its device key and access key from then on. With `all`, every console
 * that asks is let in, no sign-in needed. Returns whether it is approved, or
 * "limit" when the account holds all the consoles it may (device-limit.js)
 * and the console keeps waiting.
 */
export async function autoApproveFromPairRequest(req, deviceKey) {
  if (!devicePairing || !deviceAutoApprove || !deviceKey) return false;
  if (deviceAutoApproveAll && !store.isLocked(clientIp(req))) {
    if (approveSignedInDevice(deviceKey, "auto")) debug.log("pair: auto-approved %s… (all consoles)", deviceKey.slice(0, 12));
    return true;
  }
  const who = await pairSignIn(req);
  if (!who) return false;
  const approved = approveSignedInDevice(deviceKey, who.name);
  if (approved === "limit") {
    debug.log("pair: %s… waits: %s holds all the consoles it may", deviceKey.slice(0, 12), who.name);
    return "limit";
  }
  if (approved) {
    store.recordLogin(who.name, "console", clientIp(req));
    debug.log("pair: auto-approved %s… signed in as %s", deviceKey.slice(0, 12), who.name);
  }
  return true;
}

/**
 * The account a request to the pairing routes signed in with (Basic), or null.
 * The only place a console's ID and password count, and only while automatic
 * approval is on. Checked as the web form checks one, lockout included: a wrong
 * password counts toward it (a console repeating the same stale one while it
 * polls counts once, see repeatedPoll).
 */
export async function pairSignIn(req) {
  if (!devicePairing || !deviceAutoApprove) return null;
  const m = /^Basic\s+(\S+)$/i.exec(req.headers.authorization ?? "");
  if (!m) return null;
  const decoded = Buffer.from(m[1], "base64").toString("utf8");
  const sep = decoded.indexOf(":");
  if (sep < 0) return null;
  const name = decoded.slice(0, sep);
  const password = decoded.slice(sep + 1);
  if (basicRefusal(req)) return null;
  const ip = clientIp(req);
  if (store.isLocked(ip)) return null;
  if (!(await users.verifyAsync(name, password))) {
    if (!trustedHere(req) && !repeatedPoll(ip, req.headers.authorization)) recordFailure(ip, req);
    return null;
  }
  store.clearFailure(ip);
  return { name };
}

// A console polls its pairing status every few seconds with whatever account it
// saved. A stale password would lock the address in seconds, so the same wrong
// credentials from one address count once a window; a new guess still counts.
const POLL_WINDOW_MS = 15 * 60 * 1000;
const POLL_SEEN_MAX = 1000;
const seenPolls = new Map();
export function repeatedPoll(ip, authorization, now = Date.now()) {
  const key = `${ip}\0${crypto.createHash("sha256").update(String(authorization)).digest("hex")}`;
  const last = seenPolls.get(key);
  seenPolls.delete(key);
  seenPolls.set(key, now);
  if (seenPolls.size > POLL_SEEN_MAX) seenPolls.delete(seenPolls.keys().next().value);
  return last !== undefined && now - last < POLL_WINDOW_MS;
}

/** Owner ids are an account name, or "google:<sub>" for a Google admin. */
function ownerIsAdmin(owner) {
  // An ID-and-password admin's tokens stop while ID and password sign-in is off.
  return owner.startsWith("google:") ? googleAccounts.isAdmin(owner.slice(7)) : passwordOwnerOk() && users.isActive(owner) && users.isAdmin(owner);
}

// /mcp the way Express routes it: any case, one optional trailing slash. A miss here would count a valid
// token as a failed login and could lock the caller's address out.
const MCP_PATH = /^\/mcp\/?$/i;

const CATALOG = (p) => p === "/games.json";
// What an automation token may reach: the admin API, its guide, the flat catalog and MCP.
export const TOKEN_PATHS = (p) => p.startsWith("/admin/api/") || p === "/admin/guide.md" || CATALOG(p) || MCP_PATH.test(p);
// A catalog token reads the list and the game files it names ("../<file>" on the origin): nothing under
// /api or /admin, only GET and HEAD.
export const CATALOG_PATHS = (req) => (req.method === "GET" || req.method === "HEAD")
  && (CATALOG(req.path) || (GAME_FILE_RE.test(req.path) && !/^\/(api|admin)(\/|$)/i.test(req.path)));

function tokenLane(req, res, next, ip) {
  if (!trustedHere(req) && store.isLocked(ip)) return tooManyRequests(res, lockoutRetryAfter(ip)).json({ error: "locked out" });
  const token = apiTokens.verify(req.headers.authorization);
  const catalog = apiTokens.scopeOf(token) === "catalog";
  if (!token || !(catalog ? CATALOG_PATHS(req) : TOKEN_PATHS(req.path)) || !ownerIsAdmin(token.owner)) {
    if (!trustedHere(req)) recordFailure(ip, req);
    noteRefusal(req, res, 401, "api-token-invalid");
    return res.status(401).json({ error: "invalid token" });
  }
  req.apiToken = token;
  vouch(res);
  // Never an account: a catalog token reads, it acts as nobody.
  if (catalog) return next();
  if (token.owner.startsWith("google:")) req.webUser = { kind: "google", sub: token.owner.slice(7) };
  else req.auth = { user: token.owner };
  return next();
}

export function recordFailure(ip, req) {
  // Behind an untrusted proxy every client counts toward THIS one counter, so a
  // stranger's typo can lock out the whole household. Surface it before the
  // lockout lands rather than after.
  noteProxyCollapse(req);
  const now = Date.now();
  const prev = store.getFailure(ip) ?? { count: 0, firstAt: now };
  const next = {
    count: prev.count + 1,
    firstAt: prev.firstAt,
    lastAt: now,
    lastPath: req.path,
  };
  store.setFailure(ip, next);
  store.appendAudit({ kind: "auth-fail", ip, path: req.path, at: now, count: next.count });
  debug.log(
    "security: auth failure %d/%d from %s on %s",
    next.count,
    MAX_FAILURES,
    ip,
    req.path
  );
  noteFailure(ip, next.count, req.path, MAX_FAILURES);
  if (next.count >= MAX_FAILURES) {
    store.lock(ip, { reason: "too many failed auth attempts", ttlMs: LOCKOUT_TTL_MS });
    alert("lockout", (t) => t("lockout"), { subject: ip });
    debug.error(
      "security: %s LOCKED OUT after %d failures (ttl=%s)",
      ip,
      next.count,
      LOCKOUT_TTL_MS > 0 ? `${LOCKOUT_TTL_MS}ms` : "forever (admin unlock)"
    );
  }
}
