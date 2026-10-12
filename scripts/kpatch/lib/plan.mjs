// Undated posts (members-only boards) sort before every dated one.
const dateKey = (it) => it.date ?? "";

/** One post per game: the newest. Posts without a title id are all kept for review. Pure. */
export function latestPerTitle(items) {
  const best = new Map();
  const loose = [];
  for (const it of items) {
    if (!it.tid) loose.push(it);
    else if (!best.has(it.tid) || dateKey(it) > dateKey(best.get(it.tid))) best.set(it.tid, it);
  }
  return [...best.values(), ...loose];
}

/**
 * What to do with a resolved patch, given what is already in the patch folder.
 * A patch this tool installed is replaced when its download moved: a
 * pixeldrain or Drive link is one file, and a GitHub release link carries its
 * tag, so a new version always comes with a new link. One a person put there
 * is left alone unless `force`. Pure.
 */
export function decide(item, { exists, tracked }, { force = false } = {}) {
  if (!exists) return "install";
  if (!tracked) return force ? "replace" : "exists-manual";
  return tracked.sourceUrl === item.sourceUrl ? "skip" : "replace";
}
