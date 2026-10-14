/**
 * Which bytes of a file a link has delivered, so the link closes once all of
 * them have: the union of the ranges sent covers 0 … size-1, whatever order
 * they finished in (a console downloads segments in parallel and the tail
 * often lands first). A probe for bytes=0-0 just adds its one byte.
 *
 * A response counts only when it finished ('finish') on a socket that had not
 * failed: a 200 delivers the whole file, a 206 the range in its Content-Range.
 * 'finish' means the bytes were handed to the operating system, not that the
 * console stored them; a connection lost after that still counts, and the
 * console then reads the list again for a fresh link. That is the residual risk.
 *
 * At most MAX_INTERVALS separate ranges are kept per link; a link scattered
 * wider than that is no longer tracked and simply runs out at its expiry.
 * Partial coverage lives in memory only; a restart starts the count again,
 * which errs on the side of the console.
 */
const MAX_ENTRIES = 5000;
export const MAX_INTERVALS = 64;
const UNTRACKED = Object.freeze({ untracked: true });

/** The first index whose interval ends at or after `pos - 1` (it may touch `pos`). Pure. */
function firstTouching(ranges, pos) {
  let lo = 0;
  let hi = ranges.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ranges[mid][1] + 1 < pos) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** `ranges` (sorted, merged, inclusive) with [start, end] merged in, as a new array. Pure. */
export function addRange(ranges, [start, end]) {
  const from = firstTouching(ranges, start);
  let to = from;
  let [a, b] = [start, end];
  while (to < ranges.length && ranges[to][0] <= b + 1) {
    a = Math.min(a, ranges[to][0]);
    b = Math.max(b, ranges[to][1]);
    to++;
  }
  return [...ranges.slice(0, from), [a, b], ...ranges.slice(to)];
}

/** Whether `ranges` cover bytes 0 … total-1. Pure. */
export const covers = (ranges, total) => ranges.length === 1 && ranges[0][0] === 0 && ranges[0][1] >= total - 1;

/** What a finished response delivered: "all", { range, total }, or null. */
export function deliveredBytes(method, status, contentRange) {
  if (method !== "GET") return null;
  if (status === 200) return "all";
  if (status !== 206) return null;
  const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(String(contentRange ?? ""));
  return m ? { range: [Number(m[1]), Number(m[2])], total: Number(m[3]) } : null;
}

export function createCoverage({ maxEntries = MAX_ENTRIES, maxIntervals = MAX_INTERVALS } = {}) {
  const partial = new Map(); // sig → { exp, total, ranges } | UNTRACKED-marked

  function prune(nowMs) {
    for (const [sig, p] of partial) if (p.exp * 1000 < nowMs) partial.delete(sig);
    while (partial.size > maxEntries) partial.delete(partial.keys().next().value);
  }

  function keep(sig, entry, nowMs) {
    partial.set(sig, entry);
    if (partial.size > maxEntries) prune(nowMs);
    return false;
  }

  return {
    /** Records one finished response; true once the link's whole file has been delivered. */
    add(sig, exp, delivered, nowMs = Date.now()) {
      if (!delivered) return false;
      const prev = partial.get(sig);
      if (prev?.untracked) return false;
      partial.delete(sig);
      if (delivered === "all") return true;
      const ranges = addRange(prev?.total === delivered.total ? prev.ranges : [], delivered.range);
      if (covers(ranges, delivered.total)) return true;
      if (ranges.length > maxIntervals) return keep(sig, { ...UNTRACKED, exp }, nowMs);
      return keep(sig, { exp, total: delivered.total, ranges }, nowMs);
    },
    size: () => partial.size,
  };
}
