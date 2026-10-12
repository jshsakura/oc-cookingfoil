/**
 * Arcade sets for the FinalBurn Neo core. FBNeo finds a game by its zip's short
 * name (sf2.zip), so the file keeps that name everywhere; what changes is what
 * people see:
 *
 *   name      "스트리트 파이터 II (Street Fighter II: The World Warrior) [World 910522]"
 *   names     { en, ko, ja?, zh? } without the version tag
 *   original  the set's English description, which is also how its thumbnail is named
 *
 * A BIOS set (neogeo.zip, pgm.zip …) is not a game of its own: it is left out of
 * the list and travels with every game that needs it, as does a clone's parent.
 * When a Korean release or translation of a game is in the folder, only that one
 * is listed; its parent still travels with it.
 *
 * The operator can correct or add titles in <retro dir>/arcade-names.json,
 * keyed by short name or English title; it wins over the built-in table:
 *   { "sf2": { "ko": "스트리트 파이터 2" }, "Rygar": { "ko": "아르고스의 전사" } }
 *
 * data/fbneo-arcade.json is built from the FinalBurn Neo DAT and our own
 * translations by scripts/fbneo-arcade.mjs.
 *   sets:  { short name: [description, cloneof|null, romof|null, isBios(1|0)] }
 *   names: { English base title: { ko, ja?, zh? } }
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { editionOf } from "./edition.js";

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), "data", "fbneo-arcade.json");
const MAX_CHAIN = 4;
const KOREAN_RE = /\bKorea|\bKorean\b|Hangul/i; // clone → parent → BIOS is as deep as it goes

let data = null;
const load = () => (data ??= JSON.parse(fs.readFileSync(DATA, "utf8")));

/** "Title (World 910522)" → ["Title", "World 910522"]. Pure. */
export function splitDescription(desc) {
  const m = String(desc).match(/^(.*?)\s*\(([^()]*)\)\s*$/);
  return m ? [m[1].trim(), m[2].trim()] : [String(desc).trim(), null];
}

/** What the DAT knows about a set, or null. `overrides` is the operator's arcade-names.json. */
export function setInfo(shortName, overrides = null) {
  const s = load().sets[String(shortName).toLowerCase()];
  if (!s) return null;
  const [desc, cloneOf, romOf, bios] = s;
  const [base, tag] = splitDescription(desc);
  const parentBase = cloneOf ? splitDescription(load().sets[cloneOf]?.[0] ?? "")[0] : null;
  const short = String(shortName).toLowerCase();
  const pick = (table) => table?.[short] ?? table?.[base] ?? (parentBase ? table?.[parentBase] : null) ?? null;
  const own = pick(overrides);
  const local = { ...(pick(load().names) ?? {}), ...(own && typeof own === "object" ? cleanNames(own) : {}) };
  return { desc, base, tag, cloneOf, romOf, bios: Boolean(bios), names: { en: base, ...local } };
}

/** Only non-empty ko / ja / zh strings from an operator's entry. Pure. */
function cleanNames(entry) {
  return Object.fromEntries(["ko", "ja", "zh"].filter((l) => typeof entry[l] === "string" && entry[l].trim()).map((l) => [l, entry[l].trim().slice(0, 200)]));
}

/** The sets a game loads besides its own: its parent and BIOS, nearest first. */
export function dependencies(shortName) {
  const out = [];
  let info = setInfo(shortName);
  for (let i = 0; info && i < MAX_CHAIN; i++) {
    const next = info.cloneOf ?? info.romOf;
    if (!next || out.includes(next)) break;
    out.push(next);
    info = setInfo(next);
  }
  return out;
}

const REGIONS = [
  ["kr", /\bKorea|\bKorean\b|Hangul/i], ["jp", /\bJapan/i], ["us", /\bUSA?\b|\bAmerica/i],
  ["eu", /\bEurope|\bEuro\b|\bGerman|\bFrance|\bSpain|\bItaly|\bUK\b/i], ["asia", /\bAsia|\bHong Kong|\bTaiwan|\bChina/i],
  ["br", /\bBrazil/i], ["world", /\bWorld\b/i],
];

/** The region a set's version tag names ("World 911202" → "world"), or null. Korean wins over the rest. Pure. */
export function regionOf(tag) {
  return REGIONS.find(([, re]) => re.test(String(tag ?? "")))?.[0] ?? null;
}

/** The name a game is listed under: Korean first with the English title beside it, the version as a tag. Pure. */
export function listedName(info) {
  const ko = info.names.ko;
  const main = ko && ko !== info.base ? `${ko} (${info.base})` : info.base;
  return info.tag ? `${main} [${info.tag}]` : main;
}

/**
 * Applies the DAT to one arcade folder's games (as readGame made them): drops
 * BIOS sets, names the rest, and adds the parent and BIOS zips present in the
 * folder as extras. Unknown zips are left as they are.
 */
export function applyArcade(games, overrides = null) {
  const byName = new Map(games.map((g) => [path.basename(g.rel, path.extname(g.rel)).toLowerCase(), g]));
  // Parents with a Korean version present: listed through that version only.
  const korean = new Set();
  for (const short of byName.keys()) {
    const info = setInfo(short, overrides);
    if (info?.cloneOf && byName.has(info.cloneOf) && KOREAN_RE.test(info.desc)) korean.add(info.cloneOf);
  }
  const out = [];
  for (const [short, g] of byName) {
    const info = setInfo(short, overrides);
    if (!info) { out.push(g); continue; }
    if (info.bios || korean.has(short)) continue;
    const extras = [...g.extras];
    for (const dep of dependencies(short)) {
      const d = byName.get(dep);
      if (d && !extras.some((x) => x.rel === d.rel)) extras.push({ abs: d.abs, rel: d.rel, size: d.fileSize, mtimeMs: d.mtimeMs });
    }
    out.push({
      ...g,
      name: listedName(info),
      names: Object.fromEntries(Object.entries(info.names).filter(([, v]) => v)),
      original: info.desc,
      region: regionOf(info.tag),
      edition: editionOf(info.tag),
      extras,
      size: g.fileSize + extras.reduce((n, x) => n + x.size, 0),
      keepFileName: true,
    });
  }
  return out;
}
