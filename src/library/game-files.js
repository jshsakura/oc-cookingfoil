/**
 * Files of the games folder going to its trash: one at a time from the library tab, a few at once
 * from MCP (capabilities/library-files.js). Nothing here deletes; emptying the trash does.
 */
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import * as libraryCache from "../meta/library-cache.js";
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
  libraryCache.invalidate({ rescan: true });
  return out;
}

/**
 * The library's own entries for `rels`, in order, and the rels it does not list. The list is read
 * against the disk: a file moved since the last rebuild (it waits a moment) is not counted.
 */
export async function listedFiles(rels) {
  await libraryCache.get();
  const onDisk = (f) => fs.existsSync(path.join(romsDirPath, f.rel));
  const listed = new Map(libraryCache.files().map((f) => [f.rel, f]));
  const files = rels.map((r) => listed.get(r)).filter((f) => f && onDisk(f));
  const bases = new Set(files.map(baseOf));
  return {
    files,
    missing: rels.filter((r) => !files.some((f) => f.rel === r)),
    // The other files of the games these are of, as they stand now.
    kin: [...listed.values()].filter((f) => bases.has(baseOf(f)) && onDisk(f)),
  };
}

const baseOf = (f) => f.baseTitleId ?? f.titleId;

/** Where a listed file is on disk, or null when its path would leave the games folder. */
export function pathOf(rel) {
  const top = path.resolve(romsDirPath);
  const abs = path.resolve(top, rel);
  return abs.startsWith(top + path.sep) ? abs : null;
}
