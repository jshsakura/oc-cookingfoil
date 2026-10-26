/**
 * Admin devices: consoles the admin allowed, on the devices tab, to change item
 * settings (routes/admin-items.js). Every other console only reads the library
 * (admin-only.js); the flag lives on the console's record in store.js and goes
 * with it when the console is revoked.
 */
import * as store from "./store.js";

/**
 * The device key of the console behind `req` when it is an approved admin
 * device, else null. Only a console lane counts: a paired console's access key
 * or session (req.pairedDevice), or a library account's session made on that
 * console (req.sessionDevice, checked against its header in session-gate.js).
 * A browser, even the admin's, is never an admin device.
 */
export function adminDeviceOf(req) {
  const key = req?.pairedDevice ?? (req?.sessionLane ? req.sessionDevice : null);
  return key && store.isDeviceApproved(key) && store.isDeviceAdmin(key) ? key : null;
}
