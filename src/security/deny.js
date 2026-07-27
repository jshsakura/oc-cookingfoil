/**
 * The single choke point every refusal goes through.
 *
 * Before this existed, a guard could 403 a request and leave no trace anywhere
 * the operator could see — which is exactly how "Tinfoil just says Complete"
 * became undiagnosable. Now every deny is recorded, labelled, and echoed back
 * on the response.
 */
import * as store from "./store.js";
import { DENY, hintFor } from "./deny-reasons.js";
import debug from "../debug.js";

export { DENY };

export function clientIp(req) {
  const raw = req?.ip || req?.socket?.remoteAddress || "unknown";
  return raw.replace(/^::ffff:/, "");
}

/**
 * Record a refusal. Returns the stored entry so callers can log or assert on it.
 * Never throws — a bookkeeping failure must not turn into a 500.
 */
export function recordDeny(req, { reason, status, deviceKey = null, user = null, detail = null } = {}) {
  const entry = {
    at: Date.now(),
    reason,
    status: status ?? null,
    ip: clientIp(req),
    method: req?.method ?? null,
    path: req?.originalUrl || req?.path || null,
    ua: (req?.get?.("user-agent") || "").slice(0, 120) || null,
    deviceKey,
    user,
    detail,
  };
  try {
    store.recordDenial(entry);
    debug.log("deny: %s %s %s → %s", entry.ip, entry.method, entry.path, reason);
  } catch (err) {
    debug.error("deny: failed to record %s: %s", reason, err?.message);
  }
  return entry;
}

/**
 * Record the refusal AND write the standard response: the reason header plus a
 * plain-text body. Keeps every guard's deny path down to one line.
 */
export function denyResponse(req, res, { reason, status = 403, body, ...rest }) {
  const entry = recordDeny(req, { reason, status, ...rest });
  res.set("Cache-Control", "no-store");
  res.set("X-CookingFoil-Deny", reason);
  res.status(status).type("text/plain").send(body ?? defaultBody(reason));
  return entry;
}

function defaultBody(reason) {
  const hint = hintFor(reason);
  return hint ? `Denied: ${reason}\n${hint}\n` : `Denied: ${reason}\n`;
}
