/**
 * Box art and bezels for the retro library, run from the admin page (and after
 * an upload) instead of by hand:
 *
 *   art-map/<system>.json   ROM name → its No-Intro / Redump name, or null for "no art"
 *   thumbnails/<folder>/Named_Boxarts/<ROM>.png
 *   bezels/<folder>/<ROM>.png, bezels/<folder>/_default.png
 *
 * <folder> is the system's folder on the server (systems.js `folder`); the
 * libretro-thumbnails repository is found by its `libretro` name alone.
 *
 * syncArt() fills what is missing: it matches unmapped ROMs by their English
 * title against libretro-thumbnails, then downloads box art and bezels for every
 * mapped ROM. applyMatch() is the hand-made correction for one ROM, and
 * saveCover() takes a cover from SteamGridDB instead, and saveCoverImage() one the
 * admin uploaded. Box art is only ever shown, never installed, so the server keeps
 * one small copy: every cover is shrunk by encodeCover on its way in, and
 * optimizeBoxarts() shrinks the ones saved before that. Files that exist are kept,
 * except by applyMatch, which replaces them.
 */
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import sharp from "sharp";
import debug from "../../debug.js";
import { BEZEL_SOURCES, BEZELS, THUMBS, boxartNames, download, enc, firstOf, pool, repoOf } from "./sources.js";
import { bestMatch, englishTitle, titleKey } from "./titles.js";
import { groupSets, setInfo } from "../arcade.js";
import { rankSets } from "../arcade-policy.js";

const NAMES_TTL_MS = 24 * 60 * 60 * 1000;
const CANDIDATES = 24;
const SGDB = "https://www.steamgriddb.com/api/v2";
const SGDB_CDN_RE = /^https:\/\/cdn\d*\.steamgriddb\.com\//;
export const MAX_COVER_BYTES = 15 * 1024 * 1024;
// Box art is shown small on the console: its long side to 600 and short side to
// 400 whichever way it stands (tall SNES boxes, wide Japanese ones), kept a
// paletted PNG, about a fifth of libretro's originals (85 KB against 400 KB).
const COVER_LONG = 600;
const COVER_SHORT = 400;
const OPTIMIZE_CONCURRENCY = 2;
// Small enough already: not worth a re-encode (and it may not shrink).
const SMALL_COVER_BYTES = 48 * 1024;
// WonderSwan names need a console prefix and arcade art follows the DAT (arcadeBoxartPlan), so neither is matched by title.
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

/**
 * Download jobs for what a system is missing: its default bezel, then each mapped
 * ROM's box art and bezel. With `indexes` (repo → bezel names, see bezelIndexes)
 * a bezel the Bezel Project lacks under that exact name falls back to the same
 * title from another region; without them only the exact name is tried. Games
 * left without one still get the system's default bezel from the server.
 */
export function jobsFor(dir, id, system, map, dry, indexes = null) {
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
    let thumbRepo = repoOf(system.libretro);
    if (id === "ws") {
      const [console, ...rest] = target.split(":");
      name = rest.join(":");
      thumbRepo = console === "WS" ? "Bandai_-_WonderSwan" : "Bandai_-_WonderSwan_Color";
    }
    const boxDest = path.join(dir, "thumbnails", system.folder, "Named_Boxarts", `${rom}.png`);
    if (thumbRepo && !fs.existsSync(boxDest)) {
      jobs.push(async () => ["boxart", await download(`${THUMBS}/${thumbRepo}/master/${enc(`Named_Boxarts/${name}.png`)}`, boxDest, dry, encodeCover)]);
    }
    const bezelDest = path.join(bezelDir, `${rom}.png`);
    if (sources.length && !fs.existsSync(bezelDest)) {
      const urls = indexes ? [bezelUrl(sources, indexes, name)].filter(Boolean) : sources.map(([repo, folder]) => gameBezelUrl(repo, folder, name));
      if (urls.length) jobs.push(async () => ["bezel", await firstOf(urls, bezelDest, dry)]);
    }
  }
  return jobs;
}

const gameBezelUrl = (repo, folder, name) => `${BEZELS}/${repo}/master/${enc(`retroarch/overlay/GameBezels/${folder}/${name}.png`)}`;
const ARCADE_REPO = "bezelproject-MAME";
const arcadeBezelUrl = (short) => `${BEZELS}/${ARCADE_REPO}/master/${enc(`retroarch/overlay/ArcadeBezels/${short}.png`)}`;

