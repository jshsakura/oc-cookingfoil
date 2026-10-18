/**
 * Detects the "everyone shares one identity" failure.
 *
 * Every per-IP mechanism here — the rate limiter, the lockout counter — keys on
 * req.ip. Behind a reverse proxy with COOK_TRUST_PROXY unset, req.ip is the
 * PROXY's address for every client, so:
 *   - the rate limit becomes a single global budget shared by all clients
 *   - one person's bad password walks everyone toward the same lockout
 *
 * Neither symptom looks like a configuration problem from the outside; they
 * look like the server randomly refusing valid traffic. So we detect the
 * combination (a forwarding header arrived, but we're not trusting it) and say
 * so — in the denial row, in the log, and on the dashboard.
 */
import debug from "../debug.js";
import { trustProxy } from "../helpers/trust-proxy.js";

const TRUST_PROXY = trustProxy !== false;
const FORWARD_HEADERS = ["x-forwarded-for", "x-real-ip", "forwarded"];

let observed = false;

/** True when a forwarding header arrived that we are deliberately ignoring. */
export function isProxyCollapse(req) {
  if (TRUST_PROXY) return false;
  return FORWARD_HEADERS.some((h) => Boolean(req?.get?.(h)));
}

/**
 * Same check, but latches the observation so the dashboard can warn about it
 * even for requests that were served fine. Logs once, not per request.
 */
export function noteProxyCollapse(req) {
  if (!isProxyCollapse(req)) return false;
  if (!observed) {
    observed = true;
    debug.error(
      "security: proxy detected (%s) but COOK_TRUST_PROXY is not true — every client " +
        "shares one rate-limit bucket and one lockout counter",
      FORWARD_HEADERS.find((h) => req?.get?.(h)) ?? "forwarded"
    );
  }
  return true;
}

export function proxyCollapseObserved() {
  return observed;
}

/** Test-only. */
export function resetForTests() {
  observed = false;
}
