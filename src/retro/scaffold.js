/**
 * Ready-made ROM folders and a guide to the storage folder.
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
 * Nothing is renamed, moved or deleted, and nothing is written inside a folder
 * that is already there, except the guide. Folders come back after a delete at
 * the next scan; the admin turns the whole thing off with retroScaffold.
 * A folder that cannot be made fails the same way at every scan, so
 * freshProblems() hands each one to the log once per process.
 *
 * The guide (README.md) describes the layout for people and for AI tools that
 * read a folder's README first; it is plain Markdown in English. It goes in the
 * storage folder when there is one, else in the retro folder (with separate
 * mounts no other folder the server owns is a parent of everything). Its first
 * line carries a hash of the rest: the server rewrites it only while that hash
 * still matches, so a guide someone edited, or a README of their own, is left
 * as it is (helpers/guide-file.js). The same text is kept in memory for the admin page
 * (routes/admin/storage-guide-api.js), so requests never read the disk.
 *
 * With folderGuides on, each run also writes the README.md of each folder that is
 * there (helpers/folder-guides.js): the role folders, roms/ and each system folder,
 * the BIOS folder, thumbnails/ and bezels/. Those follow the same rule and make no
 * folder; writeRoleGuides() writes the role folders' at start, for a server whose
 * retro scan never runs.
 *
 * The server process makes all of this, as PUID:PGID in the image (the
 * entrypoint drops root before the server starts), so what it makes belongs to
 * the same owner as everything else the server writes. Nothing is chowned.
 */
import fsp from "fs/promises";
import path from "path";
import officialCores from "./data/official-cores-1.22.2.js";
import { packDirOf } from "./pack-status.js";
import { oldRetroLeftBehind } from "../helpers/folder-hints.js";
import { GUIDE_NAME, stamp, writeGuide } from "../helpers/guide-file.js";
import * as folderGuides from "../helpers/folder-guides.js";

export { GUIDE_NAME, stamp };
export { guideState } from "../helpers/guide-file.js";

const ROLE_TEXT = {
  incoming: "Drop box. Files left here are sorted into the folders below once they stop changing. Retro ROMs go in a folder named after their system (incoming/snes/Game.zip).",
  games: "Switch games (.nsp .nsz .xci .xcz), one folder per game with update/ and DLC/ inside.",
  homebrew: "Homebrew apps: .nro files and app folders.",
  retro: "Retro ROMs, their art and the RetroArch pack (see below).",
  patches: "Patches, one folder per base title id.",
  saves: "Save files, one folder per title id.",
  keys: "Your own prod.keys.",
  data: "Accounts, settings and caches. Back this one up.",
};

const isDir = async (p) => (await fsp.stat(p).catch(() => null))?.isDirectory() === true;
const cell = (s) => String(s).replaceAll("|", "\\|");

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

/** Where the guide goes: the storage folder when the retro folder is its own, else the retro folder. Pure. */
export function guidePlace(layout, retroDir) {
  return layout?.storage && path.resolve(retroDir) === path.resolve(layout.dirs.retro) ? layout.root : retroDir;
}

/** The BIOS a system needs, as one table cell. Pure. */
const biosCell = (id) => folderGuides.biosText(id) ?? "none";

/**
 * The guide's text without its first line. `biosDir` is the pack's system/ folder.
 * Paths inside `guideDir` are written relative to it, the rest in full. Pure.
 */
