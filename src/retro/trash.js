/**
 * The retro folder's side of the shared trash (library/trash.js). Moving a
 * game there takes its ROM (and the disc files it names; an arcade set's
 * parent and BIOS zips stay, other sets need them) and the three things that
 * follow a ROM's name:
 *
 *   thumbnails/<folder>/Named_Boxarts/<name>.png|.jpg   its own box art
 *   bezels/<folder>/<name>.png, .cfg, _override.cfg     its bezel and configs
 *   art-map/<system>.json                               its key (kept in the manifest)
 *   .cookingfoil-originals/<id>/<file>                  the original of a patched ROM
 *
 * into <retro dir>/.cookingfoil-trash/<YYYY-MM-DD>/<game id>/, under the same
 * relative paths, with a manifest.json. The scanner skips dot folders, so the
 * game leaves the lists. Nothing is deleted here; restoreEntry() puts it all
 * back, beside anything that took its place, never over it. The old
 * <retro dir>/.trash entries are moved into the shared folder at start.
 */
import fs from "fs";
import path from "path";
import { romKey, thumbNames } from "./catalog.js";
import * as shared from "../library/trash.js";
import { patchOf } from "./rom-patch-records.js";

export const TRASH = shared.TRASH_DIR;
export const { TrashError } = shared;
const IMAGE_EXTS = [".png", ".jpg", ".jpeg"];

