/**
 * Session lane: a console that signed in once sends `Authorization: Bearer
 * cfs_…` (session-token.js) instead of its password. Run after pairingGate and
 * before authGuard, which it skips for a request it authenticated.
 *
 * A good token signs the request in as the identity it was made for, exactly
 * as the password or access key would have: a shop account sets req.auth, a
 * per-device login also sets req.deviceLogin (and is held to the shop, as in
 * authGuard), a paired console with no account sets req.pairedDevice.
 *
 * Anything else carrying a session token is answered here with 401 and
 * X-CookingFoil-Session saying what the console should do; it never falls
 * through to the Basic challenge:
 *   expired   it ran out (or the key was replaced): sign in again
 *   revoked   the account or console may no longer sign in, its password changed,
 *             a device login moved to another console, or pairing was switched off
 *   invalid   not one of ours, or from another console
 * Only "invalid" is written to the denial log. A locked-out address gets the
 * same 429 as at the sign-in wall. The device key is a header, not a secret:
 * tying a token to it stops casual reuse, and its expiry is what bounds a
 * token taken off the network.
 */
import * as session from "./session-token.js";
import { stillAllowed } from "./link-identity.js";
import { deviceKeyFromHeaders } from "./pairing.js";
import { deviceLoginAllowed } from "./device-login-scope.js";
import * as store from "./store.js";
import { recordDeny, denyResponse, DENY } from "./deny.js";
import { clientIp } from "./auth-guard.js";
import * as deviceLogins from "./device-logins.js";
import { devicePairing } from "../helpers/envs.js";
import { isLoopbackSocket } from "./net.js";
import { trustLoopback } from "./limits.js";
import { lockoutRetryAfter } from "./retry-after.js";

export const SESSION_HEADER = "X-CookingFoil-Session";

function refuse(req, res, verdict) {
  res.set("Cache-Control", "no-store");
  res.set(SESSION_HEADER, verdict);
  if (verdict === "invalid") recordDeny(req, { reason: DENY.SESSION_REFUSED, status: 401, deviceKey: deviceKeyFromHeaders(req) });
  return res.status(401).json({ error: `session ${verdict}` });
}

export default function sessionGate({ now = () => Date.now() } = {}) {
  return (req, res, next) => {
    const token = session.presented(req.headers.authorization);
    if (!token) return next();
    const checked = session.verify(token, now());
    if (checked.verdict !== "ok") return refuse(req, res, checked.verdict);
    const { sub } = checked;
    if (deviceKeyFromHeaders(req) !== sub.dev) return refuse(req, res, "invalid");
    // A locked-out address stays out, session or not (the loopback exemption as in authGuard).
    const ip = clientIp(req);
    if (!(trustLoopback && isLoopbackSocket(req)) && store.isLocked(ip)) {
      return denyResponse(req, res, { reason: DENY.IP_LOCKED, status: 429, retryAfter: lockoutRetryAfter(ip), body: "Locked out after too many failed attempts. Contact the administrator.\n" });
    }
    if (!stillAllowed(sub)) return refuse(req, res, "revoked");
    // A device login's session follows its console lock (rebind moves it); a
    // paired console's needs pairing to still be on.
    if (sub.acct?.kind === "login" && deviceLogins.lockedTo(sub.acct.id) !== sub.dev) return refuse(req, res, "revoked");
    if (!sub.acct && !devicePairing) return refuse(req, res, "revoked");
    req.sessionLane = true;
    store.touchDevice(sub.dev);
    if (!sub.acct) {
      req.pairedDevice = sub.dev;
      return next();
    }
    req.auth = { user: sub.acct.id };
    if (sub.acct.kind === "user") store.recordAccess(sub.acct.id, ip);
    if (sub.acct.kind === "login") {
      if (!deviceLoginAllowed(req)) return denyResponse(req, res, { reason: DENY.DEVICE_LOGIN_SCOPE, status: 403, user: sub.acct.id });
      req.deviceLogin = sub.acct.id;
    }
    next();
  };
}
