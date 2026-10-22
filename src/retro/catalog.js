/**
 * The retro game catalog, read from the operator's retro folder:
 *
 *   roms/<system>/<game file>            a game (or a subfolder holding one)
 *   thumbnails/<system>/Named_Boxarts/<game name>.png   box art, libretro-thumbnails layout
 *   bezels/<system>/<game name>.png      The Bezel Project overlay
 *   bezels/<system>/<game name>.cfg      its overlay config (made up when missing)
 *   bezels/<system>/<game name>_override.cfg   per-game RetroArch config (made up when missing)
 *   bezels/<system>/_default.png         the system's bezel for games without their own
 *
 * <system> is the system's one folder (systems.js `folder`: its short id,
 * "gba", unless the operator names another).
 *
 * A game's id is a hash of its system id and its path inside the system's
 * folder, so it does not depend on what that folder is called.
 *
 * "game name" is the ROM file name without its extension, which is also what
 * RetroArch calls the content when it looks for per-game configs.
 *
 * A ScummVM game: <id>/<id>.scummvm, the id being ScummVM's game id (monkey2),
 * which the file also holds (RetroArch's ScummVM core reads it). Every file of
 * that folder (and below it) rides along, since ScummVM finds its data there. The
 * id is the game's name; its title is given like any game's (retro/names.js).
 *
 * Disc images: a .cue or .m3u lists the files it needs; those ride along in
 * the game's bundle and count toward its size, but are not listed on their own.
 * Discs named "… (Disc 1)" / "… [K Disc 2]" in one folder become one game with
 * a generated .m3u, so RetroArch can swap discs. When one folder holds the same
 * game in several disc formats (CHD and PBP, CSO and ISO, …), only the best
 * one is listed.
 *
 * Two optional files add to each game, keyed by its ROM name:
 *   art-map/<system>.json   the original (No-Intro) title, which search also matches
 *   ratings.json            { "<system>": { "<ROM name>": { "rating": 0-100, "count": n } } }
 *
 * Versions of one game share a `group` (variants.js); `groups` maps each group
 * id to its members, best first.
 *
 * Scanning only stats files, so it is cheap; the folder is rescanned when the
 * listing is older than a minute.
 */
import crypto from "crypto";
import fsp from "fs/promises";
import path from "path";
import debug from "../debug.js";
import { loadSystems } from "./systems.js";
import * as systemCores from "./system-cores.js";
import { assignSdNames } from "./sd-names.js";
import { applyArcade, groupSets, setInfo } from "./arcade.js";
import { buildGroups } from "./variants.js";
import { rankSets } from "./arcade-policy.js";
import { isReadme } from "../helpers/readme-name.js";

