/**
 * How the server sees a retro game across its versions: the name it is shown under, whether a search
 * finds it, its version group and the meta key its details live under. routes/retro.js serves these
 * to consoles; the retro capabilities read them for agents.
 */
import { pick } from "../meta/langs.js";
import * as retroNames from "./names.js";
import * as koMatch from "./ko-match.js";
import * as variantPicks from "./variant-picks.js";
import { groupVisible, representative } from "./variants.js";
import { tagsOf, withoutTags } from "./sd-names.js";
import { editionOf } from "./edition.js";
import { regionOf } from "./arcade.js";
import { metaOwner } from "./meta/detail.js";
import { metaKey } from "./meta/build.js";

export const folded = (s) => String(s ?? "").normalize("NFC").toLowerCase().replace(/\s+/g, "");
/** A game matches on its name in any language, its original title or its file name (sf2.zip). */
export const gameMatches = (g, needle) => [g.name, g.original, g.file, ...Object.values(g.names ?? {}), ...Object.values(retroNames.get(g.id) ?? {}), koMatch.confirmed(g)?.ko]
  .some((s) => s && folded(s).includes(needle));

export function listedGames(cat) {
  const out = [];
  for (const group of cat.groups?.values() ?? []) {
    const rep = representative(group, variantPicks.get(group.id));
    if (groupVisible(rep)) out.push(rep);
  }
  return out;
}

export const groupOf = (cat, g) => cat.groups?.get(g.group) ?? { id: g.group ?? g.id, members: [g] };

/** A game, then its group's representative, then its other versions: whose details it shows. */
export const metaCandidates = (g, rep, group) => [...new Set([g, rep, ...group.members])];

/** The meta key a game's details are read from (its versions share it), so an edit lands where it shows. */
export function retroMetaKey(cat, g) {
  const group = groupOf(cat, g);
  return metaOwner(metaCandidates(g, representative(group, variantPicks.get(group.id)), group))?.key ?? metaKey(g);
}

/** How a game is titled in `lang`: name, names, original, and its tags as variant, edition and region. */
export function titleOf(g, lang) {
  const variant = tagsOf(g.name);
  // A name the admin gave wins, language by language, over the ROM's content hash in the Korean
  // title dictionary, which wins over the file's and the arcade table's.
  const found = koMatch.confirmed(g);
  const own = found ? { ko: found.ko, ...retroNames.get(g.id) } : retroNames.get(g.id);
  const names = own ? { ...(g.names ?? { en: withoutTags(g.name) }), ...own } : g.names;
  // A named game is shown in the page's language, with the English title as its original.
  const localized = names ? pick(names, lang) : null;
  const original = names ? (localized !== names.en ? names.en : null) : g.original;
  // The tags as flags: Korean or not, release or patch, patch version.
  const edition = g.edition ?? editionOf(variant);
  const region = g.region ?? (edition ? "kr" : regionOf(variant));
  return { name: localized ?? withoutTags(g.name), names, original, variant, edition, region };
}