/** The bezel for a No-Intro name: that name in the first collection that has it, else the same title from another region. Pure. */
export function bezelUrl(sources, indexes, name) {
  for (const [repo, folder] of sources) if (indexes.get(repo)?.get(folder)?.has(name)) return gameBezelUrl(repo, folder, name);
  for (const [repo, folder] of sources) {
    const hit = bestMatch(name, [...(indexes.get(repo)?.get(folder) ?? [])]);
    if (hit) return gameBezelUrl(repo, folder, hit);
  }
  return null;
}

const indexCache = new Map(); // repo → { at, folders: Map(folder → Set(name)) }

/**
 * Bezel names in one Bezel Project repo, per folder (GameBezels/<folder>, and
 * ArcadeBezels). One recursive tree call; when GitHub truncates it (the MAME
 * repo has tens of thousands of files) the overlay folders are walked one by one.
 * Cached for a day.
 */
async function bezelIndex(repo, { token = "", fetchImpl = fetch } = {}) {
  const hit = indexCache.get(repo);
  if (hit && Date.now() - hit.at < NAMES_TTL_MS) return hit.folders;
  const tree = async (sha, recursive = false) => {
    const res = await fetchImpl(`https://api.github.com/repos/thebezelproject/${repo}/git/trees/${sha}${recursive ? "?recursive=1" : ""}`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "oc-cookingfoil", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    if (!res.ok) throw new Error(`GitHub ${res.status} ${repo}`);
    return res.json();
  };
  const folders = new Map();
  const add = (folder, file) => {
    if (!file.endsWith(".png")) return;
    if (!folders.has(folder)) folders.set(folder, new Set());
    folders.get(folder).add(file.slice(0, -4));
  };
  const whole = await tree("master", true);
  if (!whole.truncated) {
    for (const t of whole.tree ?? []) {
      const m = /^retroarch\/overlay\/(?:GameBezels\/([^/]+)|(ArcadeBezels))\/([^/]+)$/.exec(t.path);
      if (m) add(m[1] ?? m[2], m[3]);
    }
  } else {
    const child = (t, name) => t.tree.find((x) => x.path === name)?.sha;
    const overlay = await tree(child(await tree(child(await tree("master"), "retroarch")), "overlay"));
    const arcade = child(overlay, "ArcadeBezels");
    if (arcade) for (const t of (await tree(arcade)).tree) add("ArcadeBezels", t.path);
    const games = child(overlay, "GameBezels");
    if (games) for (const f of (await tree(games)).tree.filter((x) => x.type === "tree")) for (const t of (await tree(f.sha)).tree) add(f.path, t.path);
  }
  indexCache.set(repo, { at: Date.now(), folders });
  return folders;
}

/** repo → folder → names for every collection a system draws bezels from; null when GitHub can't be read. */
export async function bezelIndexes(id, opts = {}) {
  const repos = [...new Set([...(BEZEL_SOURCES[id] ?? []).map(([repo]) => repo), ...(id === "arcade" ? [ARCADE_REPO] : [])])];
  try {
    return new Map(await Promise.all(repos.map(async (repo) => [repo, await bezelIndex(repo, opts)])));
  } catch {
    return null;
  }
}

/** Arcade bezels are filed by set name: the set's own, else its parent's. `parentOf(short)` gives the parent or null. */
export function arcadeBezelJobs(dir, system, shorts, indexes, parentOf, dry = false) {
  const have = indexes?.get(ARCADE_REPO)?.get("ArcadeBezels");
  const jobs = [];
  for (const short of new Set(shorts)) {
    const dest = bezelPath(dir, system, short);
    if (fs.existsSync(dest)) continue;
    const pick = !have ? short : have.has(short) ? short : have.has(parentOf(short)) ? parentOf(short) : null;
    if (pick) jobs.push(async () => ["bezel", await download(arcadeBezelUrl(pick), dest, dry)]);
  }
  return jobs;
}

// libretro-thumbnails replaces these characters with "_" in file names.
const THUMB_UNSAFE_RE = /[&*/:`<>?\\|"]/g;
const thumbName = (desc) => desc.replace(THUMB_UNSAFE_RE, "_");

/**
 * Arcade box art is filed under the set's DAT description. A set libretro has
 * no art for takes its game's: the best set of the same parent that has some
 * (catalog.js shows it for every set of that game). `names` are libretro's
 * box art names. Returns [{ short, name, dest }], one download per file. Pure
 * apart from checking which files exist.
 */
export function arcadeBoxartPlan(dir, system, shorts, names) {
  const have = new Set(names);
  const art = path.join(dir, "thumbnails", system.folder, "Named_Boxarts");
  const onDisk = (short) => {
    const desc = setInfo(short)?.desc;
    return [short, ...(desc ? [desc, thumbName(desc)] : [])].some((n) => fs.existsSync(path.join(art, `${n}.png`)) || fs.existsSync(path.join(art, `${n}.jpg`)));
  };
  const plan = new Map();
  for (const short of new Set(shorts)) {
    const info = setInfo(short);
    if (!info || info.bios || onDisk(short)) continue;
    const ranked = rankSets(groupSets(short).filter((s) => s !== short).map((s) => ({ short: s, desc: setInfo(s)?.desc ?? s, parent: !setInfo(s)?.cloneOf }))).map((r) => r.short);
    // Its game already has art on disk: the catalog shows that one.
    if (!have.has(thumbName(info.desc)) && ranked.some(onDisk)) continue;
    const pick = [short, ...ranked].find((s) => have.has(thumbName(setInfo(s).desc)));
    if (!pick) continue;
    const name = thumbName(setInfo(pick).desc);
    if (!plan.has(name)) plan.set(name, { short, name, dest: path.join(art, `${name}.png`) });
  }
  return [...plan.values()];
}

const namesCache = new Map(); // system id → { at, names }

/** The libretro box art names for a system, cached for a day. */
export async function libretroNames(id, system, { token = "", fetchImpl = fetch } = {}) {
  const hit = namesCache.get(id);
  if (hit && Date.now() - hit.at < NAMES_TTL_MS) return hit.names;
  const repo = repoOf(system.libretro);
  if (!repo) return [];
  const names = await boxartNames(repo, { token, fetchImpl });
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

/**
 * Matches, then downloads, for every system (or `only`). `roms` maps system id → ROM names;
 * a system without ROMs is skipped, so a pre-registered console leaves nothing on disk.
 */
export async function syncArt(dir, systems, roms, { only = null, onProgress = () => {}, ...opts } = {}) {
  const summary = {};
  const ids = Object.keys(systems).filter((id) => (!only || id === only) && roms[id]?.length);
  for (const [i, id] of ids.entries()) {
    onProgress({ system: id, index: i, total: ids.length });
    const system = systems[id];
    try {
      const { matched, missed } = await matchSystem(dir, id, system, roms[id] ?? [], opts);
      const indexes = await bezelIndexes(id, opts);
      const jobs = jobsFor(dir, id, system, readMap(dir, id), false, indexes);
      if (id === "arcade") {
        jobs.push(...arcadeBezelJobs(dir, system, roms[id] ?? [], indexes, (s) => setInfo(s)?.cloneOf ?? null));
        // Without libretro's names (GitHub's limit) the bezels still come.
        const names = await libretroNames(id, system, opts).catch(() => []);
        for (const p of arcadeBoxartPlan(dir, system, roms[id] ?? [], names)) {
          jobs.push(async () => ["boxart", await download(`${THUMBS}/${repoOf(system.libretro)}/master/${enc(`Named_Boxarts/${p.name}.png`)}`, p.dest, false, encodeCover)]);
        }
      }
      const results = await pool(jobs);
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
export const libretroUrl = (system, name) => (system.libretro ? `${THUMBS}/${repoOf(system.libretro)}/master/${enc(`Named_Boxarts/${name}.png`)}` : null);

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
    download(libretroUrl(system, name), box, false, encodeCover),
    sources.length ? bezelIndexes(id).then((ix) => firstOf(ix ? [bezelUrl(sources, ix, name)].filter(Boolean) : sources.map(([repo, folder]) => gameBezelUrl(repo, folder, name)), bezel, false)) : "none",
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

/** Wide backgrounds (heroes) SteamGridDB has for one of its games: [{ url, thumb }]. */
export async function sgdbHeroes(gameId, apiKey, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${SGDB}/heroes/game/${Number(gameId)}?types=static`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`SteamGridDB ${res.status}`);
  const body = await res.json();
  return (body.data ?? []).slice(0, CANDIDATES).map((g) => ({ url: g.url, thumb: g.thumb }));
}

