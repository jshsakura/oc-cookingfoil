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
 * Every response that went through the bucket carries the IETF draft's
 * RateLimit-Limit (the burst), RateLimit-Remaining (whole tokens left) and
 * RateLimit-Reset (seconds until the bucket is full again); proven callers
 * skip the bucket and get none.
 *
 * On exhaustion we 429 with a Retry-After hint and audit the event but
 * don't auto-lock (a noisy client isn't necessarily malicious).
 *
 * Callers who already proved who they are skip the bucket: an approved console
 * (its device key and access key), a signed-in browser, an admin session. The
 * client app pulls a retro base pack as hundreds of small files and a library
 * page as hundreds of icons, and those were being throttled. The check is a
 * hash compare or a cookie unseal, never a password hash, so it costs no more
 * than the bucket itself; strangers still hit the limit.
 */
import debug from "../debug.js";
import * as store from "./store.js";
import { tooManyRequests } from "./retry-after.js";
import { recordDeny, DENY } from "./deny.js";
import { noteProxyCollapse } from "./proxy-check.js";
import { envNumber } from "../helpers/env-read.js";
import { devicePairing } from "../helpers/envs.js";
import { deviceKeyFromHeaders, verifyAccessKey } from "./pairing.js";
import { webUser } from "./user-session.js";
import { hasValidSession } from "./admin-session.js";

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

/** Whether the request already carries proof of who sent it (see the header). */
export function provenCaller(req) {
  if (devicePairing) {
    const deviceKey = deviceKeyFromHeaders(req);
    const hash = deviceKey ? store.getDeviceAccessKeyHash(deviceKey) : null;
    if (hash && verifyAccessKey(req.get("X-Access-Key"), hash)) return true;
  }
  return Boolean(webUser(req)) || hasValidSession(req);
}

export default function rateLimit() {
  return (req, res, next) => {
    if (provenCaller(req)) return next();
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
    const remaining = Math.max(0, Math.floor(b.tokens - 1));
    res.set("RateLimit-Limit", String(BURST));
    res.set("RateLimit-Remaining", String(b.tokens < 1 ? 0 : remaining));
    res.set("RateLimit-Reset", String(Math.max(1, Math.ceil((BURST - Math.max(0, b.tokens - 1)) / REFILL_PER_MS / 1000))));

    if (b.tokens < 1) {
      const waitMs = (1 - b.tokens) / REFILL_PER_MS;
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
      return tooManyRequests(res, waitMs / 1000).type("text/plain").send("Too many requests.");
    }
    b.tokens -= 1;
    next();
  };
}
