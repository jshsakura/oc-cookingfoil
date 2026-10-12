/**
 * Auth guard: wraps express-basic-auth with brute-force lockout.
 *
 * Behaviour:
 *   - 0 → COOK_AUTH_MAX_FAILURES − 1: count up, let the request through to
 *     basic-auth, which 401s the bad password. Each failure is audited.
 *   - At threshold (default 5): IP is locked. Subsequent requests get
 *     a hard 429 with no auth challenge — won't even prompt for credentials.
 *     Lockouts persist (COOK_LOCKOUT_TTL_HOURS=0, default) until an admin
 *     unlocks via POST /api/admin/unlock, OR auto-expire if the env sets
 *     a TTL.
 *
 * Successful auth clears the failure counter for that IP.
 */
import expressBasicAuth from "express-basic-auth";
import debug from "../debug.js";
import { unauthorizedMessage, devicePairing, deviceAutoApprove } from "../helpers/envs.js";
import { approveSignedInDevice } from "./pairing-approve.js";
import * as users from "./users.js";
import * as deviceLogins from "./device-logins.js";
import { deviceLoginAllowed } from "./device-login-scope.js";
import { deviceKeyFromHeaders } from "./pairing.js";
import * as store from "./store.js";
import { recordDeny, denyResponse, DENY } from "./deny.js";
import { noteProxyCollapse } from "./proxy-check.js";
import { isLoopbackIp } from "./net.js";
import { maxAuthFailures as MAX_FAILURES, trustLoopback } from "./limits.js";
import { envNumber } from "../helpers/env-read.js";
import { webUser } from "./user-session.js";
import * as apiTokens from "./api-tokens.js";
import * as googleAccounts from "./google-accounts.js";

const LOCKOUT_TTL_MS = envNumber("COOK_LOCKOUT_TTL_HOURS", 0, { min: 0 }) * 60 * 60 * 1000;

export function clientIp(req) {
  // Prefers req.ip when `trust proxy` is on and an X-Forwarded-For arrived;
  // otherwise the socket address. Strip the leading ::ffff: from
  // IPv4-mapped IPv6 so the IP key matches what an admin would type.
  const raw = req.ip || req.socket?.remoteAddress || "unknown";
  return raw.replace(/^::ffff:/, "");
}

// Loopback callers (you, your dev box, the docker host on bridge mode) are
// inherently trusted — they already have shell access. Excluding them stops
// dev/test setups from locking themselves out on intentional auth failures.
// Override with COOK_LOCKOUT_TRUST_LOOPBACK=false to enforce strictly.
function isLoopback(ip) {
  return trustLoopback && isLoopbackIp(ip);
}

export default function authGuard() {
  const basicAuth = expressBasicAuth({
    authorizer: (name, password, done) =>
      (deviceLogins.has(name) ? deviceLogins.verifyAsync(name, password) : users.verifyAsync(name, password))
        .then((ok) => done(null, ok), done),
    authorizeAsync: true,
    unauthorizedResponse: unauthorizedMessage,
    challenge: true,
  });

  return (req, res, next) => {
    // Accounts are managed live from /admin: no accounts means no password lane.
    if (!users.hasUsers()) return next();

    // Device lane already authenticated this request (CyberFoil pairing) — skip
    // the basic-auth challenge entirely. Set by pairingGate upstream.
    if (req.pairedDevice) return next();

    const ip = clientIp(req);

    // Automation tokens: the admin API only, acting as the admin who made them.
    if (apiTokens.presented(req)) return tokenLane(req, res, next, ip);

    // People in a browser sign in at /login and carry a session cookie; consoles
    // and API clients keep sending Basic. A browser never gets the Basic challenge.
    if (!req.headers.authorization) {
      const who = webUser(req);
      if (who) {
        req.auth = { user: who.approver };
        req.webUser = who;
        if (who.kind === "password") store.recordAccess(who.name, ip);
        return next();
      }
      if (isBrowser(req)) return toLogin(req, res);
    }

    // Loopback bypass — trusted caller, no lockout tracking. Still record
    // access on success so the operator's own sessions show in /admin.
    if (isLoopback(ip)) {
      return basicAuth(req, res, (err) => {
        if (err || !req.auth?.user) return next(err);
        afterSignIn(req, res, next, ip);
      });
    }

    if (store.isLocked(ip)) {
      const lock = store.snapshot().lockouts.find((l) => l.ip === ip);
      const remaining =
        lock?.until && lock.until > Date.now()
          ? Math.ceil((lock.until - Date.now()) / 1000)
          : null;
      if (remaining !== null) res.set("Retry-After", String(remaining));
      denyResponse(req, res, {
        reason: DENY.IP_LOCKED,
        status: 429,
        detail: lock?.reason ?? null,
        body: "Locked out after too many failed attempts. Contact the administrator.\n",
      });
      return;
    }

    // Hook into basic-auth's outcome. express-basic-auth sets req.auth on
    // success; the unauthorizedResponse runs through the middleware tail.
    // We wrap res.status so we can tell when it produces a 401.
    const originalStatus = res.status.bind(res);
    let intercepted = false;
    // No Authorization header is the normal first step of basic auth (the
    // client waits for the 401 challenge before sending credentials), so only
    // a wrong password counts toward the lockout.
    const presentedCredentials = Boolean(req.headers.authorization);
    res.status = (code) => {
      // A browser holding stale Basic credentials still never sees the popup.
      if (code === 401 && isBrowser(req)) res.removeHeader("WWW-Authenticate");
      if (code === 401 && !intercepted && presentedCredentials) {
        intercepted = true;
        // basic-auth owns the body here, so we only tag the response — the
        // reason still reaches the operator via the header + denial log.
        res.set("X-CookingFoil-Deny", DENY.BAD_CREDENTIALS);
        recordDeny(req, {
          reason: DENY.BAD_CREDENTIALS,
          status: 401,
          user: req.auth?.user ?? null,
        });
        recordFailure(ip, req);
      }
      return originalStatus(code);
    };

    basicAuth(req, res, (err) => {
      // If we got here without a 401, auth succeeded — reset counters and
      // record the access for the /admin dashboard.
      if (intercepted || err) return next(err);
      store.clearFailure(ip);
      afterSignIn(req, res, next, ip);
    });
  };
}

