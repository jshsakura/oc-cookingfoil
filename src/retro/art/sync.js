/**
 * Box art and bezels for the retro library, run from the admin page (and after
 * an upload) instead of by hand:
 *
 *   art-map/<system>.json   ROM name → its No-Intro / Redump name, or null for "no art"
 *   thumbnails/<folder>/Named_Boxarts/<ROM>.png
 *   bezels/<folder>/<ROM>.png, bezels/<folder>/_default.png
 *
 * syncArt() fills what is missing: it matches unmapped ROMs by their English
 * title against libretro-thumbnails, then downloads box art and bezels for every
 * mapped ROM. applyMatch() is the hand-made correction for one ROM, and
 * saveCover() takes a cover from SteamGridDB instead. Files that exist are kept,
 * except by applyMatch, which replaces them.
 */
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import sharp from "sharp";
import { BEZEL_SOURCES, BEZELS, THUMBS, boxartNames, download, enc, firstOf, pool, repoOf } from "./sources.js";
import { bestMatch, englishTitle, titleKey } from "./titles.js";

const NAMES_TTL_MS = 24 * 60 * 60 * 1000;
const CANDIDATES = 24;
const SGDB = "https://www.steamgriddb.com/api/v2";
const SGDB_CDN_RE = /^https:\/\/cdn\d*\.steamgriddb\.com\//;
const MAX_COVER_BYTES = 15 * 1024 * 1024;
// WonderSwan names need a console prefix and arcade art follows the DAT, so neither is matched by title.
const NOT_MATCHED = new Set(["ws", "arcade"]);

const mapFile = (dir, id) => path.join(dir, "art-map", `${id}.json`);

