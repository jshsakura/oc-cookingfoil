/**
 * Retry-After for every 429. The client pauses its requests (all image
 * requests, from client 0.3.15) for exactly that long, so a 429 without one
 * leaves it guessing and retrying too soon.
 *
 * A lockout says how much of it is left. Lockouts have no end by default
 * (COOK_LOCKOUT_TTL_HOURS=0, until an admin unlocks the address); those get an
 * hour, long enough that a locked console stops knocking, short enough that an
 * unlocked one comes back on its own.
 */
import * as store from "./store.js";

export const LOCKOUT_RETRY_AFTER_SEC = 3600;

/** Sets Retry-After to whole seconds (at least 1) and returns res. */
export function retryAfter(res, seconds) {
  const s = Number.isFinite(seconds) ? Math.max(1, Math.ceil(seconds)) : LOCKOUT_RETRY_AFTER_SEC;
  res.set("Retry-After", String(s));
  return res;
}

/** res.status(429) with Retry-After; chain .json() or .send() as usual. */
export function tooManyRequests(res, seconds) {
  return retryAfter(res, seconds).status(429);
}

/** Seconds left on the address's lockout, or the fallback for one with no end. */
export function lockoutRetryAfter(ip) {
  const ms = store.lockRemainingMs(ip);
  return ms === null ? LOCKOUT_RETRY_AFTER_SEC : ms / 1000;
}
