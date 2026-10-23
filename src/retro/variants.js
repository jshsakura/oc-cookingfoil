/**
 * Versions of one game on one system, shown as one card. Every game gets a
 * `group` id; the list shows each group's representative and the other files
 * stay one tap away (and in ?variants=all).
 *
 *   arcade   the FinalBurn Neo parent/clone relation, never the title text;
 *            the representative comes from arcade-policy.js
 *   others   the same title in both languages: "한글명 (English) [patch info]"
 *            with the same 한글명 and the same English part (or the whole name
 *            without tags for an English file), compared without case, spaces
 *            or punctuation. Names that differ in any word stay apart, and so
 *            do "Part.A" / "Part.B" halves.
 *
 * Representative for the others, first difference wins:
 *   1. an official Korean release
 *   2. a Korean patch, a plain translation before a modified one (개조, 핵롬,
 *      이지, hack, mod), then the newest (its version, then the date in its tags)
 *   3. other Korean files
 *   4. by region, from [tags] or No-Intro (tags): World > USA > Japan > others
 *   5. the newest file, then the id
 *
 * The admin can name another representative (variant-picks.js); that wins.
 * A group id is `<system>~<10 hex>` of what grouped it, so it survives rescans
 * and does not look like a game id. Game ids never change.
 */
import crypto from "crypto";
import { editionOf } from "./edition.js";
import { regionOf } from "./arcade.js";
import { lastGroup, tagsOf, withoutTags } from "./sd-names.js";
import { rankSets, reasonFor, classifySet, isOdd } from "./arcade-policy.js";

const NON_ASCII_RE = /[^\x20-\x7e]/;
const REGION_TAIL_RE = /\s*\((?:[^()]*\b(?:USA|Japan|Europe|World|Korea|Asia|En|Ja|Rev \w+)\b[^()]*)\)\s*$/i;

/** The English title a retro file name carries, without tags. Pure. */
export function englishTitle(name, names = null) {
  const bare = withoutTags(name);
  if (NON_ASCII_RE.test(bare)) {
    const inner = lastGroup(bare);
    if (inner && /[A-Za-z]/.test(inner) && !NON_ASCII_RE.test(inner)) return inner.trim();
    return names?.en ?? bare;
  }
  // A No-Intro style name keeps its title; its region tags go.
  let t = bare;
  while (REGION_TAIL_RE.test(t)) t = t.replace(REGION_TAIL_RE, "");
  return t.trim() || bare;
}

/** The title before "(English)" in a "한글명 (English)" name; empty for an all-English name. Pure. */
export function localTitle(name) {
  const bare = withoutTags(name);
  if (!NON_ASCII_RE.test(bare)) return "";
  const inner = lastGroup(bare);
  return inner ? bare.slice(0, bare.lastIndexOf(`(${inner})`)).trim() : bare;
}

/** A title compared without case, spaces or punctuation ("Super Shinobi II, The" → "supershinobiiithe"). Pure. */
export function titleKey(title) {
  return String(title ?? "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

const PART_RE = /\b(?:Part|Side)[.\s]*([A-Z0-9]+)\b/i;
const hash = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 10);

/** What puts a game in its group: its FBNeo parent for arcade, its English title otherwise. Pure. */
export function groupKey(g) {
  if (g.set) return `set:${g.cloneOf ?? g.set}`;
  if (g.keepFileName || g.core === "fbneo") return `file:${g.file}`;
  // Both titles must agree: romhacks share the English title but not the Korean one
  // ("포켓몬스터 - 금" and "포켓몬스터 - 금 moe" are two games).
  const en = titleKey(englishTitle(g.name, g.names));
  const key = en && `${en}\0${titleKey(localTitle(g.name))}`;
  // "Part.A" and "Part.B" of one patch are two halves of the game, not two versions.
  const part = String(tagsOf(g.name) ?? "").match(PART_RE);
  return key ? `title:${key}${part ? `\0part:${part[1].toLowerCase()}` : ""}` : `file:${g.rel ?? g.file}`;
}

export const groupIdOf = (g) => `${g.system}~${hash(`${g.system}\0${groupKey(g)}`)}`;

/** A patch version as numbers and letters, compared part by part ("v0.99b" > "v0.99"). Pure. */
export function compareVersions(a, b) {
  const parts = (v) => String(v).replace(/^v/i, "").split(/[.\-_]/).map((p) => {
    const m = p.match(/^(\d*)(.*)$/);
    return [m[1] === "" ? -1 : Number(m[1]), m[2]];
  });
  const [pa, pb] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const [na, sa] = pa[i] ?? [-1, ""];
    const [nb, sb] = pb[i] ?? [-1, ""];
    if (na !== nb) return na - nb;
    if (sa !== sb) return sa.localeCompare(sb);
  }
  return 0;
}

const DATE_RE = /(?:^|[^\d])v?((?:19|20)\d{2})(\d{2})(\d{2})(?!\d)/;
/** A version that is really a date (v20260611) says nothing a date doesn't. Pure. */
const realVersion = (v) => (v && !DATE_RE.test(` ${v}`) ? v : null);
/** The YYYYMMDD date in a game's tags, or 0. Pure. */
export function tagDate(tags) {
  const m = String(tags ?? "").match(DATE_RE);
  return m ? Number(`${m[1]}${m[2]}${m[3]}`) : 0;
}

