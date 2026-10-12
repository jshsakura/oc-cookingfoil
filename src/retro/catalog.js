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
 * Discs named "… (Disc 1)" / "… [K Disc 2]" in one folder become one game with
 * a generated .m3u, so RetroArch can swap discs. When one folder holds the same
 * game in several disc formats (CHD and PBP, CSO and ISO, …), only the best
 * one is listed.
 *
 * Two optional files add to each game, keyed by its ROM name:
 *   art-map/<system>.json   the original (No-Intro) title, which search also matches
 *   ratings.json            { "<system>": { "<ROM name>": { "rating": 0-100, "count": n } } }
 *
 * Scanning only stats files, so it is cheap; the folder is rescanned when the
 * listing is older than a minute.
 */
import crypto from "crypto";
import fsp from "fs/promises";
import path from "path";
import debug from "../debug.js";
import { loadSystems, systemForFolder } from "./systems.js";
import { assignSdNames } from "./sd-names.js";
import { applyArcade } from "./arcade.js";

const STALE_MS = 60_000;
const MAX_DEPTH = 2; // roms/<system>/<file> or roms/<system>/<folder>/<file>
const IMAGE_EXTS = [".png", ".jpg", ".jpeg"];
// libretro-thumbnails replaces these characters with "_" in file names.
const THUMB_UNSAFE_RE = /[&*/:`<>?\\|"]/g;

let state = { dir: null, scannedAt: 0, systems: {}, games: [], present: new Set(), byId: new Map() };
let inFlight = null;
const listeners = [];

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
    fileSize: st.size,
    addedAt: Math.floor(st.mtimeMs / 1000),
    mtimeMs: st.mtimeMs,
    extras,
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
      id: gameId(ctx.systemId, `${path.basename(ctx.romsDir)}/${rel}`),
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
      let own = found.filter((g) => !claimed.has(g.rel));
      // Arcade zips keep their short names; the DAT names them and hides BIOS sets.
      if (system.core === "fbneo") {
        own = applyArcade(own, await readJson(path.join(dir, "arcade-names.json")));
        for (const g of own) if (g.original && !g.icon) g.icon = await firstIn(art.thumbs, [g.original, g.original.replace(THUMB_UNSAFE_RE, "_")]);
      }
      games.push(...bestFormats(await groupDiscs(own, { systemId, romsDir, art })));
    }
  }
  games.sort((a, b) => a.system.localeCompare(b.system) || a.name.localeCompare(b.name));
  await addExtras(dir, games);
  await assignSdNames(games);
  return { systems, games, present };
}

/** Rescan now; one scan at a time. */
export function scan(dir) {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const { systems, games, present } = await scanDir(dir);
      state = { dir, scannedAt: Date.now(), systems, games, present, byId: new Map(games.map((g) => [g.id, g])) };
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

/** The current catalog; the first call waits for a scan, later stale ones refresh in the background. */
export async function current(dir) {
  if (state.dir !== dir || !state.scannedAt) return scan(dir);
  if (Date.now() - state.scannedAt > STALE_MS) scan(dir).catch(() => {});
  return state;
}

/** Systems listed before the rest, in this order; the others keep the system table's order. */
const FIRST_SYSTEMS = ["arcade"];

/** Systems that have a roms folder, with how many games each holds. */
export function systemsOf({ systems, games, present }) {
  const counts = new Map();
  for (const g of games) counts.set(g.system, (counts.get(g.system) ?? 0) + 1);
  const rank = (id) => (FIRST_SYSTEMS.includes(id) ? FIRST_SYSTEMS.indexOf(id) : FIRST_SYSTEMS.length);
  return Object.entries(systems)
    .filter(([id]) => present.has(id))
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([id, s]) => ({ id, name: s.names.en ?? id, names: s.names, defaultCore: s.core, coreName: s.coreName, romCount: counts.get(id) ?? 0 }));
}
