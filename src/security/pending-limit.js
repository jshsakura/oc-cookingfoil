/**
 * How many new consoles may join the approval queue, before sign-in.
 *
 * Anyone can knock with a fresh random device key, and each new one used to
 * raise its own approval alert with buttons. So a console that is not waiting
 * yet is let in only:
 *   - PER_IP_MAX times per address within PER_IP_WINDOW_MS; beyond that it is
 *     refused (the pair API answers 429 with Retry-After);
 *   - GLOBAL_MAX times per GLOBAL_WINDOW_MS from everyone together; beyond that
 *     it still waits on the admin page, but no alert is raised for it.
 * A console already waiting is always let through: its own polling never counts.
 * In memory only, with a bounded table.
 */
import * as store from "./store.js";
import { clientIp } from "./deny.js";

export const PER_IP_MAX = 5;
export const PER_IP_WINDOW_MS = 10 * 60 * 1000;
export const GLOBAL_MAX = 30;
export const GLOBAL_WINDOW_MS = 60 * 60 * 1000;
const MAX_ADDRESSES = 10_000;

/**
 * One limiter. `isPending(deviceKey)` says whether a console already waits.
 * `admit(ip, deviceKey, now)` answers { ok: false, retryAfterSec } when the
 * address asked too often, else { ok: true, quiet } (quiet: no alert for it).
 */
export function createPendingLimit({
  perIpMax = PER_IP_MAX, perIpWindowMs = PER_IP_WINDOW_MS, globalMax = GLOBAL_MAX, globalWindowMs = GLOBAL_WINDOW_MS,
  maxAddresses = MAX_ADDRESSES, isPending = store.isDevicePending,
} = {}) {
  const byIp = new Map(); // ip → [ms…], oldest first
  let everyone = []; // ms of each new console, oldest first

  const live = (hits, now, windowMs) => hits.filter((t) => now - t < windowMs);

  function prune(now) {
    for (const [ip, hits] of byIp) {
      const kept = live(hits, now, perIpWindowMs);
      if (kept.length) byIp.set(ip, kept);
      else byIp.delete(ip);
    }
    while (byIp.size > maxAddresses) byIp.delete(byIp.keys().next().value);
  }

  return {
    admit(ip, deviceKey, now = Date.now()) {
      if (isPending(deviceKey)) return { ok: true, quiet: false };
      const mine = live(byIp.get(ip) ?? [], now, perIpWindowMs);
      if (mine.length >= perIpMax) return { ok: false, retryAfterSec: Math.ceil((mine[0] + perIpWindowMs - now) / 1000) };
      byIp.delete(ip);
      byIp.set(ip, [...mine, now]);
      if (byIp.size > maxAddresses) prune(now);
      // Only whether the cap is passed matters, so no more than one past it is kept.
      everyone = [...live(everyone, now, globalWindowMs), now].slice(-(globalMax + 1));
      return { ok: true, quiet: everyone.length > globalMax };
    },
    size: () => byIp.size,
  };
}

let limit = createPendingLimit();

/** Test-only: forget every address and console counted so far. */
export function resetForTests() {
  limit = createPendingLimit();
}

/**
 * Puts a console in the approval queue as store.recordPendingDevice does, within
 * the limits above. Returns { ok: true } when it was recorded (perhaps without
 * an alert), or { ok: false, retryAfterSec } when this address asked too often.
 */
export function recordPending(req, deviceKey, { message } = {}, now = Date.now()) {
  const verdict = limit.admit(clientIp(req), deviceKey, now);
  if (!verdict.ok) return verdict;
  store.recordPendingDevice(deviceKey, { message, quiet: verdict.quiet, from: { ip: clientIp(req), agent: req.get?.("user-agent") ?? req.headers?.["user-agent"] ?? null } });
  return { ok: true };
}
