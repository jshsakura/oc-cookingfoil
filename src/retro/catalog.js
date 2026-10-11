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
 * <system> is RetroArch's name for it ("Nintendo - Game Boy Advance"), the
 * short id ("gba") or an alias ("FC", "PS1"), in any case; two folders for one
 * system (say FC and NES) are read together.
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
import { loadSystems, systemForFolder } from "./systems.js";

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

/** systemId → the folders under <dir>/<sub> that belong to it. */
async function foldersBySystem(dir, sub, systems) {
  const out = new Map();
  let entries = [];
  try {
    entries = await fsp.readdir(path.join(dir, sub), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const id = systemForFolder(systems, e.name);
    if (!id) continue;
    out.set(id, [...(out.get(id) ?? []), path.join(dir, sub, e.name)]);
  }
  return out;
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
  const thumbName = name.replace(THUMB_UNSAFE_RE, "_");
  const id = gameId(systemId, `${path.basename(romsDir)}/${rel}`);
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
    icon: await firstIn(art.thumbs, [name, thumbName]),
    bezel: await findBezel(art.bezels, name),
  };
}

/** Every game under `dir`, with the system table it was read with. */
export async function scanDir(dir) {
  const systems = loadSystems(dir);
  const games = [];
  const present = new Set();
  const roms = await foldersBySystem(dir, "roms", systems);
  const thumbs = await foldersBySystem(dir, "thumbnails", systems);
  const legacyIcons = await foldersBySystem(dir, "icons", systems);
  const bezels = await foldersBySystem(dir, "bezels", systems);
  for (const [systemId, romsDirs] of roms) {
    const system = systems[systemId];
    present.add(systemId);
    const art = {
      thumbs: [...(thumbs.get(systemId) ?? []).flatMap((d) => [path.join(d, "Named_Boxarts"), d]), ...(legacyIcons.get(systemId) ?? [])],
      bezels: bezels.get(systemId) ?? [],
    };
    for (const romsDir of romsDirs) {
      const listed = (await listFiles(romsDir)).filter((rel) => system.extensions.includes(path.extname(rel).toLowerCase()));
      // A disc's track files are part of its .cue / .m3u, not games of their own.
      const found = [];
      for (const rel of listed) {
        const game = await readGame({ systemId, system, romsDir, art }, rel);
        if (game) found.push(game);
      }
      const claimed = new Set(found.flatMap((g) => g.extras.map((x) => x.rel)));
      games.push(...found.filter((g) => !claimed.has(g.rel)));
    }
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
