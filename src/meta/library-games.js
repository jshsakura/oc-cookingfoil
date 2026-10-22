/**
 * The base games in the library, for the admin's game pickers, and searching them by any of their
 * names or their title ID (game-search.js).
 */
import * as shopCache from "./shop-cache.js";
import * as titledbStore from "./titledb-store.js";
import { searchGames } from "./game-search.js";

/** Base games in the library, by name: [{ titleId, name }]. */
export async function libraryGames() {
  await shopCache.get();
  const seen = new Map();
  for (const f of shopCache.files()) {
    if (f.kind !== "base" || !f.baseTitleId || seen.has(f.baseTitleId)) continue;
    seen.set(f.baseTitleId, f.name ?? "");
  }
  return [...seen].map(([titleId, name]) => ({ titleId, name })).sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

/** Library games matching `query` by any name titledb or the admin gave them, or by title ID. */
export async function findLibraryGames(query, { limit } = {}) {
  const games = (await libraryGames()).map((g) => ({ ...g, names: titledbStore.namesOf(g.titleId) }));
  return searchGames(games, query, { limit });
}
