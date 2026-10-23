/**
 * Title matching shared by the server and the retro scripts: reducing a title
 * to a comparable key and picking the best No-Intro / Redump name for a ROM.
 * Everything here is pure.
 */

/** LaunchBox platform names per system. */
export const PLATFORMS = {
  nes: ["Nintendo Entertainment System", "Nintendo Famicom Disk System"],
  snes: ["Super Nintendo Entertainment System", "Nintendo Satellaview"],
  gb: ["Nintendo Game Boy"],
  gbc: ["Nintendo Game Boy Color"],
  gba: ["Nintendo Game Boy Advance"],
  n64: ["Nintendo 64"],
  nds: ["Nintendo DS"],
  md: ["Sega Genesis"],
  sms: ["Sega Master System"],
  gg: ["Sega Game Gear"],
  segacd: ["Sega CD"],
  saturn: ["Sega Saturn"],
  pce: ["NEC TurboGrafx-16"],
  pcecd: ["NEC TurboGrafx-CD"],
  ps1: ["Sony Playstation"],
  psp: ["Sony PSP"],
  ngp: ["SNK Neo Geo Pocket Color", "SNK Neo Geo Pocket"],
  ws: ["WonderSwan Color", "WonderSwan"],
  arcade: ["Arcade"],
  neocd: ["SNK Neo Geo CD"],
  scummvm: ["ScummVM"],
  "32x": ["Sega 32X"],
  sg: ["Sega SG-1000"],
  a2600: ["Atari 2600"],
  a7800: ["Atari 7800"],
  lynx: ["Atari Lynx"],
  col: ["ColecoVision"],
  videopac: ["Magnavox Odyssey 2"],
  msx: ["Microsoft MSX", "Microsoft MSX2"],
  amstrad: ["Amstrad CPC"],
  c64: ["Commodore 64"],
  zxs: ["Sinclair ZX Spectrum"],
  vb: ["Nintendo Virtual Boy"],
  wsv: ["Watara Supervision"],
  pico8: ["PICO-8"],
};

const REGION_ORDER = ["Japan", "World", "USA", "Europe"];
const ROMAN = { i: "1", ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10" };

/** A title reduced to what matching compares: no tags, accents, punctuation or articles. Pure. */
export function titleKey(raw) {
  let s = String(raw)
    .replace(/\s*[[(][^\])]*[\])]/g, "") // (Japan) (Rev 1) [b] …
    .replace(/_/g, " ") // libretro-thumbnails writes & / : as _
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/^(.*), the\b/, "the $1")
    .replace(/['’`.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  // "&", "and" and the "_" thumbnails write for "&" all mean the same; so does a leading "the".
  s = s.split(" ").map((w) => ROMAN[w] ?? w).filter((w) => w !== "the" && w !== "and").join(" ");
  return s;
}

export const decode = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");

// Only complete metadata groups qualify. A title containing a region word stays a title.
const RELEASE_GROUP = /^(?:(?:USA|Japan|Europe|World|Korea|Asia|Australia|China|Taiwan|Hong Kong|En|Ja|Ko|Fr|De|Es|It|Pt|Zh|Nl|Ru|Sv|No|Da|Fi|Pl|Cs|Hu|El|Tr|Ar|He)(?:\s*,\s*|$))+$/i;
const VERSION_GROUP = /^(?:Rev(?:ision)?\s+[\w.]+|Disc\s+\d+(?:\s+of\s+\d+)?|Track\s+\d+|Beta(?:\s+[\w.]+)?|Proto(?:type)?|Demo|Sample|Unl|Aftermarket|Pirate)$/i;

/** The last balanced top-level parenthesized group, with its opening offset. */
function finalGroup(s) {
  if (!s.endsWith(")")) return null;
  let depth = 0;
  for (let i = s.length - 1; i >= 0; i--) {
    if (s[i] === ")") depth++;
    else if (s[i] === "(" && --depth === 0) return { start: i, text: s.slice(i + 1, -1).trim() };
  }
  return null;
}

/** The English lookup title in a localized ROM stem, or the Latin title itself. Pure. */
export function englishTitle(rom) {
  let bare = String(rom).replace(/(?:\s*\[[^\]]*\])+\s*$/, "").trim();
  let group = finalGroup(bare);
  while (group && (RELEASE_GROUP.test(group.text) || VERSION_GROUP.test(group.text))) {
    bare = bare.slice(0, group.start).trim();
    group = finalGroup(bare);
  }
  // An accented Latin title is already a title. Only a localized prefix introduces an alias.
  if (group && /[^\p{Script=Latin}\p{N}\p{P}\p{S}\s]/u.test(bare.slice(0, group.start))
    && /[A-Za-z]/.test(group.text) && !/[^\p{Script=Latin}\p{N}\p{P}\p{S}\s]/u.test(group.text)) return group.text;
  return bare;
}

/** Rank a No-Intro name: Japanese first, then World, USA, Europe; no revisions or betas. Pure. */
export function regionRank(name) {
  const tags = name.match(/\(([^)]*)\)/g)?.join(" ") ?? "";
  const region = REGION_ORDER.findIndex((r) => tags.includes(r));
  const extra = /\b(Beta|Proto|Demo|Sample|Rev|Alt|Pirate|Hack)\b/.test(tags) ? 10 : 0;
  return (region < 0 ? REGION_ORDER.length : region) + extra;
}

/** The best box art name for `title` among `names`, or null. Pure. */
export function bestMatch(title, names) {
  const key = titleKey(title);
  if (!key) return null;
  const hits = names.filter((n) => titleKey(n) === key);
  if (!hits.length) return null;
  return hits.sort((a, b) => regionRank(a) - regionRank(b) || a.localeCompare(b))[0];
}

// Where a subtitle starts: " - ", ":" or the "_ " libretro-thumbnails writes for ":".
const SUBTITLE_RE = /\s+-\s+|\s*:\s*|_\s+/;

/** A title's key without its subtitle: "Mega Quest - The Lost Ring (USA)" → "mega quest". Pure. */
export function looseKey(raw) {
  return titleKey(String(raw).replace(/\s*[[(][^\])]*[\])]/g, "").split(SUBTITLE_RE)[0]);
}

/**
 * bestMatch over one list of names, keyed once for many titles: exact(title) is
 * bestMatch(title, names); loose(title) compares without subtitles and answers
 * only when every name it finds is the same title (one family), so it never
 * picks between different games. Pure.
 */
export function titleMatcher(names) {
  const byKey = new Map();
  const byLoose = new Map();
  for (const n of names) {
    const key = titleKey(n);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(n);
    const loose = looseKey(n);
    if (!byLoose.has(loose)) byLoose.set(loose, new Set());
    byLoose.get(loose).add(key);
  }
  const best = (key) => [...(byKey.get(key) ?? [])].sort((a, b) => regionRank(a) - regionRank(b) || a.localeCompare(b))[0] ?? null;
  return {
    exact: (title) => best(titleKey(title)),
    loose: (title) => {
      const loose = looseKey(title);
      const families = loose ? byLoose.get(loose) : null;
      return families?.size === 1 ? best([...families][0]) : null;
    },
  };
}
