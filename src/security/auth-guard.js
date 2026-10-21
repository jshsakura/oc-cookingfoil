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
    // Automation tokens: the admin API and the /shop.json catalog only, acting as the admin who made them.
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
      return next();
    }
    if (isBrowser(req)) return toLogin(req, res);

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
    res.set("Cache-Control", "no-store");
    res.status(401).type("text/plain").send(`${unauthorizedMessage}\n`);
  };
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
  res.status(401).json({ error: "sign in at /login" });
}

/**
 * COOK_DEVICE_AUTO_APPROVE: a console that knocks on the pairing routes with
 * a real account (Basic) and its device key is approved without a QR scan, and
 * uses its device key and access key from then on. With `all`, every console
 * that asks is let in, no sign-in needed. Returns whether it is approved.
 */
export async function autoApproveFromPairRequest(req, deviceKey) {
  if (!devicePairing || !deviceAutoApprove || !deviceKey) return false;
  if (deviceAutoApproveAll && !store.isLocked(clientIp(req))) {
    if (approveSignedInDevice(deviceKey, "auto")) debug.log("pair: auto-approved %s… (all consoles)", deviceKey.slice(0, 12));
    return true;
  }
  const who = await pairSignIn(req);
  if (!who) return false;
  if (approveSignedInDevice(deviceKey, who.name)) debug.log("pair: auto-approved %s… signed in as %s", deviceKey.slice(0, 12), who.name);
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

// What an automation token may reach: the admin API, its guide, and the flat catalog.
const TOKEN_PATHS = (p) => p.startsWith("/admin/api/") || p === "/admin/guide.md" || p === "/shop.json";

function tokenLane(req, res, next, ip) {
  if (!trustedHere(req) && store.isLocked(ip)) return tooManyRequests(res, lockoutRetryAfter(ip)).json({ error: "locked out" });
  const token = apiTokens.verify(req.headers.authorization);
  if (!token || !TOKEN_PATHS(req.path) || !ownerIsAdmin(token.owner)) {
    if (!trustedHere(req)) recordFailure(ip, req);
    return res.status(401).json({ error: "invalid token" });
  }
  req.apiToken = token;
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
