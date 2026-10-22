/**
 * The base games in the library, for the admin's game pickers, and searching them by any of their
 * names or their title ID (game-search.js).
 *
 * The search index is built once and kept until something it was built from changes: the library
 * (a new shop build), titledb (a new load) or a game folder (an admin's name). A keystroke in a
 * picker then costs a scan of ready-made strings, not folding every name of every game again.
 */
import * as shopCache from "./shop-cache.js";
import * as titledbStore from "./titledb-store.js";
import * as gameMeta from "./game-meta.js";
import * as gameDescriptions from "./game-descriptions.js";
import { buildIndex, searchIndex } from "./game-search.js";

let kept = null; // { shop, titledbAt, revision, index }

function readLibrary() {
  const seen = new Map();
  for (const f of shopCache.files()) {
    if (f.kind !== "base" || !f.baseTitleId) continue;
    const had = seen.get(f.baseTitleId);
    if (!had) seen.set(f.baseTitleId, { name: f.name ?? "", added: f.mtime ?? 0 });
    else had.added = Math.max(had.added, f.mtime ?? 0);
  }
  const edited = new Set(gameDescriptions.edited());
  return [...seen].map(([titleId, { name, added }]) => ({
    titleId,
    name,
    added,
    edited: edited.has(titleId),
    // The admin's names and titledb's own: renaming a game never hides the name it had.
    names: [...Object.values(titledbStore.namesOf(titleId) ?? {}), ...Object.values(titledbStore.originalNamesOf(titleId) ?? {})],
  }));
}

/** The search index over the library's base games, rebuilt only when its sources changed. */
export async function gameIndex() {
  const shop = await shopCache.get();
  const titledbAt = titledbStore.status().loadedAt?.getTime() ?? 0;
  const revision = gameMeta.revision();
  if (kept && kept.shop === shop && kept.titledbAt === titledbAt && kept.revision === revision) return kept.index;
  const index = buildIndex(readLibrary());
  // Reading the names may load the game folders for the first time: key on what it saw afterwards.
  kept = { shop, titledbAt, revision: gameMeta.revision(), index };
  return index;
}

/** Base games in the library, by name: [{ titleId, name }]. */
export async function libraryGames() {
  return (await gameIndex()).byName.map((g) => ({ titleId: g.titleId, name: g.name }));
}

/** Library games matching `query` by any name titledb or the admin gave them, or by title ID. */
export async function findLibraryGames(query, options = {}) {
  return searchIndex(await gameIndex(), query, options);
}