const REGION_ORDER = ["world", "us", "jp"];
const NO_INTRO_REGIONS = [["kr", /\bKorea\b/i], ["world", /\bWorld\b/i], ["us", /\bUSA\b|\bU\.S\.A\b/i], ["jp", /\bJapan\b/i], ["eu", /\bEurope\b/i]];

/** The No-Intro region groups a name ends in ("Tetris (USA, Europe) (Rev 1)" → "USA, Europe Rev 1"), or "". Pure. */
export function noIntroTags(name) {
  let bare = withoutTags(name);
  const found = [];
  while (REGION_TAIL_RE.test(bare)) {
    found.unshift(bare.match(REGION_TAIL_RE)[0].trim().slice(1, -1));
    bare = bare.replace(REGION_TAIL_RE, "");
  }
  return found.join(" ");
}

/** The best region a No-Intro name names: Korea, World, USA, Japan, Europe; null for none. Pure. */
function noIntroRegion(name) {
  const text = noIntroTags(name);
  return NO_INTRO_REGIONS.find(([, re]) => re.test(text))?.[0] ?? null;
}

// A patch that changes the game (difficulty, a romhack, an "Excel" mod) comes after a plain translation.
const MODIFIED_RE = /개조|핵롬|핵(?:\s|$)|(?:^|[\s._-])(?:이지|easy)|\bhack\b|\bmod\b/i;

/** What the representative rule reads of a game: edition, region, version, date and whether it is a modified patch. Pure. */
export function traits(g) {
  const tags = tagsOf(g.name);
  // An official release can also be named the No-Intro way: "Game (Korea)".
  const edition = g.edition ?? editionOf(tags) ?? (noIntroRegion(g.name) === "kr" ? editionOf("Korea") : null);
  return {
    edition,
    region: g.region ?? (edition ? "kr" : regionOf(tags) ?? noIntroRegion(g.name)),
    version: realVersion(edition?.version),
    date: tagDate(tags),
    modified: MODIFIED_RE.test(tags ?? ""),
  };
}

const tier = (t) => (t.edition?.source === "official" ? 0 : t.edition?.korean ? 1 : 2);
const regionRank = (r) => (REGION_ORDER.includes(r) ? REGION_ORDER.indexOf(r) : REGION_ORDER.length);

/** Orders two non-arcade versions of one game, the representative first. Pure. */
export function compareTitles(a, b) {
  const [ta, tb] = [traits(a), traits(b)];
  return tier(ta) - tier(tb) ||
    Number(ta.modified) - Number(tb.modified) ||
    (tier(ta) === 1 ? Number(!(ta.version || ta.date)) - Number(!(tb.version || tb.date)) : 0) ||
    (ta.version && tb.version ? compareVersions(tb.version, ta.version) : 0) ||
    tb.date - ta.date ||
    (tier(ta) === 2 ? regionRank(ta.region) - regionRank(tb.region) : 0) ||
    (b.addedAt ?? 0) - (a.addedAt ?? 0) ||
    String(a.id).localeCompare(String(b.id));
}

/** Why the first of an ordered non-arcade group leads, as { code } for retro-messages.js. Pure. */
function titleReason(members) {
  if (members.length < 2) return { code: "variant.only" };
  const t = traits(members[0]);
  if (t.edition?.source === "official") return { code: "variant.official" };
  if (t.edition?.korean) return { code: t.version || t.date ? "variant.newestPatch" : "variant.korean" };
  return { code: ["world", "us", "jp"].includes(t.region) ? `variant.${t.region}` : "variant.newest" };
}

/** An arcade game as arcade-policy.js reads it. */
const asSet = (g) => ({ short: g.set ?? g.file, desc: g.original ?? g.name, parent: !g.cloneOf, runnable: !g.missing?.length, g });

/**
 * Puts every game in a group (sets `g.group`) and returns the groups,
 * id → { id, system, kind: "arcade"|"title", members (best first), reason, classes? }.
 */
export function buildGroups(games) {
  const byId = new Map();
  for (const g of games) {
    const id = groupIdOf(g);
    g.group = id;
    if (!byId.has(id)) byId.set(id, { id, system: g.system, kind: g.set ? "arcade" : "title", members: [] });
    byId.get(id).members.push(g);
  }
  for (const group of byId.values()) {
    if (group.kind === "arcade") {
      const ranked = rankSets(group.members.map(asSet));
      group.members = ranked.map((r) => r.g);
      group.classes = new Map(ranked.map((r) => [r.g.id, r.class]));
      group.reason = reasonFor(ranked);
    } else {
      group.members.sort(compareTitles);
      group.reason = titleReason(group.members);
    }
  }
  return byId;
}

/** The group's representative: the admin's pick while it is a member that runs, else the best. */
export function representative(group, pickedId = null) {
  const picked = pickedId && group.members.find((g) => g.id === pickedId);
  // A pick that can't run (its parent zip went away since) would hide the whole group.
  return picked && !picked.missing?.length ? picked : group.members[0];
}

/** Why a set is left out of the list by default, or null: it cannot run, or it is a bootleg, hack, prototype or demo. */
export function hiddenClass(g, cls = g.original ? classifySet(g.original) : null) {
  if (g.missing?.length) return "missing";
  if (cls && isOdd(cls)) return cls.flags.find((f) => f !== "decrypted");
  return null;
}

/**
 * Whether a group shows in the list by default: its representative runs.
 * A group whose only sets are bootlegs or hacks still shows; it is all there is.
 */
export function groupVisible(rep) {
  return !rep.missing?.length;
}