const exists = (abs) => fs.promises.lstat(abs).then(() => true, () => false);
const inside = (root, abs) => path.resolve(abs).startsWith(path.resolve(root) + path.sep);
const rootOf = (dir) => ({ key: "retro", dir });

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(value, null, 1)}\n`);
  fs.renameSync(`${file}.tmp`, file);
}

/** Paths (relative to the retro dir) of the files that go with a game, existing or not. Pure. */
export function filesOf(g, system) {
  const roms = [...(g.abs ? [g.rel] : []), ...(g.keepFileName ? [] : (g.extras ?? []).map((x) => x.rel))];
  const key = romKey(g);
  // Art is found by the ROM name, a disc set's folded name, or an arcade set's DAT description.
  const names = [...new Set([...thumbNames(key), ...thumbNames(g.name), ...(g.keepFileName && g.original ? thumbNames(g.original) : [])])];
  const thumbs = names.flatMap((n) => IMAGE_EXTS.map((e) => path.posix.join("thumbnails", system.folder, "Named_Boxarts", `${n}${e}`)));
  const bezels = [".png", ".cfg", "_override.cfg"].map((suffix) => path.posix.join("bezels", system.folder, `${key}${suffix}`));
  return { roms: roms.map((r) => path.posix.join("roms", system.folder, r)), art: [...thumbs, ...bezels], key };
}

/** Art files other games still show, and whether one of them is filed under the same name. */
export function stillUsed(g, games) {
  const others = games.filter((o) => o !== g && o.id !== g.id && o.system === g.system);
  const files = new Set(others.flatMap((o) => [o.icon, o.bezel && !o.bezel.generic ? o.bezel.png : null, o.bezel?.cfg, o.bezel?.override]).filter(Boolean).map((f) => path.resolve(f)));
  return { files, key: others.some((o) => romKey(o) === romKey(g)) };
}

/**
 * Moves a game and what follows its name into the trash. `keep` (stillUsed)
 * names the art other games still show: two copies of one game filed under
 * one name, or an arcade set whose art its other sets borrow; those stay.
 * Returns the entry ("<date>/<id>") and the files moved.
 */
export async function trashGame(dir, g, system, { now = new Date(), keep = { files: new Set(), key: false }, by = null } = {}) {
  const { roms, art, key } = filesOf(g, system);
  const present = [];
  for (const rel of [...roms, ...art]) {
    const abs = path.join(dir, rel);
    if (!roms.includes(rel) && (keep.key || keep.files.has(path.resolve(abs)))) continue;
    if (inside(dir, abs) && (await exists(abs))) present.push(rel);
  }
  if (!present.some((rel) => roms.includes(rel))) throw shared.trashError("noRom");
  // A patched ROM's original (rom-patch.js) goes with it; its record stays so a restore can still undo the patch.
  const backup = patchOf(g.id)?.backup;
  if (backup && inside(path.join(dir, ".cookingfoil-originals"), path.join(dir, backup)) && (await exists(path.join(dir, backup)))) present.push(backup);
  const mapFile = path.join(dir, "art-map", `${g.system}.json`);
  const map = readJson(mapFile);
  const artMap = map && !keep.key && Object.hasOwn(map, key) ? { file: `art-map/${g.system}.json`, key, value: map[key] } : null;
  const out = await trashFiles(dir, { id: g.id, system: g.system, name: g.name, file: g.file, size: g.size }, present, now, { restoreKeys: artMap ? [artMap] : [], by });
  if (artMap) {
    const { [key]: _gone, ...rest } = map;
    writeJson(mapFile, rest);
  }
  return out;
}

/**
 * Moves `rels` (relative to the retro dir, all present) into a new trash entry
 * named by `item.id` ("<word>-<10 hex>"), all or none. `item` goes into its manifest.
 */
export async function trashFiles(dir, item, rels, now = new Date(), { restoreKeys = [], by = null, action = null } = {}) {
  const core = item.system === "core";
  const { id, ...rest } = item;
  const out = await shared.trashItems(rootOf(dir), rels.map((rel) => ({ rel })), {
    kind: core ? "retro-core" : "retro-game", action: action ?? (core ? "retro-core-replace" : "retro-trash"), by, name: item.name,
    slug: id, restoreKeys, extra: { ...rest, gameId: id },
  }, now);
  return { entry: out.entry, id: out.id, files: out.files };
}

/** Everything in the retro trash, newest first: [{ entry, home, id, trashId, system, name, file, size, trashedAt, files }]. */
export async function listTrash(dir) {
  return (await shared.listRoot(rootOf(dir))).map((e) => ({
    entry: e.entry, home: e.home, id: e.gameId, trashId: e.id, kind: e.kind, system: e.system ?? null, name: e.name, file: e.file ?? null,
    size: e.size, trashedAt: e.trashedAt, files: e.items.map((i) => i.rel),
  }));
}

/**
 * Puts a trashed game or core back. Nothing is overwritten: a game or a core
 * whose name is taken stays in the trash (a game's art and art-map key follow
 * its name, and "x_libretro_libnx (2).nro" is no core) and the call throws a
 * TrashError with status 409; any other entry comes back beside what took its
 * place under a numbered name (listed in `renamed`), unless `exactName` is set,
 * which refuses it the same way.
 *
 * @param {string} dir   the retro folder
 * @param {string} entry "<YYYY-MM-DD>/<id>" as listTrash() gives it
 * @param {string | { home?: string, exactName?: boolean } | null} [opts]
 *   the options, or (as older callers pass it) the home alone. `home`: the trash
 *   folder holding the entry, found when left out. `exactName`: refuse a taken
 *   name instead of numbering. The core swap calls
 *   `restoreEntry(dir, entry, { exactName: true })`.
 * @returns {Promise<{ id, trashId, files: string[], renamed: { rel, to }[] }>}
 *   `files` are the original paths; where each landed is `renamed[].to` when it differs.
 */
export async function restoreEntry(dir, entry, homeOrOpts = null) {
  const { home = null, exactName = false } = homeOrOpts && typeof homeOrOpts === "object" ? homeOrOpts : { home: homeOrOpts };
  if (!/^\d{4}-\d{2}-\d{2}\/[a-z0-9_-]{1,40}$/.test(String(entry))) throw shared.trashError("badEntry", 404);
  const root = rootOf(dir);
  const homes = home ? [home] : shared.homesOf(root);
  const at = homes.find((h) => fs.existsSync(path.join(dir, ...h.split("/"), ...String(entry).split("/")))) ?? homes[0];
  const m = shared.normalizeManifest(readJson(path.join(dir, ...at.split("/"), ...String(entry).split("/"), "manifest.json")), "retro");
  const r = await shared.restoreEntry(root, at, entry, { exactName });
  return { id: m?.gameId ?? null, trashId: r.id, files: r.items.map((i) => i.rel), renamed: r.renamed };
}
