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
import { authUsers, unauthorizedMessage } from "../helpers/envs.js";
import { getUsersFromEnv } from "../authUsersParser.js";
import * as store from "./store.js";

const MAX_FAILURES = Math.max(
  1,
  Number(process.env.COOK_AUTH_MAX_FAILURES ?? 5)
);
const LOCKOUT_TTL_MS = Math.max(
  0,
  Number(process.env.COOK_LOCKOUT_TTL_HOURS ?? 0) * 60 * 60 * 1000
);

function clientIp(req) {
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
const TRUST_LOOPBACK = process.env.COOK_LOCKOUT_TRUST_LOOPBACK !== "false";
function isLoopback(ip) {
  return TRUST_LOOPBACK && (ip === "127.0.0.1" || ip === "::1" || ip === "localhost");
}

export default function authGuard() {
  if (!authUsers) {
    // No AUTH_USERS configured → auth disabled entirely.
    return (req, res, next) => next();
  }

  const users = getUsersFromEnv();
  if (!users) {
    return (req, res, next) => next();
  }

  const basicAuth = expressBasicAuth({
    users,
    unauthorizedResponse: unauthorizedMessage,
    challenge: true,
  });

  return (req, res, next) => {
    const ip = clientIp(req);

    // Loopback bypass — trusted caller, no lockout tracking.
    if (isLoopback(ip)) {
      return basicAuth(req, res, next);
    }

    if (store.isLocked(ip)) {
      const lock = store.snapshot().lockouts.find((l) => l.ip === ip);
      const remaining =
        lock?.until && lock.until > Date.now()
          ? Math.ceil((lock.until - Date.now()) / 1000)
          : null;
      debug.log("security: blocked locked IP %s on %s", ip, req.path);
      res.set("Cache-Control", "no-store");
      if (remaining !== null) res.set("Retry-After", String(remaining));
      res.status(429).type("text/plain").send(
        "Locked out after too many failed attempts. Contact the administrator."
      );
      return;
    }

    // Hook into basic-auth's outcome. express-basic-auth sets req.auth on
    // success; the unauthorizedResponse runs through the middleware tail.
    // We wrap res.status so we can tell when it produces a 401.
    const originalStatus = res.status.bind(res);
    let intercepted = false;
    res.status = (code) => {
      if (code === 401 && !intercepted) {
        intercepted = true;
        recordFailure(ip, req);
      }
      return originalStatus(code);
    };

    basicAuth(req, res, (err) => {
      // If we got here without a 401, auth succeeded — reset counters.
      if (!intercepted && !err) {
        store.clearFailure(ip);
      }
      next(err);
    });
  };
}

function recordFailure(ip, req) {
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
