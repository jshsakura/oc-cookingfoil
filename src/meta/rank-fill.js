/**
 * Every base game gets a rank, so the client's "인기" row shows the whole
 * library. Games the US eShop ranking cannot place (Japan- or Asia-only
 * releases, demos) line up after the last ranked one, newest release first.
 * Pure: returns new items, the inputs stay as they were.
 */
const byRecency = (a, b) =>
  (b.release_date ?? 0) - (a.release_date ?? 0) || String(a.name ?? "").localeCompare(String(b.name ?? ""));

export function fillMissingRanks(items) {
  const isBase = (item) => item.app_type === "base";
  const ranked = items.filter((item) => isBase(item) && item.rank);
  const lowest = ranked.reduce((max, item) => Math.max(max, item.rank), 0);
  const fallback = new Map(
    items.filter((item) => isBase(item) && !item.rank).sort(byRecency).map((item, i) => [item, lowest + i + 1]),
  );
  return items.map((item) => (fallback.has(item) ? { ...item, rank: fallback.get(item) } : item));
}
