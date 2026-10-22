/**
 * Ready-made ROM folders, and the storage guide computed from what they hold.
 *
 * Before every catalog scan (and so at start, when the first scan runs) the
 * server makes <retro>/roms/<folder>/ for each system the Switch can run, and
 * the BIOS folder of the RetroArch pack, when they are missing. A system can
 * run when the official Switch bundle the pack lock pins has its core, or the
 * operator put that core in the pack's cores/ folder. A system whose games sit
 * in a folder named the way other front ends name it (SNES, psx, genesis) is
 * read from there (systems.js), so it gets no second folder. When that folder
 * is copied in after the server made the system's own, the empty one gives way
 * to it (systems.js withFoundFolders) and stays as it is.
 *
 * The retro folder itself is never made here. A run with no retro folder does
 * nothing: on a server reading a network share, a missing folder is usually a
 * share that is not mounted yet, and folders made then would land on the local
 * disk under the mount point. Only storage-layout.js ensureLayout, at start,
 * makes the role folders.
 *
 * Nothing is renamed, moved, deleted or written: a run only makes folders. They
 * come back after a delete at the next scan; the admin turns the whole thing off
 * with retroScaffold. A folder that cannot be made fails the same way at every
 * scan, so freshProblems() hands each one to the log once per process.
 *
 * Each run also computes the storage guide and every folder's guide from the
 * systems the scan read (helpers/folder-guides.js) and keeps them in memory for
 * the API (helpers/storage-guide.js). No guide is written to disk.
 *
 * The server process makes the folders, as PUID:PGID in the image (the
 * entrypoint drops root before the server starts), so what it makes belongs to
 * the same owner as everything else the server writes. Nothing is chowned.
 */
import fsp from "fs/promises";
import path from "path";
import officialCores from "./data/official-cores-1.22.2.js";
import { packDirOf } from "./pack-status.js";
import { oldRetroLeftBehind } from "../helpers/folder-hints.js";
import { folderGuides, storageText } from "../helpers/folder-guides.js";

const isDir = async (p) => (await fsp.stat(p).catch(() => null))?.isDirectory() === true;

/** The cores the operator put in the pack's cores/ folder, by core name. */
async function installedCores(packDir) {
  const names = await fsp.readdir(path.join(packDir, "cores")).catch(() => []);
  return new Set(names.map((n) => n.match(/^([a-z0-9_]+)_libretro_libnx\.nro$/)?.[1]).filter(Boolean));
}

/** The ids of the systems the Switch can run, in table order. Pure. */
export function runnableIds(systems, installed = new Set(), official = officialCores) {
  const runs = (core) => Boolean(core) && (installed.has(core) || Boolean(official.files[`${core}_libretro_libnx.nro`]));
  return Object.entries(systems).filter(([, s]) => runs(s.core) || runs(s.tableCore)).map(([id]) => id);
}

/** The storage guide and every folder's guide for these systems: { text, guides }. Pure. */
export function guideFor({ systems, runnable, layout, retroDir, packDir }) {
  return {
    text: storageText({ systems, runnable, layout, retroDir, packDir }),
    guides: folderGuides({ layout, systems, runnable, retroDir, packDir }),
  };
}

let last = null;
let lastView = null;
const madeSinceStart = new Set();

/** The last run without its guide, for the admin page: no disk. */
export function status() {
  if (!last) return null;
  const { guide: _guide, ...rest } = last;
  return rest;
}

/** The last run's { text, guides, status }, the same object until the next run, or null before the first run: no disk. */
export const lastGuide = () => lastView;

/**
 * Makes `abs`, a folder inside `retroDir`, and the missing folders between: `abs` when made, null when
 * already there; throws when a file is in its place. One level at a time and never `retroDir` itself, so
 * a retro folder that goes away mid-run (a share unmounted) fails with ENOENT instead of coming back empty.
 */
async function make(retroDir, abs) {
  if (await isDir(abs)) return null;
  let at = retroDir;
  for (const part of path.relative(retroDir, abs).split(path.sep)) {
    at = path.join(at, part);
    await fsp.mkdir(at).catch((err) => {
      if (err.code !== "EEXIST") throw err;
    });
  }
  if (!(await isDir(abs))) throw Object.assign(new Error("not a folder"), { code: "EEXIST" });
  return abs;
}

/**
 * Makes the missing folders and computes the guides. `systems` is the table the scan reads with
 * (systems.js loadSystems, cores picked); `layout` is storage-layout.js resolveLayout's. Returns (and
 * keeps for status() and lastGuide()) { at, enabled, skipped, made: [rel], failed: [{ folder, error }],
 * folders: [{ id, name, folder, made }], guide: { text, guides } }.
 */
export async function run({ retroDir, systems, layout, enabled = true }) {
  const packDir = packDirOf(retroDir);
  const biosDir = path.join(packDir, "system");
  const runnable = runnableIds(systems, await installedCores(packDir));
  const rel = (abs) => path.relative(retroDir, abs).split(path.sep).join("/");
  const out = { at: Date.now(), enabled, skipped: null, made: [], failed: [], folders: [], guide: guideFor({ systems, runnable, layout, retroDir, packDir }) };
  const present = await isDir(retroDir);
  // An old data/retro still holding the games is named on the admin page while this one is empty; filling it would hide that.
  const waiting = present && Boolean(layout?.dirs?.data) && oldRetroLeftBehind(layout.dirs.data, retroDir);
  if (enabled && !present) out.skipped = "no-retro";
  else if (enabled && waiting) out.skipped = "old-retro";
  if (enabled && present && !waiting) {
    for (const abs of [...runnable.map((id) => path.join(retroDir, "roms", systems[id].folder)), biosDir]) {
      try {
        if (await make(retroDir, abs)) {
          out.made.push(rel(abs));
          madeSinceStart.add(abs);
        }
      } catch (err) {
        out.failed.push({ folder: rel(abs), error: err.code ?? err.message });
      }
    }
  }
  out.folders = runnable.map((id) => ({ id, name: systems[id].names?.en ?? id, folder: systems[id].folder, made: madeSinceStart.has(path.join(retroDir, "roms", systems[id].folder)) }));
  last = out;
  lastView = { ...out.guide, status: status() };
  return out;
}

const reported = new Set();

/**
 * The folders a run could not make, as [{ path, error }], leaving out each path already handed out in
 * this process: the log names a problem once, the admin page shows it every time (status()).
 */
export function freshProblems(retroDir, r) {
  const all = r.failed.map((f) => ({ path: path.join(retroDir, f.folder), error: f.error }));
  const fresh = all.filter((p) => !reported.has(p.path));
  for (const p of fresh) reported.add(p.path);
  return fresh;
}
