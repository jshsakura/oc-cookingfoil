/**
 * Per-IP token-bucket rate limiter. Pure in-memory, no external store.
 *
 * Defaults:
 *   - COOK_RATE_LIMIT_PER_MIN  (default 240) — generous; Tinfoil walks a lot.
 *   - COOK_RATE_LIMIT_BURST    (default 60)  — concurrent burst capacity.
 *
 * On exhaustion we 429 with a Retry-After hint and audit the event but
 * don't auto-lock (a noisy client isn't necessarily malicious).
 */
import debug from "../debug.js";
import * as store from "./store.js";

const REFILL_PER_MIN = Math.max(1, Number(process.env.COOK_RATE_LIMIT_PER_MIN ?? 240));
const BURST = Math.max(1, Number(process.env.COOK_RATE_LIMIT_BURST ?? 60));
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
      debug.log("security: rate-limited %s (%s)", ip, req.path);
      return res.status(429).type("text/plain").send("Too many requests.");
    }
    b.tokens -= 1;
    next();
  };
}
