/**
 * Korean titles for retro games that ship with the server, so a fresh install
 * can name a Korean ROM without anything imported.
 *
 * data/ko-names.json is built by scripts/retro-ko-names.mjs:
 *   folders  { system id: libretro folder name } for the systems that came after the first ones (systems.js folder)
 *   systems  { system id: { <SHA-256, first 32 hex>: [ko, en|null, crc32|"", <SHA-1, first 32 hex>|""] } }
 *   titles   { system id: { <normalized English title>: ko } } for names that came without a hash
 *
 * Matching, strongest first: SHA-256, SHA-1, CRC-32 (all of the ROM's content),
 * then the title. The first three are exact; a title match is only an estimate
 * and says so in `by`.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dataDir } from "../helpers/envs.js";

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), "data", "ko-names.json");

const LOCAL = path.join(dataDir, "retro-ko-names.json");
let bundled = null;
let loaded = null;
let localStamp = null;
let localRaw = null;
let manual = null;

function validLocal(raw) {
  const object = (v) => v && typeof v === "object" && !Array.isArray(v);
  if (!object(raw) || !object(raw.systems ?? {}) || !object(raw.titles ?? {}) || !object(raw.folders ?? {})) return false;
  for (const [system, rows] of Object.entries(raw.systems ?? {})) {
    if (!/^[a-z0-9]{1,16}$/.test(system) || !object(rows)) return false;
    for (const [hash, row] of Object.entries(rows)) {
      if (!/^[0-9a-f]{32}$/i.test(hash) || !Array.isArray(row) || row.length !== 4 || typeof row[0] !== "string"
        || !(row[1] === null || typeof row[1] === "string") || typeof row[2] !== "string" || typeof row[3] !== "string"
        || !/^(?:[0-9a-f]{8})?$/i.test(row[2]) || !/^(?:[0-9a-f]{32})?$/i.test(row[3])) return false;
    }
  }
  for (const [system, rows] of Object.entries(raw.titles ?? {})) {
    if (!/^[a-z0-9]{1,16}$/.test(system) || !object(rows) || Object.values(rows).some((v) => typeof v !== "string")) return false;
  }
  return Object.values(raw.folders ?? {}).every((v) => typeof v === "string");
}

function load() {
  if (manual) return manual;
  bundled ??= JSON.parse(fs.readFileSync(DATA, "utf8"));
  let stamp = null;
  try {
    const st = fs.statSync(LOCAL, { bigint: true });
    stamp = [st.dev, st.ino, st.size, st.mtimeNs, st.ctimeNs].join(":");
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  if (!loaded || stamp !== localStamp) {
    if (stamp === null) localRaw = null;
    else {
      try {
        const next = JSON.parse(fs.readFileSync(LOCAL, "utf8"));
        // A partial hand edit keeps the last complete dictionary until the next file change.
        if (validLocal(next)) localRaw = next;
      } catch (err) {
        if (!(err instanceof SyntaxError)) throw err;
      }
    }
    const systems = { ...bundled.systems };
    const titles = { ...bundled.titles };
    for (const [system, rows] of Object.entries(localRaw?.systems ?? {})) {
      const normalized = Object.fromEntries(Object.entries(rows).map(([hash, r]) => [hash.toLowerCase(), [r[0], r[1], r[2].toLowerCase(), r[3].toLowerCase()]]));
      systems[system] = { ...systems[system], ...normalized };
    }
    for (const [system, rows] of Object.entries(localRaw?.titles ?? {})) titles[system] = { ...titles[system], ...rows };
    loaded = index({ ...bundled, systems, titles, folders: { ...bundled.folders, ...localRaw?.folders } }, localRaw?.titles ?? {});
    localStamp = stamp;
  }
  return loaded;
}

/** Swaps in another dictionary of the same shape (tests); null goes back to the bundled one. */
export function useKoreanNames(raw, titleOverrides = {}) {
  manual = raw ? index(raw, titleOverrides) : null;
}

function index(raw, titleOverrides = {}) {
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
  // Local display corrections override title guesses, not hash-confirmed labels.
  for (const [system, rows] of Object.entries(titleOverrides)) {
    for (const [title, ko] of Object.entries(rows)) byTitle.set(`${system}/${normalizeTitle(title)}`, { ko, en: null });
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

/** "한글 (English)" → ["한글", "English"]; a bare title → [title, null]. Pure. */
export function splitName(name) {
  const s = String(name ?? "").trim().normalize("NFC");
  const m = s.match(/^(.*\S)\s+\(([^()]*)\)$/);
  if (m && /[가-힣]/.test(m[1]) && /[A-Za-z]/.test(m[2])) return [m[1], m[2].trim()];
  return [s, null];
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

/** libretro folder names of the dictionary's later systems, as systems.js names their folders. */
export function koreanNameFolders() {
  return { ...(load().raw.folders ?? {}) };
}

/** How many hash-keyed names the bundled dictionary holds per system. */
export function koreanNameCounts() {
  return Object.fromEntries(Object.entries(load().raw.systems ?? {}).map(([id, rows]) => [id, Object.keys(rows).length]));
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
