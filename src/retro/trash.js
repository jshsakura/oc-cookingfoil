/**
 * The retro folder's trash. Moving a game there takes its ROM (and the disc
 * files it names; an arcade set's parent and BIOS zips stay, other sets need
 * them) and the three things that follow a ROM's name:
 *
 *   thumbnails/<folder>/Named_Boxarts/<name>.png|.jpg   its own box art
 *   bezels/<folder>/<name>.png, .cfg, _override.cfg     its bezel and configs
 *   art-map/<system>.json                               its key (kept in the manifest)
 *
 * into <retro dir>/.trash/<YYYY-MM-DD>/<game id>/, under the same relative
 * paths, with a manifest.json. The scanner skips dot folders, so the game
 * leaves the lists. Nothing is ever deleted; restoreEntry() puts it all back
 * when nothing has taken its place.
 */
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { romKey, thumbNames } from "./catalog.js";

export const TRASH = ".trash";
const ENTRY_RE = /^\d{4}-\d{2}-\d{2}\/[a-z0-9_-]{1,24}-[0-9a-f]{10}(?:-\d{1,3})?$/;
const IMAGE_EXTS = [".png", ".jpg", ".jpeg"];

export class TrashError extends Error {}

const exists = (abs) => fs.promises.lstat(abs).then(() => true, () => false);
const inside = (root, abs) => path.resolve(abs).startsWith(path.resolve(root) + path.sep);

async function move(from, to) {
  await fsp.mkdir(path.dirname(to), { recursive: true });
  try {
    await fsp.rename(from, to);
  } catch (err) {
    if (err.code !== "EXDEV") throw err;
    await fsp.cp(from, to, { preserveTimestamps: true });
    await fsp.rm(from);
  }
}

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

/** Files under a trash entry other than its manifest. */
async function filesIn(base) {
  const all = await fsp.readdir(base, { recursive: true, withFileTypes: true }).catch(() => []);
  return all.filter((e) => e.isFile() && !(e.name === "manifest.json" && path.resolve(e.parentPath ?? e.path) === path.resolve(base)));
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

/** YYYY-MM-DD in local time. Pure. */
const day = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

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
export async function trashGame(dir, g, system, { now = new Date(), keep = { files: new Set(), key: false } } = {}) {
  const { roms, art, key } = filesOf(g, system);
  const present = [];
  for (const rel of [...roms, ...art]) {
    const abs = path.join(dir, rel);
    if (!roms.includes(rel) && (keep.key || keep.files.has(path.resolve(abs)))) continue;
    if (inside(dir, abs) && (await exists(abs))) present.push(rel);
  }
  if (!present.some((rel) => roms.includes(rel))) throw new TrashError("롬 파일이 없습니다");
  const mapFile = path.join(dir, "art-map", `${g.system}.json`);
  const map = readJson(mapFile);
  const artMap = map && !keep.key && Object.hasOwn(map, key) ? { system: g.system, key, value: map[key] } : null;
  const out = await trashFiles(dir, { id: g.id, system: g.system, name: g.name, file: g.file, size: g.size, artMap }, present, now);
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
export async function trashFiles(dir, item, rels, now = new Date()) {
  let entry = `${day(now)}/${item.id}`;
  for (let i = 2; await exists(path.join(dir, TRASH, entry)); i++) entry = `${day(now)}/${item.id}-${i}`;
  const base = path.join(dir, TRASH, entry);
  // The manifest first: whatever happens after, the trash says where each file came from.
  writeJson(path.join(base, "manifest.json"), { ...item, trashedAt: now.getTime(), files: rels });
  const moved = [];
  try {
    for (const rel of rels) {
      await move(path.join(dir, rel), path.join(base, rel));
      moved.push(rel);
    }
  } catch (err) {
    // Half a game in the trash is worse than none: put back what went, newest first.
    for (const rel of moved.reverse()) await move(path.join(base, rel), path.join(dir, rel)).catch(() => {});
    if (!(await filesIn(base)).length) await fsp.rm(base, { recursive: true, force: true });
    throw new TrashError(`옮기지 못해 되돌렸습니다: ${err.message}`);
  }
  return { entry, files: rels };
}

/** Everything in the trash, newest first: [{ entry, id, system, name, file, size, trashedAt, files }]. */
export async function listTrash(dir) {
  const root = path.join(dir, TRASH);
  const out = [];
  for (const d of await fsp.readdir(root).catch(() => [])) {
    for (const e of await fsp.readdir(path.join(root, d)).catch(() => [])) {
      const entry = `${d}/${e}`;
      const m = ENTRY_RE.test(entry) && readJson(path.join(root, d, e, "manifest.json"));
      if (m) out.push({ entry, id: m.id, system: m.system, name: m.name, file: m.file, size: m.size ?? null, trashedAt: m.trashedAt, files: m.files ?? [] });
    }
  }
  return out.sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0));
}

/** Puts a trashed game back. Refuses (TrashError) when any of its files has been replaced meanwhile. */
export async function restoreEntry(dir, entry) {
  if (!ENTRY_RE.test(String(entry))) throw new TrashError("휴지통 항목이 맞지 않습니다");
  const base = path.join(dir, TRASH, entry);
  const m = readJson(path.join(base, "manifest.json"));
  if (!m) throw new TrashError("휴지통에 없는 항목입니다");
  // Only what the trash still holds: a file that went missing from it is not waited for.
  const files = [];
  for (const rel of m.files ?? []) {
    if (inside(dir, path.join(dir, rel)) && inside(base, path.join(base, rel)) && (await exists(path.join(base, rel)))) files.push(rel);
  }
  for (const rel of files) if (await exists(path.join(dir, rel))) throw new TrashError(`${rel} 자리에 다른 파일이 있습니다`);
  for (const rel of files) await move(path.join(base, rel), path.join(dir, rel));
  if (m.artMap?.key) {
    const mapFile = path.join(dir, "art-map", `${m.artMap.system}.json`);
    const map = readJson(mapFile) ?? {};
    if (!Object.hasOwn(map, m.artMap.key)) writeJson(mapFile, { ...map, [m.artMap.key]: m.artMap.value });
  }
  // Only the manifest and empty folders are left: those go, never a file.
  if (!(await filesIn(base)).length) await fsp.rm(base, { recursive: true });
  return { id: m.id, files };
}
