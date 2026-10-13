/**
 * Moves a retro library laid out under the old folder names into each system's
 * one folder (systems.js `folder`: the id, or the operator's own name). Before
 * this, a system was read from its libretro name ("Nintendo - Game Boy
 * Advance") or any of a few aliases (GBA, FC, PS1, …), in any case.
 *
 *   roms/, thumbnails/, bezels/, icons/      <old name>/ → <folder>/
 *   system-icons/color/, system-icons/mono/  <old name>.png → <folder>.png
 *
 * When <folder> doesn't exist the old folder is renamed to it. When it does,
 * the old folder's entries are moved in where their name is free (folders
 * present on both sides are merged the same way, one level at a time); an entry
 * whose name is taken stays where it is and is reported as a conflict. Nothing
 * is ever deleted except old folders left empty. Running it again finds nothing
 * to do. Only renames are used, so it is cheap and stays on one disk.
 *
 * LEGACY_FOLDERS is history, frozen: the folder names this server used to read.
 * It is not the libretro mapping (systems.js `libretro`), which may change.
 * Its first name per system is also what game ids were built from (see
 * idFolder), so ids, and the forwarder title ids made from them, stay the same.
 */
import fs from "fs";
import path from "path";

export const LEGACY_FOLDERS = Object.freeze({
  nes: ["Nintendo - Nintendo Entertainment System", "nes", "fc", "famicom"],
  snes: ["Nintendo - Super Nintendo Entertainment System", "snes", "sfc", "superfamicom"],
  gb: ["Nintendo - Game Boy", "gb", "gameboy"],
  gbc: ["Nintendo - Game Boy Color", "gbc"],
  gba: ["Nintendo - Game Boy Advance", "gba"],
  n64: ["Nintendo - Nintendo 64", "n64"],
  md: ["Sega - Mega Drive - Genesis", "md", "genesis", "megadrive"],
  sms: ["Sega - Master System - Mark III", "sms", "mastersystem"],
  gg: ["Sega - Game Gear", "gg", "gamegear"],
  pce: ["NEC - PC Engine - TurboGrafx 16", "pce", "pcengine", "tg16"],
  segacd: ["Sega - Mega-CD - Sega CD", "segacd", "megacd", "Sega - Mega CD & Sega CD"],
  pcecd: ["NEC - PC Engine CD - TurboGrafx-CD", "pcecd", "pce-cd", "tgcd"],
  ps1: ["Sony - PlayStation", "ps1", "psx", "playstation"],
  psp: ["Sony - PlayStation Portable", "psp"],
  nds: ["Nintendo - Nintendo DS", "nds", "ds"],
  ngp: ["SNK - Neo Geo Pocket Color", "ngp", "ngpc", "SNK - Neo Geo Pocket"],
  ws: ["Bandai - WonderSwan Color", "ws", "wsc", "wonderswan", "Bandai - WonderSwan"],
  saturn: ["Sega - Saturn", "saturn", "ss"],
  arcade: ["FBNeo - Arcade Games", "arcade", "fbneo", "mame"],
});

export const SYSTEM_DIRS = ["roms", "thumbnails", "bezels", "icons"];
export const ICON_DIRS = ["system-icons/color", "system-icons/mono"];

/** The folder name a system's game ids are built from: its first old name, else its folder. Pure. */
export const idFolder = (id, system) => LEGACY_FOLDERS[id]?.[0] ?? system.folder;

