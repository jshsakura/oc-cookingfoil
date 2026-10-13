/**
 * What a client shows for a title it doesn't list itself (a patch's or a
 * save's game): the name from titledb, else from the game's own file, the
 * names per shop language, and an icon URL the shop serves.
 */
import * as titledbStore from "./titledb-store.js";
import * as extractedMeta from "./extracted-meta-store.js";
import * as shopCache from "./shop-cache.js";

const FILE_NAME_TAIL_RE = /\s*\[[0-9A-F]{16}\]\[v\d+\]$/i;

/** The name the library shows for a base title (titledb, the file's own, or its file name), or null. */
function libraryName(titleId) {
  const f = shopCache.files().find((x) => x.titleId === titleId && x.kind === "base");
  return f ? String(f.name ?? "").replace(FILE_NAME_TAIL_RE, "") || null : null;
}

/** The game a title id belongs to, { name, names, icon }, or null when nothing knows it. */
export function gameOf(titleId, origin = "") {
  const entry = titledbStore.get(titleId);
  const names = titledbStore.namesOf(titleId);
  const extracted = extractedMeta.get(titleId);
  // A game titledb doesn't know (a port, say) is still named the way the library names it.
  const name = entry?.name || extracted?.name || names?.en || (names && Object.values(names)[0]) || libraryName(titleId);
  if (!name) return null;
  const game = { name, names: names ?? {} };
  // Absolute, like the shop's artwork URLs, so curl-style clients can fetch it with the shop's auth.
  if (entry?.iconUrl || titledbStore.iconsOf(titleId) || extracted?.iconPath) game.icon = `${origin}/api/shop/icon/${titleId}`;
  return game;
}
