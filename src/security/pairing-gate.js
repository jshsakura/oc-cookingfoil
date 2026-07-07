/**
 * Pairing gate — the DEVICE authentication lane, run just before authGuard.
 *
 * A request that carries an APPROVED (deviceKey + accessKey) pair is
 * authenticated here: we tag `req.pairedDevice` so authGuard skips the
 * basic-auth challenge. This is what lets a CyberFoil device connect with NO
 * password once its key is approved.
 *
 * A deviceKey that is present but NOT approved (or presents a wrong accessKey)
 * is recorded as "pending" — so it surfaces in the admin dashboard — and then
 * falls THROUGH to the basic-auth lane. It is never hard-blocked here, so the
 * Tinfoil (basic-auth) path keeps working unchanged. Enforcement of the
 * pairing-only case lives in deviceContentGuard.
 *
 * No-op passthrough when COOK_DEVICE_PAIRING is off.
 */
import * as store from "./store.js";
import { devicePairing } from "../helpers/envs.js";
import { normalizeDeviceKey, verifyAccessKey } from "./pairing.js";

function clientIp(req) {
  return (req.ip || req.socket?.remoteAddress || "").replace(/^::ffff:/, "");
}

export default function pairingGate() {
  if (!devicePairing) {
    return (req, res, next) => next();
  }
  return (req, res, next) => {
    const deviceKey = normalizeDeviceKey(req.get("UID"));
    if (!deviceKey) return next(); // browser / Tinfoil / malformed → basic-auth lane

    const hash = store.getDeviceAccessKeyHash(deviceKey);
    if (hash && verifyAccessKey(req.get("X-Access-Key"), hash)) {
      req.pairedDevice = deviceKey;
      store.recordDeviceSeen(deviceKey, {
        ip: clientIp(req),
        version: req.get("Version") || null,
      });
      return next();
    }

    // Known-but-unauthenticated or unknown device → log for the dashboard,
    // then defer to basic-auth.
    if (!store.isDeviceApproved(deviceKey)) {
      store.recordPendingDevice(deviceKey, {
        ip: clientIp(req),
        version: req.get("Version") || null,
      });
    }
    next();
  };
}
