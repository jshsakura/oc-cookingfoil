/**
 * Title artwork the admin gives a game (icon, banner, up to eight
 * screenshots). It wins over titledb's CDN pictures and the game file's own.
 *
 * Kept in the game's folder as WebP (meta/game-art-files.js names them), read
 * through meta/game-meta.js, so the image routes ask memory whether a slot has a
 * picture and never the disk. An upload is cut to the area chosen
 * (meta/art-crop.js) and encoded once: upright, no metadata, inside the slot's
 * size; a picture that cannot be read is refused here rather than served.
 *
 * custom-art/ is where an older server kept them (<BASE>.icon.jpg,
 * <BASE>.banner.jpg, <BASE>.screen.<n>.jpg, each with <art>.orig.webp/.orig.json);
 * migrate() moves what is left there into the folders.
 */
import fs from "fs";
import path from "path";
import sharp from "sharp";

import { customArtDir } from "../helpers/envs.js";
import { forget, thumbVariantPaths } from "./image-cache.js";
import debug from "../debug.js";
import * as artCrop from "./art-crop.js";
import * as gameMeta from "./game-meta.js";
import { copyAside, encode, slotName, writeAtomic, writeSlot, KINDS, MAX_SCREENSHOTS, REPLACED } from "./game-art-files.js";

export { KINDS, MAX_SCREENSHOTS };

const TITLE_ID_RE = /^[0-9A-F]{16}$/;
// What custom-art/ held: <BASE>.icon.jpg | <BASE>.banner.jpg | <BASE>.screen.<n>.jpg
const OLD_FILE_RE = /^([0-9A-F]{16})\.(icon|banner|screen\.(\d+))\.jpg$/;

export function normalizeBase(raw) {
  if (typeof raw !== "string") return null;
  const hex = raw.toUpperCase().replace(/[^0-9A-F]/g, "");
  return TITLE_ID_RE.test(hex) ? hex : null;
}

/** The picture in a slot: its file, or null when the slot has none. */
export function pathFor(base, kind, idx) {
  return gameMeta.art(base, slotName(kind, idx))?.path ?? null;
}

/** Whether the admin gave this slot a picture. From memory. */
export function hasOverride(base, kind, idx) {
  return Boolean(gameMeta.art(base, slotName(kind, idx)));
}

/** What decides a slot's bytes (its file's mtime and size), or null. From memory. */
export function stampOf(base, kind, idx) {
  return gameMeta.art(base, slotName(kind, idx))?.stamp ?? null;
}

/**
 * serveImage's options for a slot: the picture, where its small copies go, and
 * what to do when the picture is found gone (its folder renamed or deleted by
 * hand: the game is read again); {} when it has none.
 */
export function serveOptions(base, kind, idx) {
  const slot = slotName(kind, idx);
  const a = gameMeta.art(base, slot);
  return a ? { overridePath: a.path, overrideThumbs: gameMeta.thumbBase(base, slot, a.stamp), overrideGone: () => gameMeta.vanished(base) } : {};
}

/** Which slots have a picture: { icon, banner, screens: [idx] }. */
export function list(base) {
  return gameMeta.slots(base);
}

/** Lowest free screenshot index, or null when the cap is reached. */
export function nextScreenshotIdx(base) {
  const used = new Set(list(base).screens);
  for (let i = 0; i < MAX_SCREENSHOTS; i++) {
    if (!used.has(i)) return i;
  }
  return null;
}

/** Reads the game folders now (meta/game-meta.js), for a start or a test. */
export async function init() {
  await gameMeta.scan();
}

/**
 * Stores an upload in a slot. `crop` ({ x, y, w, h }, 0..1, or null for all of
 * it) is the area kept; the upload itself is kept smaller beside the picture so
 * the area can change later. Throws on a picture that cannot be read. Each
 * write here waits for the game's others (gameMeta.withGame), and moves the
 * hand-placed files waiting for its slot to the folder's .replaced/ first
 * (gameMeta.clearSlot): one that cannot be moved stops it before anything is written.
 */
export function put(base, kind, idx, input, crop = null) {
  return gameMeta.withGame(base, () => putNow(base, kind, idx, input, crop));
}

async function putNow(base, kind, idx, input, crop) {
  const art = await encode(kind, await artCrop.cropOf(input, crop));
  const original = await artCrop.shrinkOriginal(input);
  const file = path.join(gameMeta.ensureFolder(base), `${slotName(kind, idx)}.webp`);
  gameMeta.clearSlot(base, slotName(kind, idx));
  writeSlot(file, art, original, crop);
  forget(file);
  gameMeta.refresh(base);
  debug.log("custom-art: stored %s (%d bytes)", path.relative(gameMeta.GAMES_DIR, file), art.length);
  return { path: file, bytes: art.length };
}

/** Cuts the slot again from the original kept at upload. Throws CropError when none is kept. */
export function recrop(base, kind, idx, crop) {
  return gameMeta.withGame(base, () => recropNow(base, kind, idx, crop));
}

async function recropNow(base, kind, idx, crop) {
  gameMeta.refresh(base);
  const file = pathFor(base, kind, idx);
  const kept = file ? artCrop.readOriginal(file) : null;
  if (!kept) throw new artCrop.CropError("다시 자를 원본이 없습니다");
  const art = await encode(kind, await artCrop.cropOf(await fs.promises.readFile(kept.image), crop));
  gameMeta.clearSlot(base, slotName(kind, idx));
  writeAtomic(file, art);
  artCrop.writeCrop(file, crop);
  forget(file);
  gameMeta.refresh(base);
  return { path: file, bytes: art.length };
}