const STALE_MS = 60_000;
const MAX_DEPTH = 2; // roms/<system>/<file> or roms/<system>/<folder>/<file>
const IMAGE_EXTS = [".png", ".jpg", ".jpeg"];
// libretro-thumbnails replaces these characters with "_" in file names.
const THUMB_UNSAFE_RE = /[&*/:`<>?\\|"]/g;

let state = { dir: null, scannedAt: 0, systems: {}, games: [], present: new Set(), byId: new Map(), groups: new Map() };
let inFlight = null;
const listeners = [];
let prepare = null;

/** The name a game's art is filed under: its file name, or its first disc's for a multi-disc game; an arcade set's short name. */
export function romKey(g) {
  if (g.keepFileName) return path.basename(g.rel, path.extname(g.rel)); // arcade: the set name
  const first = g.m3u ? g.extras[0]?.rel : null;
  return first ? path.basename(first, path.extname(first)) : g.name;
}

/**
 * Run `await fn(dir, systems)` at the start of every scan, before the folders are
 * read (retro/scaffold.js makes missing system folders there); null removes it.
 * A failure is logged and the scan goes on.
 */
export function beforeScan(fn) {
  prepare = fn;
}

/** Run `fn(state)` after every scan (say, to draw artwork ahead of time). */
export function onScan(fn) {
  listeners.push(fn);
}

export function gameId(system, rel) {
  return `${system}-${crypto.createHash("sha1").update(`${system}/${rel}`.normalize("NFC")).digest("hex").slice(0, 10)}`;
}

/** Files a .cue or .m3u names, relative to its folder. Pure. */
export function referencedFiles(ext, text) {
  const out = [];
  if (ext === ".cue") {
    for (const m of text.matchAll(/^\s*FILE\s+(?:"([^"]+)"|(\S+))/gim)) out.push(m[1] ?? m[2]);
  } else if (ext === ".m3u") {
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (t && !t.startsWith("#")) out.push(t);
    }
  }
  // Only files beside the list (or below it): never a way out of the folder.
  return out.filter((f) => !path.isAbsolute(f) && !f.split(/[\\/]/).includes(".."));
}

async function statFile(abs) {
  try {
    const st = await fsp.lstat(abs);
    return st.isFile() ? st : null;
  } catch {
    return null;
  }
}

async function firstImage(dir, names) {
  for (const name of names) {
    for (const ext of IMAGE_EXTS) {
      const abs = path.join(dir, name + ext);
      if (await statFile(abs)) return abs;
    }
  }
  return null;
}

async function listFiles(root, rel = "", depth = 1, out = []) {
  let entries;
  try {
    entries = await fsp.readdir(path.join(root, rel), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    // A README.md (helpers/readme-name.js) is someone's notes, never a ROM, though .md is a Mega Drive extension.
    if (e.name.startsWith(".") || (e.isFile() && isReadme(e.name))) continue;
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory() && depth < MAX_DEPTH) await listFiles(root, childRel, depth + 1, out);
    else if (e.isFile()) out.push(childRel);
  }
  return out;
}

const GAME_FOLDER_MAX_FILES = 5000;
const GAME_FOLDER_MAX_DEPTH = 6;

/**
 * Every file in the folder of `rel`, below it too (relative to `romsDir`, "/"-separated),
 * except .scummvm files (`rel` among them), the folder's own title.json, a README.md, and hidden or non-regular files. For a game made of a folder of files
 * (ScummVM) rather than one ROM; empty when the file is not inside a folder of its own.
 */
async function folderFilesOf(romsDir, rel) {
  const base = path.posix.dirname(rel);
  if (base === ".") return [];
  const out = [];
  const walk = async (dirRel, depth) => {
    let entries;
    try {
      entries = await fsp.readdir(path.join(romsDir, dirRel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      if (e.name.startsWith(".") || (e.isFile() && isReadme(e.name)) || out.length >= GAME_FOLDER_MAX_FILES) continue;
      const childRel = `${dirRel}/${e.name}`;
      if (e.isDirectory() && depth < GAME_FOLDER_MAX_DEPTH) await walk(childRel, depth + 1);
      // Another .scummvm here is a game of its own, not a file of this one; title.json names the game on the server only.
      else if (e.isFile() && path.extname(e.name).toLowerCase() !== ".scummvm" && !(depth === 1 && e.name === "title.json")) out.push(childRel);
    }
  };
  await walk(base, 1);
  return out;
}

const TITLE_LANGS = ["en", "ko", "ja", "zh"];

/**
 * A ScummVM game's titles from its folder's title.json ({ "en": "…", "ko": "…" }, ja and zh
 * optional), or null. The game is named by its ScummVM id, so this is what clients show; a
 * name the admin sets in the retro tab still wins, language by language.
 */
async function folderTitles(dir) {
  let raw;
  try {
    raw = JSON.parse(await fsp.readFile(path.join(dir, "title.json"), "utf8"));
  } catch {
    return null;
  }
  const out = {};
  for (const lang of TITLE_LANGS) {
    const v = typeof raw?.[lang] === "string" ? raw[lang].replace(/\s+/g, " ").trim().slice(0, 120) : "";
    if (v) out[lang] = v;
  }
  return out.en || out.ko ? { ...(out.en ? {} : { en: out.ko }), ...out } : null;
}

/** <dir>/<sub>/<folder> when it is a folder, else null. */
async function systemDir(dir, sub, folder) {
  const abs = path.join(dir, sub, folder);
  try {
    return (await fsp.stat(abs)).isDirectory() ? abs : null;
  } catch {
    return null;
  }
}

async function firstIn(dirs, names) {
  for (const d of dirs) {
    const hit = await firstImage(d, names);
    if (hit) return hit;
  }
  return null;
}

async function findBezel(bezelDirs, name) {
  for (const d of bezelDirs) {
    const own = await firstImage(d, [name]);
    if (!own) continue;
    const cfg = path.join(d, `${name}.cfg`);
    const override = path.join(d, `${name}_override.cfg`);
    return { png: own, generic: false, cfg: (await statFile(cfg)) ? cfg : null, override: (await statFile(override)) ? override : null };
  }
  for (const d of bezelDirs) {
    const generic = path.join(d, "_default.png");
    const override = path.join(d, `${name}_override.cfg`);
    if (await statFile(generic)) return { png: generic, generic: true, cfg: null, override: (await statFile(override)) ? override : null };
  }
  return null;
}

async function readGame({ systemId, system, romsDir, art }, rel) {
  const abs = path.join(romsDir, rel);
  const st = await statFile(abs);
  if (!st) return null;
  const ext = path.extname(rel).toLowerCase();
  const name = path.basename(rel, path.extname(rel));
  const extras = [];
  if (ext === ".cue" || ext === ".m3u") {
    const text = await fsp.readFile(abs, "utf8").catch(() => "");
    for (const ref of referencedFiles(ext, text)) {
      const refRel = path.posix.join(path.posix.dirname(rel), ref.replaceAll("\\", "/"));
      const refSt = await statFile(path.join(romsDir, refRel));
      if (refSt) extras.push({ abs: path.join(romsDir, refRel), rel: refRel, size: refSt.size, mtimeMs: refSt.mtimeMs });
    }
  }
  let names = null;
  if (ext === ".scummvm") {
    names = await folderTitles(path.join(romsDir, path.posix.dirname(rel)));
    for (const fileRel of await folderFilesOf(romsDir, rel)) {
      const fileSt = await statFile(path.join(romsDir, fileRel));
      if (fileSt) extras.push({ abs: path.join(romsDir, fileRel), rel: fileRel, size: fileSt.size, mtimeMs: fileSt.mtimeMs });
    }
  }
  const thumbName = name.replace(THUMB_UNSAFE_RE, "_");
  const id = gameId(systemId, rel);
  return {
    id,
    system: systemId,
    name,
    file: path.basename(rel),
    rel,
    abs,
    size: st.size + extras.reduce((n, f) => n + f.size, 0),
    fileSize: st.size,
    addedAt: Math.floor(st.mtimeMs / 1000),
    mtimeMs: st.mtimeMs,
    extras,
    ...(names ? { names } : {}),
    core: system.core,
    icon: await firstIn(art.thumbs, [name, thumbName]),
    bezel: await findBezel(art.bezels, name),
  };
}

const DISC_EXTS = [".m3u", ".chd", ".pbp", ".cso", ".iso", ".cue"]; // best format first
const DISC_RE = /([[(])([^[\]()]*?)\bDisc\s*(\d+)\b([^[\]()]*?)([\])])/i;

/** { key, n } for a disc file name ("Game [K Disc 2]" → "Game [K]", 2), or null. Pure. */
export function discOf(name) {
  const m = name.match(DISC_RE);
  if (!m) return null;
  const inner = `${m[2]}${m[4]}`.replace(/\s+/g, " ").trim();
  const key = `${name.slice(0, m.index)}${inner ? `${m[1]}${inner}${m[5]}` : ""}${name.slice(m.index + m[0].length)}`;
  return { key: key.replace(/\s+/g, " ").trim(), n: Number(m[3]) };
}

/** Folds "Disc N" files of one game into a single entry with a generated .m3u. */
async function groupDiscs(found, ctx) {
  const groups = new Map();
  for (const g of found) {
    const disc = DISC_EXTS.includes(path.extname(g.rel).toLowerCase()) && discOf(g.name);
    if (!disc) continue;
    const k = `${path.posix.dirname(g.rel)}\0${disc.key}`;
    groups.set(k, [...(groups.get(k) ?? []), { g, ...disc }]);
  }
  const folded = new Set();
  const merged = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    members.sort((a, b) => a.n - b.n);
    const discs = members.map((m) => m.g);
    for (const d of discs) folded.add(d);
    const { key } = members[0];
    const dir = path.posix.dirname(discs[0].rel);
    const rel = dir === "." ? `${key}.m3u` : `${dir}/${key}.m3u`;
    const own = { icon: await firstIn(ctx.art.thumbs, [key, key.replace(THUMB_UNSAFE_RE, "_")]), bezel: await findBezel(ctx.art.bezels, key) };
    merged.push({
      ...discs[0],
      id: gameId(ctx.systemId, rel),
      name: key,
      file: `${key}.m3u`,
      rel,
      abs: null,
      m3u: discs.map((d) => path.posix.basename(d.rel)).join("\n") + "\n",
      size: discs.reduce((n, d) => n + d.size, 0),
      addedAt: Math.max(...discs.map((d) => d.addedAt)),
      extras: discs.flatMap((d) => [{ abs: d.abs, rel: d.rel, size: d.fileSize, mtimeMs: d.mtimeMs }, ...d.extras]),
      icon: own.icon ?? discs[0].icon,
      bezel: own.bezel ?? discs[0].bezel,
    });
  }
  return [...found.filter((g) => !folded.has(g)), ...merged];
}

/** One folder, one game, several disc formats: keep the best format only. */
function bestFormats(games) {
  const extOf = (g) => path.extname(g.rel).toLowerCase();
  const titleOf = (g) => `${path.posix.dirname(g.rel)}\0${g.name.replace(/(\s*\[[^\]]*\])+\s*$/, "")}`;
  const best = new Map();
  for (const g of games) {
    const rank = DISC_EXTS.indexOf(extOf(g));
    if (rank < 0) continue;
    best.set(titleOf(g), Math.min(best.get(titleOf(g)) ?? Infinity, rank));
  }
  return games.filter((g) => {
    const rank = DISC_EXTS.indexOf(extOf(g));
    return rank < 0 || rank === best.get(titleOf(g));
  });
}

async function readJson(file) {
  try {
    return JSON.parse(await fsp.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

/** The original title a ROM was mapped to, without the console prefix WonderSwan maps use. */
const originalOf = (map, name) => {
  const v = map?.[name];
  return typeof v === "string" && v ? v.replace(/^WSC?:/, "") : null;
};

/** Adds `original`, `rating` and `ratingCount` to each game, from art-map and ratings.json. */
async function addExtras(dir, games) {
  const ratings = (await readJson(path.join(dir, "ratings.json"))) ?? {};
  const maps = new Map();
  for (const g of games) {
    if (!maps.has(g.system)) maps.set(g.system, await readJson(path.join(dir, "art-map", `${g.system}.json`)));
    const map = maps.get(g.system);
    // A multi-disc game is listed by its folded name; its first disc carries the mapping.
    const firstDisc = g.m3u ? path.basename(g.extras[0]?.rel ?? "", path.extname(g.extras[0]?.rel ?? "")) : null;
    g.original = originalOf(map, g.name) ?? (firstDisc && originalOf(map, firstDisc)) ?? g.original;
    const r = ratings[g.system]?.[g.name] ?? (firstDisc && ratings[g.system]?.[firstDisc]);
    if (Number.isInteger(r?.rating) && r.rating >= 0 && r.rating <= 100) {
      g.rating = r.rating;
      if (Number.isInteger(r.count) && r.count > 0) g.ratingCount = r.count;
    }
  }
}

export const thumbNames = (name) => [name, name.replace(THUMB_UNSAFE_RE, "_")];

/**
 * An arcade set without box art of its own shows its game's: another set's in
 * the folder, then any set of the game in the DAT whose art is on disk
 * (libretro often has only one region's name), the best set first.
 * Sets `icon` and `iconFrom` (the set short name it came from).
 */
async function borrowArcadeArt(games, art) {
  const own = new Map(games.filter((g) => g.set && g.icon).map((g) => [g.set, g]));
  for (const g of games) {
    if (g.icon || !g.set) continue;
    // Nearest first by the same preference that picks the representative (no hack's art before the World set's).
    const sets = rankSets(groupSets(g.set).filter((s) => s !== g.set).map((s) => ({ short: s, desc: setInfo(s)?.desc ?? s, parent: !setInfo(s)?.cloneOf })))
      .map((r) => r.short);
    const present = sets.find((s) => own.has(s));
    if (present) {
      g.icon = own.get(present).icon;
      g.iconFrom = present;
      continue;
    }
    for (const s of sets) {
      const desc = setInfo(s)?.desc;
      const hit = desc && (await firstIn(art.thumbs, [...thumbNames(desc), s]));
      if (hit) {
        g.icon = hit;
        g.iconFrom = s;
        break;
      }
    }
  }
}

/** Every game under `dir`, with the system table it was read with. */
export async function scanDir(dir) {
  const systems = systemCores.withPicks(loadSystems(dir), systemCores.all());
  if (prepare) await Promise.resolve().then(() => prepare(dir, systems)).catch((err) => debug.error("retro: preparing %s failed: %s", dir, err.message));
  const games = [];
  const present = new Set();
  for (const [systemId, system] of Object.entries(systems)) {
    const romsDir = await systemDir(dir, "roms", system.folder);
    if (!romsDir) continue;
    present.add(systemId);
    const thumbs = await systemDir(dir, "thumbnails", system.folder);
    const legacyIcons = await systemDir(dir, "icons", system.folder);
    const bezels = await systemDir(dir, "bezels", system.folder);
    const art = {
      thumbs: [...(thumbs ? [path.join(thumbs, "Named_Boxarts"), thumbs] : []), ...(legacyIcons ? [legacyIcons] : [])],
      bezels: bezels ? [bezels] : [],
    };
    const listed = (await listFiles(romsDir)).filter((rel) => system.extensions.includes(path.extname(rel).toLowerCase()));
    // A disc's track files are part of its .cue / .m3u, not games of their own.
    const found = [];
    for (const rel of listed) {
      const game = await readGame({ systemId, system, romsDir, art }, rel);
      if (game) found.push(game);
    }
    const claimed = new Set(found.flatMap((g) => g.extras.map((x) => x.rel)));
    let own = found.filter((g) => !claimed.has(g.rel));
    // Arcade zips keep their short names; the DAT names them and hides BIOS sets.
    if ((system.tableCore ?? system.core) === "fbneo") {
      own = applyArcade(own, await readJson(path.join(dir, "arcade-names.json")));
      for (const g of own) if (g.original && !g.icon) g.icon = await firstIn(art.thumbs, thumbNames(g.original));
      await borrowArcadeArt(own, art);
    }
    const listedGames = bestFormats(await groupDiscs(own, { systemId, system, romsDir, art }));
    games.push(...listedGames);
  }
  games.sort((a, b) => a.system.localeCompare(b.system) || a.name.localeCompare(b.name));
  await addExtras(dir, games);
  await assignSdNames(games);
  return { systems, games, present, groups: buildGroups(games) };
}

/** Rescan now; one scan at a time. */
export function scan(dir) {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const { systems, games, present, groups } = await scanDir(dir);
      state = { dir, scannedAt: Date.now(), systems, games, present, groups, byId: new Map(games.map((g) => [g.id, g])) };
      for (const fn of listeners) fn(state);
      return state;
    } catch (err) {
      debug.error("retro: scan failed: %s", err.message);
      throw err;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

let queued = null;
/**
 * A scan that starts after this call: when one is running (and may have read
 * the folder before a change) it waits for it, then scans again. Callers that
 * just changed files use it so the lists show the change at once.
 */
export function rescan(dir) {
  if (!inFlight) return scan(dir);
  queued ??= inFlight.catch(() => {}).then(() => {
    queued = null;
    return scan(dir);
  });
  return queued;
}

/** The current catalog; the first call waits for a scan, later stale ones refresh in the background. */
export async function current(dir) {
  if (state.dir !== dir || !state.scannedAt) return scan(dir);
  if (Date.now() - state.scannedAt > STALE_MS) scan(dir).catch(() => {});
  return state;
}

/** Systems listed before the rest, in this order; the others keep the system table's order. */
const FIRST_SYSTEMS = ["arcade"];

/** Systems that have a roms folder, with how many games each holds (of `games`: the listed ones, say). */
export function systemsOf({ systems, games: all, present }, games = all) {
  const counts = new Map();
  for (const g of games) counts.set(g.system, (counts.get(g.system) ?? 0) + 1);
  const rank = (id) => (FIRST_SYSTEMS.includes(id) ? FIRST_SYSTEMS.indexOf(id) : FIRST_SYSTEMS.length);
  return Object.entries(systems)
    .filter(([id]) => present.has(id))
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([id, s]) => ({ id, name: s.names.en ?? id, names: s.names, defaultCore: s.core, coreName: s.coreName, romCount: counts.get(id) ?? 0 }));
}

/**
 * The systems a client may see: those with at least one game among `games`.
 * A folder that exists but holds nothing, or a console only pre-registered in
 * the system table, stays out of every list, home row and menu.
 */
export const visibleSystems = (cat, games = cat.games) => systemsOf(cat, games).filter((s) => s.romCount > 0);
