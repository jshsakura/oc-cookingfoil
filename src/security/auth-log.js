/**
 * One log line for every 401 and 403 the sign-in paths answer, so "the console
 * said 401" can be matched to a reason afterwards:
 *
 *   auth: 401 session-revoked GET /api/shop/sections device=AB12CD34
 *
 * Never a token, key, password or address: the path drops its query (a status
 * poll may carry the device key and pair secret there) and the console shows
 * as the first 8 characters of its device key, as the approval screen does.
 */
import debug from "../debug.js";
import { deviceKeyFromHeaders } from "./pairing.js";

/** The line for a refusal, without the "auth: " prefix. Pure. */
export function refusalLine({ status, reason, method, path, deviceKey }) {
  const where = String(path ?? "").split("?")[0].slice(0, 200);
  const device = deviceKey ? ` device=${deviceKey.slice(0, 8)}` : "";
  return `${status} ${reason} ${method ?? "-"} ${where}${device}`;
}

/** Logs that `req` was answered `status` for `reason`. Never throws. */
export function noteRefusal(req, status, reason) {
  try {
    debug.log("auth: %s", refusalLine({ status, reason, method: req.method, path: req.originalUrl || req.path, deviceKey: deviceKeyFromHeaders(req) }));
  } catch {
    /* logging must not turn a refusal into a 500 */
  }
}
