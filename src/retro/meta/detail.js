/**
 * What a retro game's own reply adds from the collected metadata. Versions of
 * one game share it: the game's own record first, then its group's
 * representative's, then any other version's. Reads only memory and the
 * screenshot folder; never the network.
 */
import { metaKey } from "./build.js";
import { detailFields } from "./fields.js";
import { shotFile, shotUrls } from "./screenshots.js";
import * as store from "./store.js";
import * as edits from "./edits.js";

const useful = (r) => Boolean(r) && !r.miss;

/** { game, key, record } of the first of `games` with a record, or null. */
export function metaOwner(games) {
  for (const g of games) {
    const key = metaKey(g);
    const record = edits.applyEdit(store.get(key), edits.get(key));
    if (useful(record)) return { game: g, key, record };
  }
  return null;
}

/** The detail fields for a game, `candidates` being it and its versions in order of preference. */
export function retroDetailFields({ dir, systems, candidates, base, lang }) {
  const owner = metaOwner(candidates);
  if (!owner) return {};
  return detailFields(owner.record, lang, shotUrls(dir, systems[owner.game.system], owner.key, base));
}

/** The file of screenshot `n` of a game (by the same owner as its detail), or null. */
export function retroShotFile({ dir, systems, candidates, n }) {
  const owner = metaOwner(candidates);
  return owner ? shotFile(dir, systems[owner.game.system], owner.key, n) : null;
}
