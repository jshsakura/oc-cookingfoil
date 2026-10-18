/**
 * The /api/retro/games filters beyond system and search: minRating (0-100),
 * minSize and maxSize (bytes), and bezel=1 for games with their own bezel
 * (every console has a default one, so "has a bezel" alone would keep them all).
 */

/** A non-negative integer query value, or null when absent or malformed. Pure. */
const intParam = (v) => (typeof v === "string" && /^\d+$/.test(v) ? Number(v) : null);

/** The filter for /games' minRating, bezel, minSize and maxSize. Pure. */
export function listFilter(query) {
  const minRating = intParam(query.minRating);
  const minSize = intParam(query.minSize);
  const maxSize = intParam(query.maxSize);
  const ownBezel = query.bezel === "1";
  return (g) =>
    (minRating === null || (g.rating ?? -1) >= minRating) &&
    (minSize === null || g.size >= minSize) &&
    (maxSize === null || g.size <= maxSize) &&
    (!ownBezel || (g.bezel && !g.bezel.generic));
}
