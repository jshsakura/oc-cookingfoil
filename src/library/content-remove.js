/**
 * A game's patch or save going to its trash: from the library tab one at a time, a few at once from
 * MCP (capabilities/patches.js). Its patch-store entry and marks go into the trash entry, so a
 * restore brings them back. A homebrew app's patches and saves are the homebrew tab's.
 */
import fsp from "fs/promises";
import path from "path";
import * as userPatches from "../meta/user-patches.js";
import * as patchInfo from "../meta/patch-info.js";
import { patchesDir, savesDir } from "../helpers/envs.js";
import { savesCatalog, savesEnabled } from "../routes/saves.js";
import * as trashService from "./trash-service.js";
import { forgetMarks, marksOf } from "./trash-marks.js";

const KINDS = ["patch", "save"];

function contained(root, ...rel) {
  const base = path.resolve(root);
  const target = path.resolve(base, ...rel);
  return target.startsWith(base + path.sep) ? target : null;
}

/** The folder of a game's patch or save, its root and title id; null when it is not one. */
export async function locateContent(kind, id) {
  if (!KINDS.includes(kind)) return null;
  const root = kind === "patch" ? patchesDir : savesDir;
  const where = kind === "patch" ? userPatches.locate(id) : savesEnabled() ? await savesCatalog().locate(id) : null;
  const dir = where && !where.dir.startsWith("homebrew/") ? contained(root, where.dir, where.folder) : null;
  return dir ? { root, dir, titleId: where.dir.toUpperCase(), folder: where.folder } : null;
}

/** Reads the patches or saves again after a change. */
export async function refreshContent(kind) {
  if (kind === "patch") await userPatches.scan();
  else savesCatalog().invalidate();
}

/**
 * Moves the patch or save `id` (where locateContent found it) to its trash and forgets what was
 * kept under its id. The trash entry; throws TrashError when it cannot be moved. `refresh: false`
 * leaves the rescan to a caller moving several.
 */
export async function trashContent(kind, id, { root, dir, titleId, folder }, by, { refresh = true } = {}) {
  const key = kind === "patch" ? patchInfo.keyOf(titleId, folder) : null;
  const marks = marksOf(kind, id);
  const out = await trashService.trash(kind === "patch" ? "patches" : "saves", [{ rel: path.relative(root, dir).split(path.sep).join("/") }], {
    kind, action: `${kind}-remove`, by, name: folder,
    extra: { ...(key && patchInfo.has(key) ? { patchInfo: { titleId, folder, info: patchInfo.get(key) } } : {}), ...(marks ? { marks } : {}) },
  });
  await fsp.rmdir(path.dirname(dir)).catch(() => {});
  if (key) patchInfo.remove(key);
  forgetMarks(kind, id);
  if (refresh) await refreshContent(kind);
  return out;
}
