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
import { devicePairing, authUsers } from "../helpers/envs.js";
import { deviceKeyFromHeaders } from "./pairing.js";
import { hasValidSession } from "./admin-session.js";

const TRUST_LOOPBACK = process.env.COOK_LOCKOUT_TRUST_LOOPBACK !== "false";

function clientIp(req) {
  return (req.ip || req.socket?.remoteAddress || "").replace(/^::ffff:/, "");
}

function isLoopback(ip) {
  return TRUST_LOOPBACK && (ip === "127.0.0.1" || ip === "::1" || ip === "localhost");
}

export default function deviceContentGuard() {
  // Enforce only when pairing is the sole lane. With basic-auth users present,
  // authGuard covers this surface and we must not double-gate the Tinfoil path.
  const enforced = devicePairing && !authUsers;
  if (!enforced) {
    return (req, res, next) => next();
  }
  return (req, res, next) => {
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
    res.set("Cache-Control", "no-store");
    res
      .status(403)
      .type("text/plain")
      .send("Device not approved. Ask the admin to approve your device key.");
  };
}
