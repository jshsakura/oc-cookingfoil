/**
 * Files of the games folder going to its trash: one at a time from the library tab, a few at once
 * from MCP (capabilities/library-files.js). Nothing here deletes; emptying the trash does.
 */
import fsp from "fs/promises";
import path from "path";
import * as shopCache from "../meta/shop-cache.js";
import { romsDirPath } from "../helpers/envs.js";
import * as trashService from "./trash-service.js";

/**
 * Moves files of the games folder to its trash as one entry per disk, and drops the folders they
 * leave empty, up to the games folder. `abss` are absolute paths inside the games folder.
 */
export async function trashGameFiles(abss, { kind, action, by, name }) {
  const top = path.resolve(romsDirPath);
  const items = abss.map((abs) => ({ rel: path.relative(top, abs).split(path.sep).join("/") }));
  const out = await trashService.trash("games", items, { kind, action, by, name });
  for (const abs of abss) {
    for (let dir = path.dirname(abs); dir !== top && dir.startsWith(top + path.sep); dir = path.dirname(dir)) {
      if (!(await fsp.rmdir(dir).then(() => true, () => false))) break;
    }
  }
  shopCache.invalidate({ rescan: true });
  return out;
}

/** The library's own entries for `rels`, in order, and the rels it does not list. */
export async function listedFiles(rels) {
  await shopCache.get();
  const all = shopCache.files();
  const byRel = new Map(all.map((f) => [f.rel, f]));
  return { files: rels.filter((r) => byRel.has(r)).map((r) => byRel.get(r)), missing: rels.filter((r) => !byRel.has(r)), all };
}

/** Where a listed file is on disk, or null when its path would leave the games folder. */
export function pathOf(rel) {
  const top = path.resolve(romsDirPath);
  const abs = path.resolve(top, rel);
  return abs.startsWith(top + path.sep) ? abs : null;
}
