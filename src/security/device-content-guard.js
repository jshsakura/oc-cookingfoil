/**
 * deviceContentGuard — locks the shop CONTENT surface (shop.tfl + downloads)
 * to approved devices when pairing is the SOLE lane.
 *
 * It enforces ONLY when COOK_DEVICE_PAIRING is on AND no basic-auth users are
 * configured (COOK_AUTH_USERS empty). In that configuration a stranger who
 * merely knows the URL still can't pull anything — this is the literal
 * "접속정보가 있어도 아무나 못 붙는다" case. When basic-auth users DO exist,
 * authGuard already gates this surface, so this guard stays out of the way.
 *
 * Exemptions: a request already authenticated via the device lane
 * (req.pairedDevice), loopback callers, and the admin dashboard (valid session
 * cookie) preview traffic.
 *
 * Mounted immediately before the shop builder + static file serving, so it
 * never touches /admin, /api/*, or the landing page.
 */
import * as store from "./store.js";
import { devicePairing } from "../helpers/envs.js";
import * as users from "./users.js";
import { deviceKeyFromHeaders } from "./pairing.js";
import { hasValidSession } from "./admin-session.js";
import { denyResponse, clientIp, DENY } from "./deny.js";
import { isLoopbackIp } from "./net.js";
import { trustLoopback } from "./limits.js";

function isLoopback(ip) {
  return trustLoopback && isLoopbackIp(ip);
}

export default function deviceContentGuard() {
  // Enforce only when pairing is the sole lane. With basic-auth users present,
  // authGuard covers this surface and we must not double-gate the Tinfoil path.
  // Accounts change live from /admin, so the decision is made per request.
  if (!devicePairing) {
    return (req, res, next) => next();
  }
  return (req, res, next) => {
    if (users.hasUsers()) return next();
    if (req.pairedDevice) return next();
    if (isLoopback(clientIp(req))) return next();
    if (hasValidSession(req)) return next();

    const deviceKey = deviceKeyFromHeaders(req);
    if (deviceKey && !store.isDeviceApproved(deviceKey)) {
      store.recordPendingDevice(deviceKey, {
        ip: clientIp(req),
        version: req.get("Version") || null,
      });
    }

    // A client with NO device key can never pair — stock Tinfoil is the case
    // that matters. Calling that out separately is what turns a mystery
    // ("download just says Complete") into a one-line dashboard answer.
    if (!deviceKey) {
      return denyResponse(req, res, {
        reason: DENY.NO_DEVICE_KEY,
        status: 403,
        body:
          "This server is in pairing-only mode and your client sent no device key.\n" +
          "Stock Tinfoil cannot pair — the operator must set COOK_AUTH_USERS to enable the password lane.\n",
      });
    }

    return denyResponse(req, res, {
      reason: DENY.DEVICE_NOT_APPROVED,
      status: 403,
      deviceKey,
      body: "Device not approved. Ask the admin to approve your device key.\n",
    });
  };
}
