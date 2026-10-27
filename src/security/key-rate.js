/**
 * A sliding-window count per key (a person, not an address): at most `max` hits within `windowMs`.
 * In memory, with keys that went quiet dropped once the table passes `maxKeys`.
 *
 *   hit(key, now) -> { ok: true } | { ok: false, retryAfterSec }
 */
export function createKeyRate({ max, windowMs, maxKeys = 10_000 }) {
  const hits = new Map(); // key -> [ms…], oldest first

  const prune = (now) => {
    for (const [key, times] of hits) if (!times.length || now - times.at(-1) >= windowMs) hits.delete(key);
  };

  return {
    hit(key, now = Date.now()) {
      const times = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      if (times.length >= max) {
        hits.set(key, times);
        return { ok: false, retryAfterSec: Math.max(1, Math.ceil((times[0] + windowMs - now) / 1000)) };
      }
      times.push(now);
      hits.delete(key);
      hits.set(key, times);
      if (hits.size > maxKeys) prune(now);
      return { ok: true };
    },
  };
}
