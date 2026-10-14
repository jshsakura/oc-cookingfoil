/**
 * Which bytes of a file a link has delivered, so the link closes once all of
 * them have. A response counts only when it finished ('finish', not a cut-off
 * 'close'): a 200 delivers the whole file, a 206 the range in its
 * Content-Range. A console that downloads over several connections keeps its
 * link until the last range lands. Partial coverage lives in memory only; a
 * restart starts the count again, which errs on the side of the console.
 */
const MAX_ENTRIES = 5000;

/** `ranges` (sorted, merged, inclusive) with [start, end] added. Pure. */
export function addRange(ranges, [start, end]) {
  const merged = [];
  let [a, b] = [start, end];
  for (const [s, e] of ranges) {
    if (e + 1 < a) merged.push([s, e]);
    else if (b + 1 < s) {
      merged.push([a, b]);
      [a, b] = [s, e];
    } else {
      [a, b] = [Math.min(a, s), Math.max(b, e)];
    }
  }
  merged.push([a, b]);
  return merged.sort((x, y) => x[0] - y[0]);
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

export function createCoverage({ maxEntries = MAX_ENTRIES } = {}) {
  const partial = new Map(); // sig → { exp, total, ranges }

  function prune(nowMs) {
    for (const [sig, p] of partial) if (p.exp * 1000 < nowMs) partial.delete(sig);
    while (partial.size > maxEntries) partial.delete(partial.keys().next().value);
  }

  return {
    /** Records one finished response; true once the link's whole file has been delivered. */
    add(sig, exp, delivered, nowMs = Date.now()) {
      if (!delivered) return false;
      const prev = partial.get(sig);
      partial.delete(sig);
      if (delivered === "all") return true;
      const ranges = addRange(prev?.total === delivered.total ? prev.ranges : [], delivered.range);
      if (covers(ranges, delivered.total)) return true;
      partial.set(sig, { exp, total: delivered.total, ranges });
      prune(nowMs);
      return false;
    },
    size: () => partial.size,
  };
}
