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
 *   2. a Korean patch, the newest first (its version, then the date in its tags)
 *   3. other Korean files
 *   4. by region: World > USA > Japan > others
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
/** What the representative rule reads of a game: edition, region, version and date. Pure. */
export function traits(g) {
  const tags = tagsOf(g.name);
  const edition = g.edition ?? editionOf(tags);
  return {
    edition,
    region: g.region ?? (edition ? "kr" : regionOf(tags)),
    version: realVersion(edition?.version),
    date: tagDate(tags),
  };
}

const tier = (t) => (t.edition?.source === "official" ? 0 : t.edition?.korean ? 1 : 2);
const regionRank = (r) => (REGION_ORDER.includes(r) ? REGION_ORDER.indexOf(r) : REGION_ORDER.length);

/** Orders two non-arcade versions of one game, the representative first. Pure. */
export function compareTitles(a, b) {
  const [ta, tb] = [traits(a), traits(b)];
  return tier(ta) - tier(tb) ||
    (tier(ta) === 1 ? Number(!(ta.version || ta.date)) - Number(!(tb.version || tb.date)) : 0) ||
    (ta.version && tb.version ? compareVersions(tb.version, ta.version) : 0) ||
    tb.date - ta.date ||
    (tier(ta) === 2 ? regionRank(ta.region) - regionRank(tb.region) : 0) ||
    (b.addedAt ?? 0) - (a.addedAt ?? 0) ||
    String(a.id).localeCompare(String(b.id));
}

/** Why the first of an ordered non-arcade group leads, in Korean. Pure. */
function titleReason(members) {
  if (members.length < 2) return "하나뿐인 판입니다";
  const t = traits(members[0]);
  if (t.edition?.source === "official") return "공식 한국어판입니다";
  if (t.edition?.korean) return t.version || t.date ? "가장 새 한글 패치입니다" : "한글판입니다";
  return { world: "세계판입니다", us: "미국판입니다", jp: "일본판입니다" }[t.region] ?? "가장 새 파일입니다";
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

/** The group's representative: the admin's pick when it is still a member, else the best. */
export function representative(group, pickedId = null) {
  return (pickedId && group.members.find((g) => g.id === pickedId)) || group.members[0];
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