/** A request from a web browser (consoles and curl send no Sec-Fetch-* or text/html Accept). */
export function isBrowser(req) {
  return Boolean(req.get("sec-fetch-mode")) || /text\/html/.test(req.get("accept") ?? "");
}

/** Pages go to /login and come back; a page's own fetches get a plain 401 (no popup). */
function toLogin(req, res) {
  res.set("Cache-Control", "no-store");
  const navigate = req.method === "GET" && (req.get("sec-fetch-mode") ? req.get("sec-fetch-mode") === "navigate" : /text\/html/.test(req.get("accept") ?? ""));
  if (navigate) return res.redirect(302, `/login?next=${encodeURIComponent(req.originalUrl)}`);
  res.status(401).json({ error: "sign in at /login" });
}

/**
 * A shop account is recorded for the dashboard. A per-device login is held to
 * the shop's content and to the console it is locked to.
 */
/** COOK_DEVICE_AUTO_APPROVE: a console that signed in is approved without a QR scan. */
function autoApprove(req, name) {
  if (!devicePairing || !deviceAutoApprove) return;
  const deviceKey = deviceKeyFromHeaders(req);
  if (approveSignedInDevice(deviceKey, name)) debug.log("pair: auto-approved %s… signed in as %s", deviceKey.slice(0, 12), name);
}

function afterSignIn(req, res, next, ip) {
  const name = req.auth?.user;
  // A console signing in with a password still counts as seen.
  const seenKey = deviceKeyFromHeaders(req);
  if (seenKey) store.touchDevice(seenKey);
  if (!deviceLogins.has(name)) {
    store.recordAccess(name, ip);
    autoApprove(req, name);
    return next();
  }
  if (!deviceLoginAllowed(req)) {
    return denyResponse(req, res, { reason: DENY.DEVICE_LOGIN_SCOPE, status: 403, user: name });
  }
  const deviceKey = deviceKeyFromHeaders(req);
  if (deviceLogins.claim(name, deviceKey) === "other-console") {
    return denyResponse(req, res, { reason: DENY.DEVICE_LOGIN_OTHER_CONSOLE, status: 403, user: name, deviceKey });
  }
  req.deviceLogin = name;
  autoApprove(req, name);
  // The console signed in with its own login, so it is not waiting for QR approval.
  if (deviceKey && !store.isDeviceApproved(deviceKey)) store.dismissPending(deviceKey);
  next();
}

/**
 * The pairing routes sit outside the sign-in wall, but a console may knock
 * there with its account (Basic) and its device key. With auto-approval on,
 * check those credentials the same way (lockout included) and approve the
 * console, so it never lands in the QR queue. Returns whether it is approved.
 */
export async function autoApproveFromPairRequest(req, deviceKey) {
  if (!devicePairing || !deviceAutoApprove || !deviceKey || !req.headers.authorization) return false;
  const m = /^Basic\s+(\S+)$/i.exec(req.headers.authorization);
  if (!m) return false;
  const decoded = Buffer.from(m[1], "base64").toString("utf8");
  const sep = decoded.indexOf(":");
  if (sep < 0) return false;
  const name = decoded.slice(0, sep);
  const password = decoded.slice(sep + 1);
  const ip = clientIp(req);
  if (store.isLocked(ip)) return false;
  const login = deviceLogins.has(name);
  const ok = await (login ? deviceLogins.verifyAsync(name, password) : users.verifyAsync(name, password));
  if (!ok) {
    if (!isLoopback(ip)) recordFailure(ip, req);
    return false;
  }
  store.clearFailure(ip);
  if (login && deviceLogins.claim(name, deviceKey) === "other-console") return false;
  if (approveSignedInDevice(deviceKey, name)) debug.log("pair: auto-approved %s… signed in as %s", deviceKey.slice(0, 12), name);
  return true;
}

/** Owner ids are an account name, or "google:<sub>" for a Google admin. */
function ownerIsAdmin(owner) {
  return owner.startsWith("google:") ? googleAccounts.isAdmin(owner.slice(7)) : users.isActive(owner) && users.isAdmin(owner);
}

function tokenLane(req, res, next, ip) {
  if (!(trustLoopback && isLoopbackIp(ip)) && store.isLocked(ip)) return res.status(429).json({ error: "locked out" });
  const token = apiTokens.verify(req.headers.authorization);
  if (!token || !(req.path.startsWith("/admin/api/") || req.path === "/admin/guide.md") || !ownerIsAdmin(token.owner)) {
    if (!(trustLoopback && isLoopbackIp(ip))) recordFailure(ip, req);
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
  if (next.count >= MAX_FAILURES) {
    store.lock(ip, { reason: "too many failed auth attempts", ttlMs: LOCKOUT_TTL_MS });
    debug.error(
      "security: %s LOCKED OUT after %d failures (ttl=%s)",
      ip,
      next.count,
      LOCKOUT_TTL_MS > 0 ? `${LOCKOUT_TTL_MS}ms` : "forever (admin unlock)"
    );
  }
}
