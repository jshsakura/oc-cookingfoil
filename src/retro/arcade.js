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
 * A parent and its clones are one game (variants.js): which set is listed first
 * is arcade-policy.js's choice, a Korean set before the others.
 *
 * Each set also carries `set` (its short name), `cloneOf` (its parent or null)
 * and `missing`: the parent or BIOS zips it needs that are not in the folder,
 * without which it does not start.
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
const MAX_CHAIN = 4; // clone → parent → BIOS is as deep as it goes

let data = null;
const load = () => (data ??= JSON.parse(fs.readFileSync(DATA, "utf8")));
let clones = null;

/** Every set of one game in the DAT: its parent first, then the parent's clones. */
export function groupSets(shortName) {
  const sets = load().sets;
  const short = String(shortName).toLowerCase();
  const root = sets[short]?.[1] ?? short;
  if (!clones) {
    clones = new Map();
    for (const [s, [, cloneOf]] of Object.entries(sets)) if (cloneOf) clones.set(cloneOf, [...(clones.get(cloneOf) ?? []), s]);
  }
  return sets[root] ? [root, ...(clones.get(root) ?? [])] : [short];
}

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

/**
 * The set whose ROMs a set loads, or null. The DAT's `romof` says it: a clone
 * that carries all its own ROMs (non-merged) has none, so it runs without its
 * parent's zip. Without romof data, a clone loads its parent, as before. Pure.
 */
export function needsOf(info) {
  return info.romOf !== undefined ? info.romOf ?? null : info.cloneOf ?? null;
}

/** The sets a game loads besides its own: its parent and BIOS, nearest first. */
export function dependencies(shortName) {
  const out = [];
  let info = setInfo(shortName);
  for (let i = 0; info && i < MAX_CHAIN; i++) {
    const next = needsOf(info);
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
 * BIOS sets, names the rest, adds the parent and BIOS zips present in the
 * folder as extras and names the ones that are missing. Unknown zips are left
 * as they are.
 */
export function applyArcade(games, overrides = null) {
  const byName = new Map(games.map((g) => [path.basename(g.rel, path.extname(g.rel)).toLowerCase(), g]));
  const out = [];
  for (const [short, g] of byName) {
    const info = setInfo(short, overrides);
    if (!info) { out.push(g); continue; }
    if (info.bios) continue;
    const extras = [...g.extras];
    const deps = dependencies(short);
    for (const dep of deps) {
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
      set: short,
      cloneOf: info.cloneOf,
      missing: deps.filter((d) => !byName.has(d)),
    });
  }
  return out;
}
