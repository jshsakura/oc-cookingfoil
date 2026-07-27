/**
 * Per-IP token-bucket rate limiter. Pure in-memory, no external store.
 *
 * Defaults:
 *   - COOK_RATE_LIMIT_PER_MIN  (default 1200 = 20/s)
 *   - COOK_RATE_LIMIT_BURST    (default 300) — concurrent burst capacity.
 *
 * The defaults are sized for what this server actually serves, not for a
 * cautious guess:
 *   - a console install streams a title in 16 MB range requests, so a large
 *     game is hundreds of requests in one sitting;
 *   - the dashboard grid fires one icon request per visible title, which is a
 *     few hundred at once on a real library.
 * The old 240/min + 60 burst throttled both of those, and a throttled range
 * read surfaces on the console as a bare "install failed" with no cause. This
 * limiter exists to blunt floods, not to pace legitimate transfers.
 *
 * On exhaustion we 429 with a Retry-After hint and audit the event but
 * don't auto-lock (a noisy client isn't necessarily malicious).
 */
import debug from "../debug.js";
import * as store from "./store.js";
import { recordDeny, DENY } from "./deny.js";
import { noteProxyCollapse } from "./proxy-check.js";
import { envNumber } from "../helpers/env-read.js";

const REFILL_PER_MIN = envNumber("COOK_RATE_LIMIT_PER_MIN", 1200, { min: 1 });
const BURST = envNumber("COOK_RATE_LIMIT_BURST", 300, { min: 1 });
const REFILL_PER_MS = REFILL_PER_MIN / 60_000;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

const buckets = new Map(); // ip → { tokens, lastRefill, lastSeen }

let sweepTimer = setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000; // forget idle buckets after 30 min
  for (const [ip, b] of buckets) if (b.lastSeen < cutoff) buckets.delete(ip);
}, SWEEP_INTERVAL_MS);
if (sweepTimer.unref) sweepTimer.unref();

function clientIp(req) {
  const raw = req.ip || req.socket?.remoteAddress || "unknown";
  return raw.replace(/^::ffff:/, "");
}

export default function rateLimit() {
  return (req, res, next) => {
    const ip = clientIp(req);
    const now = Date.now();
    let b = buckets.get(ip);
    if (!b) {
      b = { tokens: BURST, lastRefill: now, lastSeen: now };
      buckets.set(ip, b);
    }
    // Refill since last touch.
    const elapsed = now - b.lastRefill;
    if (elapsed > 0) {
      b.tokens = Math.min(BURST, b.tokens + elapsed * REFILL_PER_MS);
      b.lastRefill = now;
    }
    b.lastSeen = now;

    if (b.tokens < 1) {
      const waitMs = (1 - b.tokens) / REFILL_PER_MS;
      res.set("Retry-After", String(Math.ceil(waitMs / 1000)));
      res.set("Cache-Control", "no-store");
      store.appendAudit({ kind: "rate-limited", ip, path: req.path, at: now });
      // If a proxy is folding every client into this one bucket, that — not the
      // limit itself — is the thing to fix. Say which it is on the denial row.
      const shared = noteProxyCollapse(req);
      recordDeny(req, {
        reason: DENY.RATE_LIMITED,
        status: 429,
        detail: shared
          ? "all clients share this bucket — set COOK_TRUST_PROXY=true"
          : `${REFILL_PER_MIN}/min, burst ${BURST}`,
      });
      res.set("X-CookingFoil-Deny", DENY.RATE_LIMITED);
      debug.log("security: rate-limited %s (%s)", ip, req.path);
      return res.status(429).type("text/plain").send("Too many requests.");
    }
    b.tokens -= 1;
    next();
  };
}