/** The original kept for a slot: { image, crop }, or null. */
export function original(base, kind, idx) {
  const file = pathFor(base, kind, idx);
  return file ? artCrop.readOriginal(file) : null;
}

/** The area each kept original was cut to: { icon, banner, screens: { <idx>: crop } } (null when none is kept). */
export function originals(base) {
  const screens = {};
  for (const i of list(base).screens) {
    const o = original(base, "screenshot", i);
    if (o) screens[i] = o.crop;
  }
  return { icon: original(base, "icon", null)?.crop ?? null, banner: original(base, "banner", null)?.crop ?? null, screens };
}

/** Takes a slot's picture out, with its kept original; the folder goes too when nothing is left in it. */
export function remove(base, kind, idx) {
  return gameMeta.withGame(base, () => removeNow(base, kind, idx));
}

function removeNow(base, kind, idx) {
  gameMeta.refresh(base);
  const file = pathFor(base, kind, idx);
  if (!file) return;
  gameMeta.clearSlot(base, slotName(kind, idx));
  fs.rmSync(file, { force: true });
  artCrop.removeOriginal(file);
  forget(file);
  try {
    fs.rmdirSync(path.dirname(file));
  } catch { /* not empty */ }
  gameMeta.refresh(base);
  debug.log("custom-art: removed %s", path.relative(gameMeta.GAMES_DIR, file));
}

/** Whether `file` is a picture sharp reads whole. */
async function readable(file) {
  try {
    const m = await sharp(file, { failOn: "error" }).metadata();
    return Boolean(m.width && m.height);
  } catch {
    return false;
  }
}

/** Whether `file` holds exactly `bytes`. */
function holds(file, bytes) {
  try {
    return fs.readFileSync(file).equals(bytes);
  } catch {
    return false;
  }
}

/**
 * Moves one picture of custom-art/ into its game's folder, as an upload would:
 * the hand-placed files waiting for its slot go to .replaced/ first. Nothing
 * found is deleted unless the same picture is in place: what the slot held
 * before is copied to .replaced/ first, and an old picture the slot keeps a
 * newer one over goes there too, named for its slot so it can be put back.
 * Throws, leaving the old files, when it cannot.
 */
async function moveOld(name, base, kind, idx) {
  const slot = slotName(kind, idx);
  if (!slot) throw new Error(`no slot for ${name}`);
  const from = path.join(customArtDir, name);
  const fromOrig = artCrop.originalPaths(from);
  const dir = gameMeta.ensureFolder(base);
  gameMeta.clearSlot(base, slot);
  const to = path.join(dir, `${slot}.webp`);
  const toOrig = artCrop.originalPaths(to);
  const input = fs.readFileSync(from);
  const original = fs.existsSync(fromOrig.image) ? fs.readFileSync(fromOrig.image) : await artCrop.shrinkOriginal(input);
  const olds = [[from, `${slot}.jpg`], [fromOrig.image, `${slot}.orig.webp`], [fromOrig.meta, `${slot}.orig.json`]].filter(([f]) => fs.existsSync(f));
  const there = fs.statSync(to, { throwIfNoEntry: false });
  // A picture there that reads, as new as the old one: a move that stopped halfway, or a newer upload.
  if (there && there.mtimeMs >= fs.statSync(from).mtimeMs && (await readable(to))) {
    if (!holds(toOrig.image, original)) for (const [file, as] of olds) copyAside(file, dir, REPLACED, as);
  } else {
    const art = await encode(kind, input);
    for (const file of [to, toOrig.image, toOrig.meta]) if (fs.existsSync(file)) copyAside(file, dir, REPLACED, path.basename(file));
    writeAtomic(toOrig.image, original);
    if (fs.existsSync(fromOrig.meta)) writeAtomic(toOrig.meta, fs.readFileSync(fromOrig.meta));
    else artCrop.writeCrop(to, null);
    writeAtomic(to, art);
    if (!(await readable(to))) throw new Error(`${to} does not read back`);
  }
  for (const old of [...olds.map(([file]) => file), ...thumbVariantPaths(from)]) fs.rmSync(old, { force: true });
  gameMeta.refresh(base);
}

/**
 * Moves the pictures an older server kept in custom-art/ into the game
 * folders. An old file goes only once its new one is written and reads back,
 * or once it is kept in the folder's .replaced/; one that cannot move stays and
 * is logged. { moved, failed }
 */
export async function migrate() {
  let names;
  try {
    names = fs.readdirSync(customArtDir).sort();
  } catch (err) {
    if (err.code !== "ENOENT") debug.error("custom-art: reading %s: %s", customArtDir, err.message);
    return { moved: 0, failed: 0 };
  }
  let moved = 0, failed = 0;
  for (const name of names) {
    const m = OLD_FILE_RE.exec(name);
    if (!m) continue;
    const [kind, idx] = m[2] === "icon" || m[2] === "banner" ? [m[2], null] : ["screenshot", Number(m[3])];
    try {
      await gameMeta.withGame(m[1], () => moveOld(name, m[1], kind, idx));
      moved++;
    } catch (err) {
      failed++;
      debug.error("custom-art: %s stays in %s: %s", name, customArtDir, err.message);
    }
  }
  if (moved) debug.log("custom-art: moved %d picture(s) into %s", moved, gameMeta.GAMES_DIR);
  try {
    fs.rmdirSync(customArtDir);
  } catch { /* still holds something */ }
  return { moved, failed };
}
