/**
 * deviceContentGuard locks the shop CONTENT surface (lists + downloads) to
 * approved devices when pairing is the SOLE lane.
 *
 * It enforces ONLY when COOK_DEVICE_PAIRING is on AND no accounts exist
 * (COOK_AUTH_USERS empty, none added on /admin). In that configuration a
 * stranger who merely knows the URL still can't pull anything: the literal
 * "접속정보가 있어도 아무나 못 붙는다" case. When accounts DO exist, authGuard
 * already gates this surface, so this guard stays out of the way.
 *
 * Exemptions: a request already authenticated via the device lane
 * (req.pairedDevice), loopback callers, and the admin dashboard (valid session
 * cookie) preview traffic.
 *
 * Mounted immediately before the shop builder + static file serving, so it
 * never touches /admin, /api/*, or the landing page.
 */
import * as store from "./store.js";
import { recordPending } from "./pending-limit.js";
import { devicePairing } from "../helpers/envs.js";
import * as users from "./users.js";
import { deviceKeyFromHeaders } from "./pairing.js";
import { hasValidSession } from "./admin-session.js";
import { denyResponse, DENY } from "./deny.js";
import { AUTH_HEADER } from "./auth-log.js";
import { trustedHere } from "./net.js";

export default function deviceContentGuard() {
  // Enforce only when pairing is the sole lane. With accounts present,
  // authGuard covers this surface and this guard must not refuse twice.
  // Accounts change live from /admin, so the decision is made per request.
  if (!devicePairing) {
    return (req, res, next) => next();
  }
  return (req, res, next) => {
    if (users.hasUsers()) return next();
    if (req.pairedDevice) return next();
    if (trustedHere(req)) return next();
    if (hasValidSession(req)) return next();

    const deviceKey = deviceKeyFromHeaders(req);
    if (deviceKey && !store.isDeviceApproved(deviceKey)) {
      recordPending(req, deviceKey);
    }

    // A client with NO device key can never pair. Calling that out separately
    // is what turns a mystery ("download just says Complete") into a one-line
    // dashboard answer.
    if (!deviceKey) {
      res.set(AUTH_HEADER, DENY.NO_DEVICE_KEY);
      return denyResponse(req, res, {
        reason: DENY.NO_DEVICE_KEY,
        status: 403,
        body:
          "This server is in pairing-only mode and your client sent no device key.\n" +
          "Connect with the CookingFoil client, which pairs by QR; a password alone opens nothing.\n",
      });
    }

    res.set(AUTH_HEADER, DENY.DEVICE_NOT_APPROVED);
    return denyResponse(req, res, {
      reason: DENY.DEVICE_NOT_APPROVED,
      status: 403,
      deviceKey,
      body: "Device not approved. Ask the admin to approve your device key.\n",
    });
  };
}
