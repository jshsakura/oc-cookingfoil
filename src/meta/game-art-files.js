/**
 * The pictures of a game in its folder (meta/game-meta.js), and how they are made:
 *
 *   icon.webp  banner.webp  screenshot-01.webp … screenshot-08.webp
 *   <slot>.orig.webp, <slot>.orig.json   the picture before it was cut, to cut again (meta/art-crop.js)
 *   .replaced/  .unreadable/             hand-placed files a look or an upload put aside (takeSlot)
 *
 * A screenshot's file counts from 1; the API's index counts from 0. Every
 * picture is WebP: the console client and the browsers all ask for it.
 */
import fs from "fs";
import path from "path";
import sharp from "sharp";
import * as artCrop from "./art-crop.js";
import debug from "../debug.js";

export const KINDS = ["icon", "banner", "screenshot"];
export const MAX_SCREENSHOTS = 8;

// Icons are shown square, banners and screenshots wide. `inside` without
// enlargement keeps the shape and never blows a small picture up.
const ENCODE = {
  icon:       { width: 1024, height: 1024, quality: 88 },
  banner:     { width: 1280, height: 720,  quality: 85 },
  screenshot: { width: 1280, height: 720,  quality: 85 },
};
const MAX_INPUT_PIXELS = 50e6;
// <slot>[.orig].<ext>; a hand-placed picture may be named in any case.
const NAME_RE = /^(icon|banner|screenshot-0[1-8])(\.orig)?\.(webp|json|jpe?g|png)$/i;
const SLOT_RE = /^(icon|banner|screenshot-0[1-8])$/;

/** The slot of a kind and index: "icon", "banner", "screenshot-01" for index 0; null when it names none. Pure. */
export function slotName(kind, idx) {
  if (kind === "icon" || kind === "banner") return kind;
  const n = Number(idx);
  if (kind !== "screenshot" || !Number.isInteger(n) || n < 0 || n >= MAX_SCREENSHOTS) return null;
  return `screenshot-${String(n + 1).padStart(2, "0")}`;
}

/** [kind, idx] of a slot name; idx is null for an icon or banner. Pure. */
export function kindOf(slot) {
  if (!SLOT_RE.test(slot)) return null;
  return slot.startsWith("screenshot-") ? ["screenshot", Number(slot.slice(-2)) - 1] : [slot, null];
}

/**
 * What a file in a game folder is: { slot, role } with role "art" (the slot's
 * own .webp), "orig" (kept to cut again) or "hand" (a .jpg, .jpeg or .png put
 * there by hand, to be made into the slot's .webp); null for anything else. Pure.
 */
export function classify(name) {
  const m = NAME_RE.exec(name);
  if (!m) return null;
  const slot = m[1].toLowerCase();
  const ext = m[3].toLowerCase();
  if (m[2]) return ext === "webp" || ext === "json" ? { slot, role: "orig" } : null;
  if (ext === "webp") return name === `${slot}.webp` ? { slot, role: "art" } : null;
  if (ext === "json") return null;
  return { slot, role: "hand" };
}

/**
 * A picture as the WebP kept for a slot: upright by its EXIF orientation, no
 * metadata left, inside the kind's size. Throws on a picture that cannot be read.
 */
export function encode(kind, input) {
  const cfg = ENCODE[kind] ?? ENCODE.icon;
  return sharp(input, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize(cfg.width, cfg.height, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: cfg.quality, effort: 4 })
    .toBuffer();
}

export function writeAtomic(file, buf) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // A dot name, so one left behind by a crash is never taken for a picture.
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, file);
}

/** Writes a slot's picture and its original; the picture last, so one on disk always has its original beside it. */
export function writeSlot(artFile, art, original, crop = null) {
  if (original) artCrop.keepOriginal(artFile, original, crop);
  writeAtomic(artFile, art);
}

/** Which hand-placed file this is, to tell it changed between two looks: its inode, size and mtime. Pure. */
export const handStamp = (st) => `${st.ino}:${st.size}:${st.mtimeMs}`;
// What a hand-placed file was when it was read, stricter: anything done to it since differs.
const fileStamp = (st) => `${st.mtimeMs}:${st.ctimeMs}:${st.size}:${st.ino}`;
const statOf = (file) => fs.statSync(file, { throwIfNoEntry: false });

