/**
 * The retro game catalog, read from the operator's retro folder:
 *
 *   roms/<system>/<game file>            a game (or a subfolder holding one)
 *   icons/<system>/<game name>.png|jpg   box art (libretro-thumbnails names work)
 *   bezels/<system>/<game name>.png      The Bezel Project overlay
 *   bezels/<system>/<game name>.cfg      its overlay config (made up when missing)
 *   bezels/<system>/<game name>_override.cfg   per-game RetroArch config (made up when missing)
 *   bezels/<system>/_default.png         the system's bezel for games without their own
 *
 * "game name" is the ROM file name without its extension, which is also what
 * RetroArch calls the content when it looks for per-game configs.
 *
 * Disc images: a .cue or .m3u lists the files it needs; those ride along in
 * the game's bundle and count toward its size, but are not listed on their own.
 *
 * Scanning only stats files, so it is cheap; the folder is rescanned when the
 * listing is older than a minute.
 */
import crypto from "crypto";
import fsp from "fs/promises";
import path from "path";
import debug from "../debug.js";
import { loadSystems } from "./systems.js";

const STALE_MS = 60_000;
const MAX_DEPTH = 2; // roms/<system>/<file> or roms/<system>/<folder>/<file>
const IMAGE_EXTS = [".png", ".jpg", ".jpeg"];
// libretro-thumbnails replaces these characters with "_" in file names.
const THUMB_UNSAFE_RE = /[&*/:`<>?\\|"]/g;

let state = { dir: null, scannedAt: 0, systems: {}, games: [], present: new Set(), byId: new Map() };
let inFlight = null;

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
    if (e.name.startsWith(".")) continue;
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory() && depth < MAX_DEPTH) await listFiles(root, childRel, depth + 1, out);
    else if (e.isFile()) out.push(childRel);
  }
  return out;
}

async function readGame(dir, systemId, system, rel) {
  const romsDir = path.join(dir, "roms", systemId);
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
  const thumbName = name.replace(THUMB_UNSAFE_RE, "_");
  const id = gameId(systemId, rel);
  const bezelDir = path.join(dir, "bezels", systemId);
  const ownBezel = await firstImage(bezelDir, [name]);
  const bezelPng = ownBezel ?? (await statFile(path.join(bezelDir, "_default.png")) ? path.join(bezelDir, "_default.png") : null);
  return {
    id,
    system: systemId,
    name,
    file: path.basename(rel),
    rel,
    abs,
    size: st.size + extras.reduce((n, f) => n + f.size, 0),
    addedAt: Math.floor(st.mtimeMs / 1000),
    mtimeMs: st.mtimeMs,
    extras,
    core: system.core,
    icon: await firstImage(path.join(dir, "icons", systemId), [name, thumbName]) ?? (await firstImage(path.join(dir, "icons"), [id])),
    bezel: bezelPng && {
      png: bezelPng,
      generic: !ownBezel,
      cfg: ownBezel && (await statFile(path.join(bezelDir, `${name}.cfg`))) ? path.join(bezelDir, `${name}.cfg`) : null,
      override: (await statFile(path.join(bezelDir, `${name}_override.cfg`))) ? path.join(bezelDir, `${name}_override.cfg`) : null,
    },
  };
}

/** Every game under `dir`, with the system table it was read with. */
export async function scanDir(dir) {
  const systems = loadSystems(dir);
  const games = [];
  const present = new Set();
  for (const [systemId, system] of Object.entries(systems)) {
    const romsDir = path.join(dir, "roms", systemId);
    if (!(await fsp.stat(romsDir).catch(() => null))?.isDirectory()) continue;
    present.add(systemId);
    const files = await listFiles(romsDir);
    const listed = files.filter((rel) => system.extensions.includes(path.extname(rel).toLowerCase()));
    // A disc's track files are part of its .cue / .m3u, not games of their own.
    const games0 = [];
    for (const rel of listed) {
      const game = await readGame(dir, systemId, system, rel);
      if (game) games0.push(game);
    }
    const claimed = new Set(games0.flatMap((g) => g.extras.map((x) => x.rel)));
    games.push(...games0.filter((g) => !claimed.has(g.rel)));
  }
  games.sort((a, b) => a.system.localeCompare(b.system) || a.name.localeCompare(b.name));
  return { systems, games, present };
}

/** Rescan now; one scan at a time. */
export function scan(dir) {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const { systems, games, present } = await scanDir(dir);
      state = { dir, scannedAt: Date.now(), systems, games, present, byId: new Map(games.map((g) => [g.id, g])) };
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

/** The current catalog; the first call waits for a scan, later stale ones refresh in the background. */
export async function current(dir) {
  if (state.dir !== dir || !state.scannedAt) return scan(dir);
  if (Date.now() - state.scannedAt > STALE_MS) scan(dir).catch(() => {});
  return state;
}

/** Systems that have a roms folder, with how many games each holds. */
export function systemsOf({ systems, games, present }) {
  const counts = new Map();
  for (const g of games) counts.set(g.system, (counts.get(g.system) ?? 0) + 1);
  return Object.entries(systems)
    .filter(([id]) => present.has(id))
    .map(([id, s]) => ({ id, name: s.names.en ?? id, names: s.names, defaultCore: s.core, coreName: s.coreName, romCount: counts.get(id) ?? 0 }));
}