/** An image from SteamGridDB's own image host, at most MAX_COVER_BYTES; anything else throws. */
export async function fetchSgdbImage(url, { fetchImpl = fetch } = {}) {
  if (!SGDB_CDN_RE.test(String(url))) throw new Error("SteamGridDB 이미지 주소가 아닙니다");
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`image ${res.status}`);
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length > MAX_COVER_BYTES) throw new Error("image too large");
  return body;
}

/** Saves a SteamGridDB cover as one ROM's box art (PNG). Only SteamGridDB's own image host is accepted. */
export async function saveCover(dir, system, rom, url, { fetchImpl = fetch } = {}) {
  if (!SGDB_CDN_RE.test(String(url))) throw new Error("SteamGridDB 이미지 주소가 아닙니다");
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`cover ${res.status}`);
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length > MAX_COVER_BYTES) throw new Error("cover too large");
  await saveCoverImage(dir, system, rom, body);
}

export class CoverImageError extends Error {}

/** Any image sharp can read (jpg, png, webp, gif, avif …) → a small PNG. Upright, never enlarged. */
export async function encodeCover(raw) {
  try {
    const m = await sharp(raw, { failOn: "none" }).metadata();
    // EXIF orientations 5-8 turn the picture a quarter, swapping its sides.
    const wide = (m.orientation >= 5 ? m.height : m.width) > (m.orientation >= 5 ? m.width : m.height);
    return await sharp(raw, { failOn: "none" })
      .rotate()
      .resize({ width: wide ? COVER_LONG : COVER_SHORT, height: wide ? COVER_SHORT : COVER_LONG, fit: "inside", withoutEnlargement: true })
      .png({ palette: true, quality: 90, effort: 10, compressionLevel: 9 })
      .toBuffer();
  } catch (err) {
    throw new CoverImageError(`이미지를 읽지 못했습니다: ${err.message}`);
  }
}