// Where hand-placed files go once a look has dealt with them: dot folders in the game's folder,
// which no look and no watch reads, so nothing there is ever taken again.
export const REPLACED = ".replaced";
export const UNREADABLE = ".unreadable";

/** A move of a hand-placed file that failed (a folder or disk that cannot be written): nothing was written. */
export class StuckError extends Error {}

/**
 * Moves `file` of `dir` into `dir`/`sub`/, as `icon (2).png` and so on when its
 * name is taken there, so nothing there is written over. Its new path; throws
 * StuckError when it cannot be moved.
 */
export function moveAside(dir, file, sub) {
  const to = path.join(dir, sub);
  const { name, ext } = path.parse(file);
  try {
    fs.mkdirSync(to, { recursive: true });
    let dest = path.join(to, file);
    for (let n = 2; statOf(dest); n++) dest = path.join(to, `${name} (${n})${ext}`);
    fs.renameSync(path.join(dir, file), dest);
    return dest;
  } catch (err) {
    throw new StuckError(`${path.join(dir, file)} cannot be moved to ${sub}/: ${err.message}`);
  }
}

/** A hand-placed file read whole: { input, read } (read: its stat), or null when it is gone. */
async function readHand(src) {
  let fh;
  try {
    fh = await fs.promises.open(src);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw new StuckError(`${src} cannot be read: ${err.message}`);
  }
  try {
    return { read: await fh.stat(), input: await fh.readFile() };
  } finally {
    await fh.close();
  }
}

/**
 * Makes slot `slot` of `dir` from the hand-placed files there for it (`files`,
 * newest first), and leaves none of them in the folder: the first that reads
 * as a picture becomes the slot's .webp and original and is deleted once both
 * are written; the others move to .replaced/; one that does not read moves to
 * .unreadable/ (logged) and the next is tried. Nothing is written while one of
 * them would stay: a move that fails throws StuckError first. `ready()`, asked
 * right before anything is moved, may say the slot changed meanwhile; null
 * then, and also when a file changed while it was read (the next look decides).
 * { taken } else: the file made into the slot, or null when none read.
 */
export async function takeSlot(dir, slot, files, { ready = () => true } = {}) {
  const [kind] = kindOf(slot);
  for (let i = 0; i < files.length; i++) {
    const src = path.join(dir, files[i]);
    const got = await readHand(src);
    if (!got) continue;
    const same = () => {
      const st = statOf(src);
      return Boolean(st) && fileStamp(st) === fileStamp(got.read);
    };
    let art, original;
    try {
      art = await encode(kind, got.input);
      original = await artCrop.shrinkOriginal(got.input);
    } catch (err) {
      // One still being written may read as broken: left for the next look.
      if (!same()) return null;
      moveAside(dir, files[i], UNREADABLE);
      debug.error("game art: %s is not a picture that can be read, moved to %s/: %s", src, UNREADABLE, err.message);
      continue;
    }
    if (!same() || !ready()) return null;
    for (const other of files.slice(i + 1)) if (statOf(path.join(dir, other))) moveAside(dir, other, REPLACED);
    // Held in .replaced/ until the slot is written: should the write fail, it goes back.
    const held = moveAside(dir, files[i], REPLACED);
    const artFile = path.join(dir, `${slot}.webp`);
    try {
      writeSlot(artFile, art, original);
      if (!fs.statSync(artFile).size || !fs.statSync(artCrop.originalPaths(artFile).image).size) throw new Error("written empty");
    } catch (err) {
      // Back where it was, unless a file took that name meanwhile: it stays in .replaced/ then, not lost.
      if (!statOf(src)) {
        try {
          fs.renameSync(held, src);
        } catch { /* stays in .replaced/ */ }
      }
      throw err;
    }
    try {
      fs.rmSync(held);
      fs.rmdirSync(path.dirname(held));
    } catch (err) {
      // ENOTEMPTY: .replaced/ holds others, and stays.
      if (err.code !== "ENOTEMPTY" && err.code !== "EEXIST") debug.error("game art: %s is made into %s.webp; tidying %s/: %s", src, slot, REPLACED, err.message);
    }
    return { taken: files[i] };
  }
  return { taken: null };
}
