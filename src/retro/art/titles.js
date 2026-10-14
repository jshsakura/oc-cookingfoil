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

/** The English title in a "한글명 (English) [tags]" file name, or the name itself. Pure. */
export function englishTitle(rom) {
  const m = rom.match(/\(([^()]*[A-Za-z][^()]*)\)/);
  return (m ? m[1] : rom).trim();
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
