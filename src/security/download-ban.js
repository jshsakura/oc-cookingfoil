/**
 * An address that keeps presenting forged or broken links on the download
 * address is shut out for a while: BAD_LIMIT invalid links within BAD_WINDOW_MS
 * blocks every request from it for BAN_MS. Expired links don't count; they
 * are what an honest console holds after a long pause. In memory only, with a
 * bounded table.
 */
export const BAD_LIMIT = 10;
export const BAD_WINDOW_MS = 10 * 60 * 1000;
export const BAN_MS = 30 * 60 * 1000;
const MAX_ADDRESSES = 10_000;

export function createBan({ limit = BAD_LIMIT, windowMs = BAD_WINDOW_MS, banMs = BAN_MS, maxEntries = MAX_ADDRESSES, onBan = () => {} } = {}) {
  const table = new Map(); // ip → { hits: [ms…], until }

  function prune(nowMs) {
    for (const [ip, e] of table) {
      const live = e.until > nowMs || e.hits.some((t) => nowMs - t < windowMs);
      if (!live) table.delete(ip);
    }
    while (table.size > maxEntries) table.delete(table.keys().next().value);
  }

  return {
    isBanned(ip, nowMs = Date.now()) {
      return (table.get(ip)?.until ?? 0) > nowMs;
    },
    /** Counts one invalid link from `ip`; true when that starts a ban. */
    recordBad(ip, nowMs = Date.now()) {
      const prev = table.get(ip);
      const hits = [...(prev?.hits ?? []).filter((t) => nowMs - t < windowMs), nowMs];
      const starts = hits.length >= limit && !((prev?.until ?? 0) > nowMs);
      table.delete(ip);
      table.set(ip, { hits: starts ? [] : hits, until: starts ? nowMs + banMs : prev?.until ?? 0 });
      if (table.size > maxEntries) prune(nowMs);
      if (starts) onBan(ip, hits.length);
      return starts;
    },
    size: () => table.size,
  };
}