export function guideText({ systems, runnable, layout, retroDir, guideDir, biosDir, guides = true }) {
  const shown = (p) => {
    const rel = path.relative(guideDir, p);
    if (rel === "") return "";
    return rel.startsWith("..") || path.isAbsolute(rel) ? `${p}/` : `${rel.split(path.sep).join("/")}/`;
  };
  const r = shown(retroDir);
  const roles = Object.keys(ROLE_TEXT).filter((role) => layout?.dirs?.[role]);
  return [
    "# CookingFoil storage",
    "",
    "A CookingFoil server reads these folders. It writes this file and keeps it current while the file is unchanged.",
    "Edit the file and the server leaves it as it is; delete it and the server writes it again.",
    "",
    "## Folders",
    "",
    "| Folder | Holds |",
    "|---|---|",
    ...roles.map((role) => `| \`${cell(shown(layout.dirs[role]) || "./")}\` | ${ROLE_TEXT[role]} |`),
    "",
    "## Retro systems",
    "",
    `ROMs go in \`${r}roms/<folder>/\`, loose or one subfolder deep. Only the systems the Switch can run are listed.`,
    `BIOS files go in \`${shown(biosDir)}\`.`,
    "",
    "| System | Id | Folder | Extensions | BIOS |",
    "|---|---|---|---|---|",
    ...runnable.map((id) => {
      const s = systems[id];
      return `| ${cell(s.names?.en ?? id)} | ${id} | \`${cell(`${r}roms/${s.folder}/`)}\` | ${s.extensions.join(" ")} | ${biosCell(id)} |`;
    }),
    "",
    `A folder named the way other front ends name a system (SNES, psx, genesis, "Nintendo - Game Boy Advance") is read in place of the folder above.`,
    `Arcade sets keep their FBNeo short names (sf2.zip). A ScummVM game is a folder holding \`<id>.scummvm\`. Discs of one game keep "(Disc 1)", "(Disc 2)" in their names; .cue and .m3u files bring the tracks they list.`,
    "",
    "## Art and metadata",
    "",
    `- \`${r}thumbnails/<folder>/Named_Boxarts/<ROM name>.png\`: box art, libretro-thumbnails layout.`,
    `- \`${r}bezels/<folder>/<ROM name>.png\`: bezel; \`_default.png\` serves the whole system.`,
    `- \`${r}system-icons/color/<folder>.png\`, \`${r}system-icons/mono/<folder>.png\`: system icons.`,
    `- \`${r}art-map/<id>.json\`, \`${r}ratings.json\`, \`${r}arcade-names.json\`: original titles and ratings.`,
    `- \`${r}systems.json\`: changes a system (folder, core, extensions) or adds one.`,
    `- \`${shown(path.dirname(biosDir))}\`: the RetroArch pack (retroarch.nro, cores/, system/). ${folderGuides.CORE_NOTE}`,
    "",
    "## What the server does here",
    "",
    "- It makes missing folders: the folders above, a ROM folder for each system listed, and the BIOS folder.",
    "- It never renames, moves or deletes files or folders to do so.",
    "- Other changes happen only on request: files left in the drop box are sorted into the folders above, and the admin page renames or deletes what an admin picks. NSZ conversion, when an admin turns it on, replaces .nsp files with .nsz.",
    "- A deleted folder comes back at the next scan. To stop that, turn off the folder making (retroScaffold) in the admin page's server settings.",
    ...(guides ? ["- Each folder above, each system folder, the BIOS folder, thumbnails/ and bezels/ hold a README.md of their own (folderGuides). `GET /admin/api/storage-guide?format=json` returns them all."] : []),
    "",
  ].join("\n");
}

let last = null;
const madeSinceStart = new Set();

/** The last run without its text, for the admin page: no disk. */
export function status() {
  if (!last) return null;
  const { text: _text, ...rest } = last;
  return rest;
}

/** The last run's guide text, or null before the first run: no disk. */
export const lastGuide = () => last?.text ?? null;

/**
 * The guide for a server that has not scanned yet, from the built-in system table
 * and the official cores alone: no disk.
 */
export function fallbackGuide({ systems, layout, retroDir }) {
  const guideDir = guidePlace(layout, retroDir);
  return stamp(guideText({ systems, runnable: runnableIds(systems), layout, retroDir, guideDir, biosDir: path.join(retroDir, "retroarch", "system") }));
}

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

