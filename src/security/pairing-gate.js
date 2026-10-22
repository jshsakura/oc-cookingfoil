/**
 * Pairing gate — the DEVICE authentication lane, run just before authGuard.
 *
 * A request that carries an APPROVED (deviceKey + accessKey) pair is
 * authenticated here: we tag `req.pairedDevice` so authGuard lets it through.
 * This is how a console connects with NO password once its key is approved.
 *
 * A deviceKey that is present but NOT approved (or presents a wrong accessKey)
 * is recorded as "pending", so it surfaces in the admin dashboard, and then
 * falls THROUGH to the other lanes (a session token, the web sign-in), which
 * refuse it. Enforcement of the pairing-only case lives in deviceContentGuard.
 *
 * No-op passthrough when COOK_DEVICE_PAIRING is off.
 */
import * as store from "./store.js";
import { recordPending } from "./pending-limit.js";
import { devicePairing } from "../helpers/envs.js";
import { deviceKeyFromHeaders, verifyAccessKey } from "./pairing.js";
import { SESSION_HEADER } from "./session-gate.js";
import { recordDeny, DENY } from "./deny.js";
import { vouch } from "./server-id.js";

export default function pairingGate() {
  if (!devicePairing) {
    return (req, res, next) => next();
  }
  return (req, res, next) => {
    const deviceKey = deviceKeyFromHeaders(req);
    if (!deviceKey) return next(); // browser / script / malformed → the other lanes

    const hash = store.getDeviceAccessKeyHash(deviceKey);
    if (hash && verifyAccessKey(req.get("X-Access-Key"), hash)) {
      req.pairedDevice = deviceKey;
      store.touchDevice(deviceKey);
      vouch(res);
      return next();
    }

    // Known-but-unauthenticated or unknown device → log for the dashboard,
    // then defer to the other lanes. Not a hard refusal, but still worth a
    // denial row: an approved device failing its key is exactly the "why did
    // my console stop working?" case.
    // A request carrying other credentials (a session or API token; a Basic
    // header was already dropped by ignoreBasic) is not asking for QR
    // approval, so it stays out of the queue.
    if (!store.isDeviceApproved(deviceKey)) {
      if (!req.headers.authorization) recordPending(req, deviceKey);
      // A key for a console that is no longer approved: tell it to pair again, as a revoked session is told.
      if (req.get("X-Access-Key") && !req.headers.authorization) res.set(SESSION_HEADER, "revoked");
    } else if (req.get("X-Access-Key")) {
      // Only a key that was presented and is wrong; an approved console that
      // has not received its access key yet sends none.
      recordDeny(req, { reason: DENY.DEVICE_BAD_ACCESS_KEY, status: null, deviceKey });
    }
    next();
  };
}
