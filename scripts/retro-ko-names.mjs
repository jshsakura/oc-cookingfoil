#!/usr/bin/env node
/**
 * Builds src/retro/data/ko-names.json, the bundled Korean title dictionary for
 * retro games.
 *
 *   node scripts/retro-ko-names.mjs <input.json>
 *
 * input.json: { rows: [{ sha256, sha1?, crc32?, system, name }], titles: [{ system, english, name }] }
 *   rows    ROMs whose content hashes are known; "name" is "한글 제목 (English title)" or a bare Korean title
 *   titles  names that came without a hash, matched later by their English title
 * Only what the server needs is kept: per system, the first 32 hex characters of the
 * SHA-256 and SHA-1 and the CRC-32 → Korean and English titles. No ROM data and no
 * file names are kept, and the input is not copied into the repository.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { normalizeTitle, splitName } from "../src/retro/ko-names.js";

const [input] = process.argv.slice(2);
if (!input) {
  console.error("usage: node scripts/retro-ko-names.mjs <input.json>");
  process.exit(2);
}

const KOREAN_RE = /[가-힣]/;
const SKIP_SYSTEMS = new Set(["pico8"]); // not wanted: PICO-8 carts are not a Korean-title matter
// The libretro folder of each system the server has no built-in id for.
const FOLDERS = {
  a2600: "Atari - 2600",
  a7800: "Atari - 7800",
  lynx: "Atari - Lynx",
  col: "Coleco - ColecoVision",
  msx: "Microsoft - MSX",
  sg: "Sega - SG-1000",
  "32x": "Sega - 32X",
  vb: "Nintendo - Virtual Boy",
  wsv: "Watara - Supervision",
  tama: "Bandai - Tamagotchi P1",
  mini: "Nintendo - Pokemon Mini",
  gw: "Nintendo - Game & Watch",
};

const lower = (v, re) => (re.test(String(v ?? "")) ? String(v).toLowerCase() : "");

const { rows = [], titles = [] } = JSON.parse(fs.readFileSync(input, "utf8"));
const systems = {};
const known = new Set(); // "<system>/<normalized English>" covered by a hashed row
let kept = 0;
for (const r of rows) {
  const sha256 = lower(r.sha256, /^[0-9a-f]{64}$/i);
  const [ko, en] = splitName(r.name);
  if (!sha256 || !KOREAN_RE.test(ko) || !r.system || SKIP_SYSTEMS.has(r.system)) continue;
  const bucket = (systems[r.system] ??= {});
  const key = sha256.slice(0, 32);
  if (bucket[key]) continue;
  bucket[key] = [ko, en, lower(r.crc32, /^[0-9a-f]{8}$/i), lower(r.sha1, /^[0-9a-f]{40}$/i).slice(0, 32)];
  if (en) known.add(`${r.system}/${normalizeTitle(en)}`);
  kept++;
}

const byTitle = {};
let keptTitles = 0;
for (const t of titles) {
  const [ko, inner] = splitName(t.name);
  const english = normalizeTitle(t.english || inner);
  if (!english || !KOREAN_RE.test(ko) || !t.system || SKIP_SYSTEMS.has(t.system)) continue;
  if (known.has(`${t.system}/${english}`)) continue;
  const bucket = (byTitle[t.system] ??= {});
  if (bucket[english]) continue;
  bucket[english] = ko;
  keptTitles++;
}

const sortKeys = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));
const sortedSystems = Object.fromEntries(Object.keys(systems).sort().map((id) => [id, sortKeys(systems[id])]));
const sortedTitles = Object.fromEntries(Object.keys(byTitle).sort().map((id) => [id, sortKeys(byTitle[id])]));
const folders = sortKeys(Object.fromEntries(Object.entries(FOLDERS).filter(([id]) => sortedSystems[id] || sortedTitles[id])));
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "retro", "data", "ko-names.json");
fs.writeFileSync(out, JSON.stringify({ source: "game-and-what", count: kept, folders, systems: sortedSystems, titles: sortedTitles }) + "\n");
console.log(`${kept} hashed names in ${Object.keys(sortedSystems).length} systems, ${keptTitles} title-only names -> ${path.relative(process.cwd(), out)}`);
