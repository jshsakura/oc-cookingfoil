/**
 * Which LaunchBox game each retro game is, by the same title matching the
 * ratings use (art/ratings.js gamesFor): a ROM's original No-Intro / Redump
 * title (art-map), else the English title in its file name; an arcade set's
 * MAME name, else its parent's. Everything here is pure.
 */
import path from "path";
import { englishTitle, titleKey } from "../art/titles.js";
import { gamesFor, titleIndex } from "../art/ratings.js";
import { setInfo } from "../arcade.js";
import { withoutTags } from "../sd-names.js";
import { fillFrom, fromLaunchBox, fromMame } from "./fields.js";

/** The name a game's metadata is filed under: "<system>/<ROM name>" (an arcade set's short name). */
export function metaKey(g) {
  if (g.set) return `${g.system}/${g.set}`;
  const first = g.m3u ? g.extras?.[0]?.rel : null;
  return `${g.system}/${first ? path.basename(first, path.extname(first)) : g.name}`;
}

// "한글명 (English) [tags]" names its English title in brackets; a Latin name is its own title.
const latinTitle = (name) => (/[^\p{Script=Latin}\p{N}\p{P}\p{S}\s]/u.test(name) ? englishTitle(withoutTags(name)) : name);

/** The titles a game may go by in LaunchBox, best first. */
export function titlesOf(g, mame = new Map()) {
  const names = g.set
    ? [mame.get(g.set)?.Name, g.cloneOf && mame.get(g.cloneOf)?.Name, setInfo(g.set)?.base]
    : [g.original, latinTitle(g.name)];
  return [...new Set(names.filter((n) => typeof n === "string" && n.trim()))];
}

/** titleKey of every title the games may go by: what readLaunchBoxMeta needs to keep. */
export function wantedKeys(games, mame = new Map()) {
  return new Set(games.flatMap((g) => titlesOf(g, mame).map((t) => titleKey(t.replace(/^WSC?:/, "")))).filter(Boolean));
}

const isRelease = (g) => !g.ReleaseType || g.ReleaseType === "Released";

/** Of several games with one title, the released one with the most votes. */
export function pickGame(found) {
  return [...found].sort((a, b) => Number(isRelease(b)) - Number(isRelease(a))
    || (Number(b.CommunityRatingCount) || 0) - (Number(a.CommunityRatingCount) || 0)
    || Number(a.DatabaseID) - Number(b.DatabaseID))[0] ?? null;
}

/**
 * { "<system>/<ROM>": record } for `games` (the catalog's), from LaunchBox's
 * data and MAME's set table. Games that match nothing are left out.
 */
export function buildMeta(games, data, mame = new Map()) {
  const index = titleIndex(data);
  const out = {};
  for (const g of games) {
    const key = metaKey(g);
    if (out[key]) continue;
    let found = null;
    for (const title of titlesOf(g, mame)) {
      found = pickGame(gamesFor(index, g.system, title));
      if (found) break;
    }
    const lb = found ? fromLaunchBox(found, data.images?.get(found.DatabaseID)) : null;
    // A clone's MAME entry often names little more than the game; its parent's fills in the rest.
    const own = g.set && mame.get(g.set) ? fromMame(mame.get(g.set)) : null;
    const parent = g.cloneOf && mame.get(g.cloneOf) ? fromMame(mame.get(g.cloneOf)) : null;
    const arcade = own || parent ? fillFrom(own ?? parent, own && parent) : null;
    const record = lb ? fillFrom(lb, arcade) : arcade;
    if (record && Object.keys(record).length > 1) out[key] = record;
  }
  return out;
}