/** Whether a cover needs no shrinking: already small, or what encodeCover makes (in bounds, paletted). */
async function isOptimized(file) {
  if ((await fsp.stat(file)).size <= SMALL_COVER_BYTES) return true;
  const m = await sharp(file, { failOn: "none" }).metadata();
  return Math.max(m.width, m.height) <= COVER_LONG && Math.min(m.width, m.height) <= COVER_SHORT && m.paletteBitDepth !== undefined;
}

/**
 * Shrinks every box art under thumbnails/ that isn't already small, in place
 * (a file that would not get smaller is left as it is). Safe to run again: done
 * files are skipped. Returns { checked, optimized, before, after } in bytes.
 */
export async function optimizeBoxarts(dir) {
  const root = path.join(dir, "thumbnails");
  const files = (await fsp.readdir(root, { recursive: true }).catch(() => []))
    .filter((p) => p.endsWith(".png") && p.split(path.sep).includes("Named_Boxarts"))
    .map((p) => path.join(root, p));
  const out = { checked: files.length, optimized: 0, before: 0, after: 0 };
  let next = 0;
  await Promise.all(Array.from({ length: OPTIMIZE_CONCURRENCY }, async () => {
    while (next < files.length) {
      const file = files[next++];
      try {
        if (await isOptimized(file)) continue;
        const raw = await fsp.readFile(file);
        const png = await encodeCover(raw);
        if (png.length >= raw.length) continue;
        await fsp.writeFile(`${file}.part`, png);
        await fsp.rename(`${file}.part`, file);
        out.optimized++;
        out.before += raw.length;
        out.after += png.length;
      } catch (err) {
        debug.error("retro art: could not shrink %s: %s", file, err.message);
      }
    }
  }));
  return out;
}

/** Saves image bytes as one ROM's box art, shrunk by encodeCover. Returns the bytes written. */
export async function saveCoverImage(dir, system, rom, raw) {
  if (!raw?.length) throw new CoverImageError("빈 파일입니다");
  if (raw.length > MAX_COVER_BYTES) throw new CoverImageError("15 MB 보다 큰 이미지는 받지 않습니다");
  const png = await encodeCover(raw);
  const dest = boxartPath(dir, system, rom);
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.writeFile(`${dest}.part`, png);
  await fsp.rename(`${dest}.part`, dest);
  return png.length;
}