/** Every folder guide for this layout (helpers/folder-guides.js plan), `retro` saying whether the retro folder's own are in. Pure. */
function guidePlan({ systems, runnable, layout, retroDir, packDir, retro }) {
  const storageGuide = path.join(guidePlace(layout, retroDir), GUIDE_NAME);
  return folderGuides.plan({ layout, systems, runnable, retroDir, biosDir: path.join(packDir, "system"), packDir, storageGuide, retro });
}

/**
 * The folder guides for a server that has not scanned yet, as [{ path, state: null, text }], from the
 * built-in system table alone: no disk, so every guide the server could write is listed.
 */
export function fallbackFolderGuides({ systems, layout, retroDir }) {
  const packDir = path.join(retroDir, "retroarch");
  return guidePlan({ systems, runnable: runnableIds(systems), layout, retroDir, packDir, retro: true })
    .map((g) => ({ path: g.path, state: null, text: stamp(g.body) }));
}

/**
 * Writes the role folders' guides (not the retro folder's own): at start, when a retro scan may not come.
 * Returns what writeAll returns; nothing when `enabled` is off.
 */
export async function writeRoleGuides({ systems, layout, retroDir, enabled = true }) {
  if (!enabled) return [];
  return folderGuides.writeAll(guidePlan({ systems, runnable: [], layout, retroDir, packDir: packDirOf(retroDir), retro: false }));
}

/**
 * Makes the missing folders and writes the guide when it is missing or out of date, then (with `guides`,
 * the folderGuides setting) each folder's own guide in the folders that are there.
 * `systems` is the table the scan reads with (systems.js loadSystems, cores picked);
 * `layout` is storage-layout.js resolveLayout's. Returns (and keeps for status())
 * { at, enabled, skipped, made: [rel], failed: [{ folder, error }], folders: [{ id, name, folder, made }], guide: { path, state },
 *   folderGuides: [{ path, state, error? }], text }.
 */
export async function run({ retroDir, systems, layout, enabled = true, guides = true }) {
  const packDir = packDirOf(retroDir);
  const biosDir = path.join(packDir, "system");
  const runnable = runnableIds(systems, await installedCores(packDir));
  const guideDir = guidePlace(layout, retroDir);
  const body = guideText({ systems, runnable, layout, retroDir, guideDir, biosDir, guides });
  const rel = (abs) => path.relative(retroDir, abs).split(path.sep).join("/");
  const out = { at: Date.now(), enabled, skipped: null, made: [], failed: [], folders: [], guide: { path: path.join(guideDir, GUIDE_NAME), state: "off" }, folderGuides: [], text: stamp(body) };
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
    out.guide = await writeGuide(out.guide.path, body);
  }
  if (guides) out.folderGuides = (await folderGuides.writeAll(guidePlan({ systems, runnable, layout, retroDir, packDir, retro: present && !waiting }))).filter((r) => r.state !== "no-folder");
  else folderGuides.forget();
  out.folders = runnable.map((id) => ({ id, name: systems[id].names?.en ?? id, folder: systems[id].folder, made: madeSinceStart.has(path.join(retroDir, "roms", systems[id].folder)) }));
  last = out;
  return out;
}

const reported = new Set();

/**
 * The folders a run could not make and the guide it could not write, as [{ path, error }], leaving out
 * each path already handed out in this process: the log names a problem once, the admin page shows it
 * every time (status()).
 */
export function freshProblems(retroDir, r) {
  const all = r.failed.map((f) => ({ path: path.join(retroDir, f.folder), error: f.error }));
  for (const g of [r.guide, ...(r.folderGuides ?? [])]) if (g.state === "failed" || g.state === "unreadable") all.push({ path: g.path, error: g.error });
  const fresh = all.filter((p) => !reported.has(p.path));
  for (const p of fresh) reported.add(p.path);
  return fresh;
}
