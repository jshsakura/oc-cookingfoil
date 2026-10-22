/**
 * How many approved consoles one account may hold (server setting deviceLimit,
 * COOK_DEVICE_LIMIT, default 5; 0 is no limit). It counts every console the
 * account approved, however: a download's key, a QR approval, a sign-in at
 * pairing, or the admin approving a console that came with its download. The
 * markers the server writes for its own approvals ("admin", "auto",
 * "telegram") are no account's and hold no limit. A console already the
 * account's is never counted twice.
 */
import * as store from "./store.js";
import { SYSTEM_APPROVERS } from "./users.js";
import { deviceLimit } from "../helpers/envs.js";
import { apiWord } from "../routes/admin/api-words.js";

/** The limit `owner` is at when approving `deviceKey` would go over it, else 0. */
export function accountFull(owner, deviceKey, limit = deviceLimit) {
  if (!limit || typeof owner !== "string" || !owner || SYSTEM_APPROVERS.has(owner)) return 0;
  if (store.isDeviceApproved(deviceKey) && store.deviceAddedBy(deviceKey) === owner) return 0;
  return store.countDevicesAddedBy(owner) >= limit ? limit : 0;
}

/** 409 { error, code: "device-limit", limit } for an approval refused at the limit, in the request's language. */
export function deviceLimitRefusal(req, res, limit = deviceLimit) {
  res.status(409).json({ error: apiWord(req, "device.limit", { n: limit }), code: "device-limit", limit });
}
