/**
 * One game, one ROM for arcade sets. FinalBurn Neo's DAT already says which
 * sets are one game (a clone's `cloneof` is its parent); this module reads a
 * set's description tags and picks the set people should see first.
 *
 *   classifySet("Knights of the Round (Japan 911127, B-Board 91634B-2)")
 *     → { region: "jp", translation: false, older: false, content: false, date: 19911127, rev: null, set: null, flags: [], hardware: [] }
 *
 * Preference, first difference wins:
 *   1. it runs: its parent and BIOS zips are in the folder
 *   2. not a bootleg, hack, prototype or demo
 *   3. region: Korea > World > USA > Europe > Japan > Asia > others,
 *      a Korean release before a Korean translation. Only the main region
 *      counts: "(World / USA / Korea)" is a World board, "(Korea?)" none
 *   4. the plain cabinet over a CPS Changer or a 3 / 4 player board,
 *      and the plain release over one tagged adult or uncensored
 *   5. the original over a decrypted or "not encrypted" conversion
 *   6. not "older" / "earlier", then the newest date, the newest revision,
 *      the lowest "set n"
 *   7. the DAT's parent, then the short name
 *
 * Text is never compared: two sets are one game only through the DAT.
 */

export const REGION_ORDER = ["kr", "world", "us", "eu", "jp", "asia", "hisp", "br"];
const REGION_RES = [
  // "Korea?" is the DAT unsure of the region: not a Korean release.
  ["kr", /\bKorea(?!n?\?)|\bKorean\b(?!\?)|Hangul/i],
  ["world", /\bWorld\b/i],
  ["us", /\bUSA?\b|\bAmerica/i],
  ["eu", /\bEurope|\bEuro\b|\bGerman|\bFrance|\bSpain|\bItaly|\bUK\b/i],
  ["jp", /\bJapan/i],
  ["asia", /\bAsia|\bHong Kong|\bTaiwan|\bChina|\bTW\b/i],
  ["hisp", /\bHispanic|\bLatin/i],
  ["br", /\bBrazil/i],
];
const BAD = [["bootleg", /\bbootleg\b/i], ["hack", /\bhack\b/i], ["prototype", /\bprototype\b|\bproto\b|\blocation test\b/i], ["demo", /\bdemo\b/i]];
/** Content tags: the plain release goes first. */
const CONTENT_RE = /\badult\b|\bnude\b|\bnudity\b|\bmature\b|\buncensored\b|\bcensored\b/i;
const HARDWARE = [["cps-changer", /\bCPS Changer\b/i], ["4p", /\b4 ?Players?\b|\b4P\b/i], ["3p", /\b3 ?Players?\b|\b3P\b/i], ["resale", /\bResale\b/i]];
/** Cabinets most people did not play; the plain board goes first. */
const SPECIAL = new Set(["cps-changer", "4p", "3p"]);
export const BAD_FLAGS = BAD.map(([k]) => k);

/** All the parenthesised tags of a description, joined ("Title (Japan 911127) (bootleg)" → "Japan 911127 bootleg"). Pure. */
function tagText(desc) {
  return [...String(desc ?? "").matchAll(/\(([^()]*)\)/g)].map((m) => m[1]).join(" ");
}

/**
 * The text a region is read from: in a list ("World / USA + Canada / Korea")
 * only its first entry, the main region, counts. Pure.
 */
function regionText(desc) {
  const LANGUAGE = /^\s*(?:English|Japanese|Korean|Chinese|Italian|Spanish|French|German)\s*$/i;
  return [...String(desc ?? "").matchAll(/\(([^()]*)\)/g)]
    .map((m) => m[1].split(" / "))
    // A list of languages ("English / Korean") says nothing of where the board was sold.
    .filter((parts) => !(parts.length > 1 && LANGUAGE.test(parts[0])))
    .map((parts) => parts[0]).join(" ");
}

/** A six digit YYMMDD date as YYYYMMDD, or null. Pure. */
function dateOf(text) {
  const m = text.match(/(?:^|[^\d])(\d{2})(\d{2})(\d{2})(?!\d)/);
  if (!m) return null;
  const [yy, mm, dd] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return (yy >= 70 ? 1900 + yy : 2000 + yy) * 10000 + mm * 100 + dd;
}

