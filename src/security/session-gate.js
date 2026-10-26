/**
 * Session lane: a console that signed in once sends `Authorization: Bearer
 * cfs_…` (session-token.js) instead of its access key. Run after pairingGate and
 * before authGuard, which it skips for a request it authenticated.
 *
 * A good token signs the request in as the identity it was made for, exactly
 * as the access key would have: a paired console sets req.pairedDevice, and a
 * token made for a library account sets req.auth.
 *
 * Anything else carrying a session token is answered here with 401 and
 * X-CookingFoil-Session saying what the console should do:
 *   expired   it ran out (or the key was replaced): sign in again
 *   revoked   the account or console may no longer sign in, its password changed,
 *             or pairing was switched off
 *   invalid   not one of ours, or from another console
 * Only "invalid" is written to the denial log. A locked-out address gets the
 * same 429 as at the sign-in wall. The device key is a header, not a secret:
 * tying a token to it stops casual reuse, and its expiry is what bounds a
 * token taken off the network.
 */
import * as session from "./session-token.js";
import { stillAllowed } from "./link-identity.js";
import { deviceKeyFromHeaders } from "./pairing.js";
import * as store from "./store.js";
import { recordDeny, denyResponse, DENY } from "./deny.js";
import { clientIp } from "./auth-guard.js";
import { devicePairing } from "../helpers/envs.js";
import { trustedHere } from "./net.js";
import { lockoutRetryAfter } from "./retry-after.js";
import { noteRefusal } from "./auth-log.js";
import { vouch } from "./server-id.js";

export const SESSION_HEADER = "X-CookingFoil-Session";

// `why` names the case in the log line where the verdict alone does not (auth-log.js).
// Only "expired" and "revoked" come from a token whose MAC checked out, so only they name the server.
function refuse(req, res, verdict, why = verdict) {
  noteRefusal(req, res, 401, `session-${why}`, { proven: verdict !== "invalid" });
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
    if (deviceKeyFromHeaders(req) !== sub.dev) return refuse(req, res, "invalid", "other-device");
    // A locked-out address stays out, session or not (the loopback exemption as in authGuard).
    const ip = clientIp(req);
    if (!trustedHere(req) && store.isLocked(ip)) {
      return denyResponse(req, res, { reason: DENY.IP_LOCKED, status: 429, retryAfter: lockoutRetryAfter(ip), body: "Locked out after too many failed attempts. Contact the administrator.\n" });
    }
    if (!stillAllowed(sub)) return refuse(req, res, "revoked");
    // A paired console's session needs pairing to still be on.
    if (!sub.acct && !devicePairing) return refuse(req, res, "revoked", "revoked-pairing-off");
    req.sessionLane = true;
    vouch(res);
    // The console the token was made for, checked against its header above (device-admin.js).
    req.sessionDevice = sub.dev;
    store.touchDevice(sub.dev, ip);
    if (!sub.acct) {
      req.pairedDevice = sub.dev;
      return next();
    }
    req.auth = { user: sub.acct.id };
    store.recordAccess(sub.acct.id, ip);
    next();
  };
}