export function readMap(dir, id) {
  try {
    return JSON.parse(fs.readFileSync(mapFile(dir, id), "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
}

function writeMap(dir, id, map) {
  const file = mapFile(dir, id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(map, null, 1)}\n`);
  fs.renameSync(`${file}.tmp`, file);
}

export const boxartPath = (dir, system, rom) => path.join(dir, "thumbnails", system.folder, "Named_Boxarts", `${rom}.png`);
export const bezelPath = (dir, system, rom) => path.join(dir, "bezels", system.folder, `${rom}.png`);

/** Download jobs for what a system is missing: its default bezel, then each mapped ROM's box art and bezel. */
export function jobsFor(dir, id, system, map, dry) {
  const jobs = [];
  const sources = BEZEL_SOURCES[id] ?? [];
  const bezelDir = path.join(dir, "bezels", system.folder);
  const defaultSrc = sources.find(([, , d]) => d);
  const defaultDest = path.join(bezelDir, "_default.png");
  if (defaultSrc && !fs.existsSync(defaultDest)) {
    const [repo, , name] = defaultSrc;
    jobs.push(async () => ["default", await download(`${BEZELS}/${repo}/master/${enc(`retroarch/overlay/${name}.png`)}`, defaultDest, dry)]);
  }
  for (const [rom, target] of Object.entries(map)) {
    if (!target) continue;
    let name = target;
    let thumbRepo = repoOf(system.folder);
    if (id === "ws") {
      const [console, ...rest] = target.split(":");
      name = rest.join(":");
      thumbRepo = console === "WS" ? "Bandai_-_WonderSwan" : "Bandai_-_WonderSwan_Color";
    }
    const boxDest = path.join(dir, "thumbnails", system.folder, "Named_Boxarts", `${rom}.png`);
    if (!fs.existsSync(boxDest)) {
      jobs.push(async () => ["boxart", await download(`${THUMBS}/${thumbRepo}/master/${enc(`Named_Boxarts/${name}.png`)}`, boxDest, dry)]);
    }
    const bezelDest = path.join(bezelDir, `${rom}.png`);
    if (sources.length && !fs.existsSync(bezelDest)) {
      const urls = sources.map(([repo, folder]) => `${BEZELS}/${repo}/master/${enc(`retroarch/overlay/GameBezels/${folder}/${name}.png`)}`);
      jobs.push(async () => ["bezel", await firstOf(urls, bezelDest, dry)]);
    }
  }
  return jobs;
}

const namesCache = new Map(); // system id → { at, names }

/** The libretro box art names for a system, cached for a day. */
export async function libretroNames(id, system, { token = "", fetchImpl = fetch } = {}) {
  const hit = namesCache.get(id);
  if (hit && Date.now() - hit.at < NAMES_TTL_MS) return hit.names;
  const names = await boxartNames(repoOf(system.folder), { token, fetchImpl });
  namesCache.set(id, { at: Date.now(), names });
  return names;
}

/** Maps a system's unmapped ROMs by English title. Returns { matched, missed } ROM names. */
export async function matchSystem(dir, id, system, roms, opts = {}) {
  if (NOT_MATCHED.has(id)) return { matched: [], missed: [] };
  const map = readMap(dir, id);
  const todo = [...new Set(roms)].filter((rom) => !(rom in map));
  if (!todo.length) return { matched: [], missed: [] };
  const names = await libretroNames(id, system, opts);
  const found = {};
  const missed = [];
  for (const rom of todo) {
    const hit = bestMatch(englishTitle(rom), names);
    if (hit) found[rom] = hit;
    else missed.push(rom);
  }
  if (Object.keys(found).length) writeMap(dir, id, { ...readMap(dir, id), ...found });
  return { matched: Object.keys(found), missed };
}

/** Matches, then downloads, for every system (or `only`). `roms` maps system id → ROM names. */
export async function syncArt(dir, systems, roms, { only = null, onProgress = () => {}, ...opts } = {}) {
  const summary = {};
  const ids = Object.keys(systems).filter((id) => (!only || id === only) && (roms[id]?.length || BEZEL_SOURCES[id]));
  for (const [i, id] of ids.entries()) {
    onProgress({ system: id, index: i, total: ids.length });
    const system = systems[id];
    try {
      const { matched, missed } = await matchSystem(dir, id, system, roms[id] ?? [], opts);
      const results = await pool(jobsFor(dir, id, system, readMap(dir, id), false));
      const count = (kind) => results.filter((r) => Array.isArray(r) && r[0] === kind && r[1] === "ok").length;
      summary[id] = { matched: matched.length, missed: missed.length, boxart: count("boxart"), bezel: count("bezel"), errors: results.filter((r) => typeof r === "string").length };
    } catch (err) {
      summary[id] = { error: err.message };
    }
  }
  return summary;
}

/** Up to CANDIDATES libretro names for a search: same title first, then every word present. */
export async function candidates(id, system, query, opts = {}) {
  const key = titleKey(query);
  if (!key) return [];
  const words = key.split(" ");
  const names = await libretroNames(id, system, opts);
  const scored = [];
  for (const name of names) {
    const k = titleKey(name);
    const score = k === key ? 0 : k.startsWith(key) ? 1 : words.every((w) => k.includes(w)) ? 2 : -1;
    if (score >= 0) scored.push([score, name]);
  }
  return scored.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1])).slice(0, CANDIDATES).map(([, n]) => n);
}

/** The libretro box art address for a name, for previews. */
export const libretroUrl = (system, name) => `${THUMBS}/${repoOf(system.folder)}/master/${enc(`Named_Boxarts/${name}.png`)}`;

/**
 * Sets one ROM's No-Intro name (null: it has no art) and replaces its box art and
 * bezel with that name's. Returns { boxart, bezel } download outcomes.
 */
export async function applyMatch(dir, id, system, rom, name) {
  writeMap(dir, id, { ...readMap(dir, id), [rom]: name });
  const box = boxartPath(dir, system, rom);
  const bezel = bezelPath(dir, system, rom);
  await Promise.all([box, bezel].map((f) => fsp.rm(f, { force: true })));
  if (!name) return { boxart: "removed", bezel: "removed" };
  const sources = BEZEL_SOURCES[id] ?? [];
  const [boxart, bez] = await Promise.all([
    download(libretroUrl(system, name), box, false),
    sources.length ? firstOf(sources.map(([repo, folder]) => `${BEZELS}/${repo}/master/${enc(`retroarch/overlay/GameBezels/${folder}/${name}.png`)}`), bezel, false) : "none",
  ]);
  return { boxart, bezel: bez };
}

/** SteamGridDB games for a title: [{ id, name, year }]. */
export async function sgdbSearch(query, apiKey, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${SGDB}/search/autocomplete/${encodeURIComponent(query)}`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`SteamGridDB ${res.status}`);
  const body = await res.json();
  return (body.data ?? []).slice(0, CANDIDATES).map((g) => ({ id: g.id, name: g.name, year: g.release_date ? new Date(g.release_date * 1000).getUTCFullYear() : null }));
}

/** Portrait covers SteamGridDB has for one of its games: [{ url, thumb }]. */
export async function sgdbCovers(gameId, apiKey, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${SGDB}/grids/game/${Number(gameId)}?dimensions=600x900,342x482,660x930&types=static`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`SteamGridDB ${res.status}`);
  const body = await res.json();
  return (body.data ?? []).slice(0, CANDIDATES).map((g) => ({ url: g.url, thumb: g.thumb }));
}

/** Saves a SteamGridDB cover as one ROM's box art (PNG). Only SteamGridDB's own image host is accepted. */
export async function saveCover(dir, system, rom, url, { fetchImpl = fetch } = {}) {
  if (!SGDB_CDN_RE.test(String(url))) throw new Error("SteamGridDB 이미지 주소가 아닙니다");
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`cover ${res.status}`);
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length > MAX_COVER_BYTES) throw new Error("cover too large");
  const png = await sharp(body, { failOn: "none" }).png().toBuffer();
  const dest = boxartPath(dir, system, rom);
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.writeFile(`${dest}.part`, png);
  await fsp.rename(`${dest}.part`, dest);
}