/** "rev 4" → 4, "Revision B" → 2, "rev. A" → 1; null without one. Pure. */
function revOf(text) {
  const m = text.match(/\brev(?:ision)?\.?\s*([A-Z]|\d+)\b/i);
  if (!m) return null;
  return /^\d+$/.test(m[1]) ? Number(m[1]) : m[1].toUpperCase().charCodeAt(0) - 64;
}

/** What a set's description tags say: region, date, revision, set number, quality flags and cabinet. Pure. */
export function classifySet(desc) {
  const text = tagText(desc);
  const where = regionText(desc);
  const regions = REGION_RES.filter(([, re]) => re.test(where)).map(([k]) => k);
  const set = text.match(/\bset\s*(\d+)\b/i);
  const flags = BAD.filter(([, re]) => re.test(text)).map(([k]) => k);
  if (/\bnot encrypted\b|\bdecrypted\b/i.test(text)) flags.push("decrypted");
  const hardware = HARDWARE.filter(([, re]) => re.test(text)).map(([k]) => k);
  if (/\bNGM-\d+/.test(text)) hardware.push("mvs");
  else if (/\bNGH-\d+/.test(text)) hardware.push("aes");
  // A fan translation ("Korean Translation 911127") is Korean, after a Korean release.
  const translation = /\bTranslation\b/i.test(text);
  return { region: regions[0] ?? null, translation, older: /\bolder\b|\bearlier\b|\bearliest\b/i.test(text), content: CONTENT_RE.test(text), date: dateOf(text), rev: revOf(text), set: set ? Number(set[1]) : null, flags, hardware };
}

/** True for a bootleg, hack, prototype or demo. Pure. */
export const isOdd = (c) => c.flags.some((f) => BAD_FLAGS.includes(f));
const regionRank = (r) => (REGION_ORDER.includes(r) ? REGION_ORDER.indexOf(r) : REGION_ORDER.length);
const special = (c) => c.hardware.filter((h) => SPECIAL.has(h)).length;

/**
 * Orders one group's sets, best first. A member is { short, desc, parent: bool, runnable: bool }.
 * Returns the members with their `class` (classifySet) added. Pure.
 */
export function rankSets(members) {
  const rows = members.map((m) => ({ ...m, class: classifySet(m.desc) }));
  return rows.sort((a, b) =>
    Number(b.runnable !== false) - Number(a.runnable !== false) ||
    Number(isOdd(a.class)) - Number(isOdd(b.class)) ||
    regionRank(a.class.region) - regionRank(b.class.region) ||
    Number(a.class.translation) - Number(b.class.translation) ||
    special(a.class) - special(b.class) ||
    Number(a.class.content) - Number(b.class.content) ||
    Number(a.class.flags.includes("decrypted")) - Number(b.class.flags.includes("decrypted")) ||
    Number(a.class.older) - Number(b.class.older) ||
    (b.class.date ?? 0) - (a.class.date ?? 0) ||
    (b.class.rev ?? 0) - (a.class.rev ?? 0) ||
    (a.class.set ?? 0) - (b.class.set ?? 0) ||
    Number(Boolean(b.parent)) - Number(Boolean(a.parent)) ||
    String(a.short).localeCompare(String(b.short)));
}

const REGION_KO = { kr: "한국판", world: "해외판", us: "북미판", eu: "유럽판", jp: "일본판", asia: "아시아판", hisp: "중남미판", br: "브라질판" };

/** One line on why `best` (the first of rankSets) leads its group, in Korean. Pure. */
export function reasonFor(ranked) {
  const [best, ...rest] = ranked;
  if (!best) return "";
  if (!rest.length) return "하나뿐인 세트입니다";
  if (best.runnable === false) return "돌아가는 세트가 없습니다";
  if (isOdd(best.class)) return "정규 세트가 없어 비정규 세트를 씁니다";
  const label = REGION_KO[best.class.region] ?? (best.parent ? "기본 세트" : "이 세트");
  const sameRegion = rest.filter((r) => r.class.region === best.class.region && !isOdd(r.class));
  const newer = sameRegion.some((r) => (r.class.date ?? 0) < (best.class.date ?? 0) || (r.class.rev ?? 0) < (best.class.rev ?? 0));
  return `${label}${newer ? " 최신 개정" : ""}입니다`;
}
