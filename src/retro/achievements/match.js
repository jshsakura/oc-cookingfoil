/**
 * Which RetroAchievements game a ROM is. Its hash first: that is what
 * RetroArch sends, so only a hash match earns achievements on the console.
 * Then its title on the same console, the way the LaunchBox metadata is
 * matched (meta/build.js titlesOf): a Korean-patched ROM hashes differently
 * but is still that game, so its list and the player's progress are shown.
 * Everything here is pure.
 */
import { titleKey } from "../art/titles.js";

// "~Hack~ …", "~Homebrew~ …", "~Prototype~ …" and subsets are other games than the retail one.
const SIDE_GAME_RE = /^~[^~]+~|\[Subset\b/i;

/** { byHash: Map(hash → game), byTitle: Map(titleKey → [game]) } over one console's list. */
export function consoleIndex(list) {
  const byHash = new Map();
  const byTitle = new Map();
  for (const g of list) {
    for (const h of g.hashes ?? []) byHash.set(h, g);
    if (SIDE_GAME_RE.test(g.title)) continue;
    // RetroAchievements writes alternative names after " | ".
    for (const name of g.title.split(" | ")) {
      const key = titleKey(name);
      if (key) byTitle.set(key, [...(byTitle.get(key) ?? []), g]);
    }
  }
  return { byHash, byTitle };
}

/** Of several games with one title, the one with the most achievements, then the lowest id. */
const pick = (found) => [...found].sort((a, b) => b.count - a.count || a.id - b.id)[0];

/** { id, by: "hash" | "title" } for a ROM with `hash` (or null) and the titles it may go by, or null. */
export function matchRom(index, hash, titles) {
  const exact = hash ? index.byHash.get(hash) : null;
  if (exact) return { id: exact.id, by: "hash" };
  for (const title of titles) {
    const found = index.byTitle.get(titleKey(title));
    if (found?.length) return { id: pick(found).id, by: "title" };
  }
  return null;
}