/** Old folder names an operator listed as `aliases` in systems.json, by system id. */
export function operatorAliases(retroDir) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(retroDir, "systems.json"), "utf8"));
    const out = {};
    for (const [id, s] of Object.entries(raw ?? {})) {
      if (Array.isArray(s?.aliases)) out[id] = s.aliases.filter((a) => typeof a === "string" && a.trim());
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Lower-cased old name → system id, for every system. A name that is some
 * system's folder now is never taken as another's old name. Pure.
 */
export function oldNames(systems, extraAliases = {}) {
  const current = new Set(Object.values(systems).map((s) => s.folder.toLowerCase()));
  const out = new Map();
  for (const [id, s] of Object.entries(systems)) {
    for (const name of [...(LEGACY_FOLDERS[id] ?? []), ...(extraAliases[id] ?? []), s.folder]) {
      const key = name.toLowerCase();
      if (key === s.folder.toLowerCase() || !current.has(key)) {
        if (!out.has(key)) out.set(key, id);
      }
    }
  }
  return out;
}

function listDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

const exists = (p) => {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
};

/** Whether two paths name one entry (a case-insensitive disk). */
function sameEntry(a, b) {
  try {
    const sa = fs.lstatSync(a);
    const sb = fs.lstatSync(b);
    return sa.dev === sb.dev && sa.ino === sb.ino;
  } catch {
    return false;
  }
}

/** Renames from → to; through a free name when only the case differs on a disk that ignores case. */
function rename(from, to, report) {
  if (sameEntry(from, to)) {
    const tmp = `${to}.migrating-${process.pid}`;
    fs.renameSync(from, tmp);
    fs.renameSync(tmp, to);
  } else {
    fs.renameSync(from, to);
  }
  report.renamed.push({ from, to });
}

/** Moves src's entries into dst where the name is free, merging folders on both sides. */
function mergeInto(src, dst, report) {
  for (const e of listDir(src)) {
    const from = path.join(src, e.name);
    const to = path.join(dst, e.name);
    if (!exists(to)) {
      fs.renameSync(from, to);
      report.merged.push({ from, to });
    } else if (e.isDirectory() && fs.lstatSync(to).isDirectory()) {
      mergeInto(from, to, report);
    } else {
      report.conflicts.push({ from, to });
    }
  }
  try {
    fs.rmdirSync(src); // only when empty: nothing that stayed behind is lost
  } catch {
    // conflicts are still in it
  }
}

/** Order the old names of one system so the libretro-named folder (most files) goes first. */
function rank(id, name) {
  const i = (LEGACY_FOLDERS[id] ?? []).findIndex((n) => n.toLowerCase() === name.toLowerCase());
  return i < 0 ? Number.MAX_SAFE_INTEGER : i;
}

/**
 * Moves every old-named per-system folder (and system icon) under retroDir into
 * the system's folder. Returns { renamed, merged, conflicts, failed }, each a
 * list of { from, to } absolute paths (failed ones carry the `error` too).
 */
export function migrateFolders(retroDir, systems, extraAliases = {}) {
  const report = { renamed: [], merged: [], conflicts: [], failed: [] };
  const names = oldNames(systems, extraAliases);
  for (const sub of SYSTEM_DIRS) {
    const root = path.join(retroDir, sub);
    const found = listDir(root)
      .filter((e) => e.isDirectory() && names.has(e.name.toLowerCase()))
      .map((e) => ({ name: e.name, id: names.get(e.name.toLowerCase()) }))
      .filter(({ name, id }) => name !== systems[id].folder)
      .sort((a, b) => a.id.localeCompare(b.id) || rank(a.id, a.name) - rank(b.id, b.name) || a.name.localeCompare(b.name));
    for (const { name, id } of found) {
      const from = path.join(root, name);
      const to = path.join(root, systems[id].folder);
      try {
        if (!exists(to) || sameEntry(from, to)) rename(from, to, report);
        else mergeInto(from, to, report);
      } catch (err) {
        report.failed.push({ from, to, error: err.message });
      }
    }
  }
  for (const sub of ICON_DIRS) {
    const root = path.join(retroDir, sub);
    for (const e of listDir(root)) {
      if (!e.isFile() || path.extname(e.name).toLowerCase() !== ".png") continue;
      const id = names.get(path.basename(e.name, path.extname(e.name)).toLowerCase());
      if (!id || e.name === `${systems[id].folder}.png`) continue;
      const from = path.join(root, e.name);
      const to = path.join(root, `${systems[id].folder}.png`);
      if (exists(to) && !sameEntry(from, to)) report.conflicts.push({ from, to });
      else {
        try {
          rename(from, to, report);
        } catch (err) {
          report.failed.push({ from, to, error: err.message });
        }
      }
    }
  }
  return report;
}
