/**
 * Recommendations from inside the library: games the account has not taken yet, ranked by how many
 * genres they share with what it wished for and what it sent to its consoles lately. Nothing here
 * leaves the library or reads another account.
 *
 *   basis  "wishlist"  the genres of the account's wishlist
 *          "recent"    the genres of the games it sent to its consoles lately
 *          "genre"     one genre key the person named (genres below)
 *          "mixed"     wishlist and recent together; the default
 *
 * A recent send weighs RECENT_WEIGHT, a wish WISH_WEIGHT. Among equal scores a better review score,
 * then a newer arrival, comes first. With no history to learn from, the answer is the library's
 * best-reviewed newest games and says so (`fallback: true`).
 */
import { gameIndex } from "../meta/library-games.js";
import * as titledbStore from "../meta/titledb-store.js";
import * as wishlist from "../security/wishlist.js";
import * as sendHistory from "../security/send-history.js";
import * as ratings from "../meta/ratings.js";
import { GENRE_LABELS, normalizeGenres } from "../meta/categories.js";

export const BASES = ["mixed", "wishlist", "recent", "genre"];
export const GENRES = Object.keys(GENRE_LABELS);
export const DEFAULT_LIMIT = 5;
export const MAX_LIMIT = 8;
export const WISH_WEIGHT = 2;
export const RECENT_WEIGHT = 3;

/**
 * Pure ranking. `games` is [{ titleId, genres, rating, added }], `weights` a genre → weight map
 * (empty for no history), `taken` the ids to leave out. Returns [{ titleId, shared }] best first.
 */
export function rank(games, { weights, taken, genre = null, limit = DEFAULT_LIMIT }) {
  const scored = games
    .filter((g) => !taken.has(g.titleId) && (!genre || g.genres.includes(genre)))
    .map((g) => ({ g, shared: g.genres.filter((k) => weights.has(k)), match: g.genres.reduce((n, k) => n + (weights.get(k) ?? 0), 0) }))
    .filter((e) => genre || !weights.size || e.match > 0);
  scored.sort((a, b) => b.match - a.match || (b.g.rating ?? -1) - (a.g.rating ?? -1) || b.g.added - a.g.added || (a.g.titleId < b.g.titleId ? -1 : 1));
  return scored.slice(0, limit).map((e) => ({ titleId: e.g.titleId, shared: e.shared }));
}

const genresOf = (titleId) => normalizeGenres(titledbStore.get(titleId)?.category) ?? [];

/** Every game the account already wished for or sent, whichever basis picks the genres. */
const takenBy = (account) => new Set([...wishlist.list(account).map((w) => w.titleId), ...sendHistory.recent(account).map((e) => e.titleId)]);

function profile(account, basis) {
  const wished = basis === "wishlist" || basis === "mixed" ? wishlist.list(account).map((w) => w.titleId) : [];
  const sent = basis === "recent" || basis === "mixed" ? sendHistory.recent(account).map((e) => e.titleId) : [];
  const weights = new Map();
  for (const [ids, w] of [[wished, WISH_WEIGHT], [sent, RECENT_WEIGHT]]) {
    for (const id of ids) for (const k of genresOf(id)) weights.set(k, (weights.get(k) ?? 0) + w);
  }
  return { weights, seeds: wished.length + sent.length };
}

/**
 * Recommendations for `account`: { basis, genre, fallback, items: [{ titleId, shared }] }.
 * Throws an Error with .status 400 for an unknown basis or genre.
 */
export async function recommend(account, { basis = "mixed", genre, limit } = {}) {
  if (!BASES.includes(basis)) throw Object.assign(new Error(`basis is one of ${BASES.join(", ")}`), { status: 400 });
  if (basis === "genre" && !GENRES.includes(genre)) throw Object.assign(new Error(`genre is one of ${GENRES.join(", ")}`), { status: 400 });
  const size = Math.min(MAX_LIMIT, Math.max(1, Number.isInteger(limit) ? limit : DEFAULT_LIMIT));
  const own = basis === "genre" ? { weights: new Map(), seeds: 0 } : profile(account, basis);
  const games = (await gameIndex()).byName.map((g) => ({
    titleId: g.titleId, genres: genresOf(g.titleId), rating: ratings.ratingOf(g.titleId)?.score ?? null, added: g.added ?? 0,
  }));
  const items = rank(games, { weights: own.weights, taken: takenBy(account), genre: basis === "genre" ? genre : null, limit: size });
  return { basis, genre: basis === "genre" ? genre : null, fallback: basis !== "genre" && own.weights.size === 0, items };
}
