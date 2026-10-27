/**
 * Korean titles for retro games, from the plugins that provide "names" (OC Retro Database is the
 * recommended one). The server ships no dictionary of its own: with no such plugin on, nothing is named.
 *
 * A plugin's names.json:
 *   systems  { system id: { <SHA-256, first 32 hex>: [ko, en|null, crc32|"", <SHA-1, first 32 hex>|""] } }
 *   titles   { system id: { <normalized English title>: ko } } for names that came without a hash
 *   folders  { system id: libretro folder name } (read and ignored: systems.js owns the folders)
 *
 * Matching, strongest first: SHA-256, SHA-1, CRC-32 (all of the ROM's content),
 * then the title. The first three are exact; a title match is only an estimate
 * and says so in `by`.
 */
import fs from "fs";
import debug from "../debug.js";

/** A plugin's names.json past this size is not read: OC Retro Database's is a few MB. */
export const MAX_PLUGIN_NAMES_BYTES = 32 * 1024 * 1024;

const EMPTY = Object.freeze({ systems: {}, titles: {} });

let override = null; // tests: a whole dictionary in place of the plugins'
let sourceCount = 0;
let sources = () => [];
let loaded = null;
let loadedStamp = "";

/**
 * Where the dictionaries of the plugins that are on and provide "names" are: () -> [{ id, version, file }].
 * Later plugins' rows win over earlier ones for the same hash or title, so turning one on or off changes the
 * names on the next lookup (the retro lists are built again within seconds) with no restart.
 */
export function setNameSources(fn) {
  sources = fn;
  loaded = null;
}

function readPluginNames({ id, file }) {
  try {
    if (fs.statSync(file).size > MAX_PLUGIN_NAMES_BYTES) throw new Error("names.json is too large");
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!raw || typeof raw !== "object" || typeof raw.systems !== "object") throw new Error("names.json has no systems");
    return raw;
  } catch (err) {
    debug.error("retro names: plugin %s: %s", id, err.message);
    return null;
  }
}

/** The plugins' dictionaries laid over `base` in order: a later row wins for the same hash or title. Pure. */
export function layered(base, extras) {
  const out = { systems: {}, titles: {} };
  for (const raw of [base, ...extras]) {
    for (const [system, rows] of Object.entries(raw.systems ?? {})) out.systems[system] = { ...out.systems[system], ...rows };
    for (const [system, rows] of Object.entries(raw.titles ?? {})) out.titles[system] = { ...out.titles[system], ...rows };
  }
  return out;
}

function load() {
  if (override) return override;
  const list = sources();
  const stamp = list.map((s) => `${s.id}@${s.version}`).join(",");
  if (loaded && stamp === loadedStamp) return loaded;
  const extras = list.map(readPluginNames).filter(Boolean);
  sourceCount = extras.length;
  loaded = index(layered(EMPTY, extras));
  loadedStamp = stamp;
  return loaded;
}

/** Swaps in another dictionary of the same shape (tests); null goes back to the plugins'. */
export function useKoreanNames(raw) {
  override = raw ? index(raw) : null;
}

function index(raw) {
  const bySha1 = new Map();
  const byCrc = new Map();
  const byTitle = new Map();
  for (const [system, rows] of Object.entries(raw.systems ?? {})) {
    for (const row of Object.values(rows)) {
      if (row[3]) bySha1.set(`${system}/${row[3]}`, row);
      if (row[2]) byCrc.set(`${system}/${row[2]}`, row);
      if (row[1]) byTitle.set(`${system}/${normalizeTitle(row[1])}`, { ko: row[0], en: row[1] });
    }
  }
  for (const [system, rows] of Object.entries(raw.titles ?? {})) {
    for (const [title, ko] of Object.entries(rows)) if (!byTitle.has(`${system}/${title}`)) byTitle.set(`${system}/${title}`, { ko, en: null });
  }
  return { raw, bySha1, byCrc, byTitle };
}

/** "Metal Slug Advance (Japan) [!]" → "metal slug advance": tags gone, case and punctuation ignored. Pure. */
export function normalizeTitle(title) {
  return String(title ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const hex = (v, n) => (v ? String(v).toLowerCase().slice(0, n) : null);

/** { ko, en, by } for a ROM of `system` found by content hash (`by` is "sha256", "sha1" or "crc32"), or null. */
export function koreanName(system, { sha256 = null, sha1 = null, crc32 = null } = {}) {
  const { raw, bySha1, byCrc } = load();
  const rows = raw.systems?.[system];
  if (!rows) return null;
  const hit =
    (sha256 && rows[hex(sha256, 32)] && ["sha256", rows[hex(sha256, 32)]]) ||
    (sha1 && bySha1.get(`${system}/${hex(sha1, 32)}`) && ["sha1", bySha1.get(`${system}/${hex(sha1, 32)}`)]) ||
    (crc32 && byCrc.get(`${system}/${hex(crc32, 8)}`) && ["crc32", byCrc.get(`${system}/${hex(crc32, 8)}`)]) ||
    null;
  return hit ? { ko: hit[1][0], en: hit[1][1], by: hit[0] } : null;
}

/** An estimate from the English title alone: { ko, en, by: "title" } or null. Never use it to decide a core. */
export function koreanNameByTitle(system, title) {
  const hit = load().byTitle.get(`${system}/${normalizeTitle(title)}`);
  return hit ? { ...hit, by: "title" } : null;
}

/** How many plugins' dictionaries are read now: 0 means no Korean names at all. */
export function koreanNameSources() {
  load();
  return override ? 1 : sourceCount;
}

/** Whether the dictionary holds any name, by hash or by title, for `system`. */
export function koreanNameSystem(system) {
  const { raw } = load();
  return Boolean(raw.systems?.[system] || raw.titles?.[system]);
}

/** Whether some ROM of `system` in the dictionary has this CRC-32 (worth reading the whole file to confirm). */
export function koreanNameCrc(system, crc32) {
  return Boolean(crc32 && load().byCrc.has(`${system}/${hex(crc32, 8)}`));
}
