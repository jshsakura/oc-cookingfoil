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
import { AHEAD_MS } from "./folder-watch.js";

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
// Past this a hand-placed file is no picture of a slot's size (50e6 pixels as an uncompressed PNG is 200 MB), and is never read whole.
const MAX_HAND_BYTES = 256 * 1024 * 1024;
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

/**
 * Copies `src` into `dir`/`sub`/ as `name`, as `icon (2).png` and so on when
 * that is taken, so nothing there is written over. Its new path; throws
 * StuckError when it cannot be copied.
 */
export function copyAside(src, dir, sub, name) {
  const to = path.join(dir, sub);
  const { name: stem, ext } = path.parse(name);
  try {
    fs.mkdirSync(to, { recursive: true });
    for (let n = 1; ; n++) {
      const dest = path.join(to, n === 1 ? name : `${stem} (${n})${ext}`);
      try {
        fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL);
        return dest;
      } catch (err) {
        if (err.code !== "EEXIST") throw err;
      }
    }
  } catch (err) {
    throw new StuckError(`${src} cannot be copied to ${sub}/: ${err.message}`);
  }
}

/**
 * Whether a file was written or changed within the last `quietMs` (its mtime or
 * its ctime): a copy may still be going on. A time a moment ahead of now counts
 * (a file stamped within the same millisecond, a file server's clock a little
 * ahead), one further ahead does not (the watch's AHEAD_MS). Pure.
 */
export function isFresh(st, quietMs, now = Date.now()) {
  return quietMs > 0 && [st.mtimeMs, st.ctimeMs].some((t) => now - t > -AHEAD_MS && now - t < quietMs);
}

/**
 * Whether every file of `paths` holds still across `ms`: looked at once, then
 * once more after the wait, its size, times and inode the same (one gone both
 * times counts as still). A copy going on changes one of them meanwhile.
 */
export async function holdsStill(paths, ms) {
  const before = paths.map(statOf);
  await new Promise((resolve) => setTimeout(resolve, ms));
  return paths.every((p, i) => {
    const now = statOf(p);
    return now && before[i] ? fileStamp(now) === fileStamp(before[i]) : !now && !before[i];
  });
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
 * them would stay: a move that fails throws StuckError first. The taken file
 * stays where it is until the slot holds it, so a stop at any point leaves
 * either the slot as it was or the same picture for the next look to take.
 *
 * Nothing is done while one of them was written within `quietMs` (a copy may
 * still be going on): { taken: null, waitMs } then, how long until it is quiet.
 * `settleMs` (the admin asked, from the folder button): such files are taken
 * all the same when they hold still across that wait instead (holdsStill).
 * `ready()`, asked right before anything is moved, may say the slot changed
 * meanwhile; null then, and also when a file changed while it was read (the
 * next look decides). { taken } else: the file made into the slot, or null when none read.
 */
export async function takeSlot(dir, slot, files, { ready = () => true, quietMs = 0, settleMs = 0 } = {}) {
  const [kind] = kindOf(slot);
  const waitMs = (st) => (st && isFresh(st, quietMs) ? quietMs - (Date.now() - Math.max(st.mtimeMs, st.ctimeMs)) : 0);
  const waitAll = () => Math.max(0, ...files.map((f) => waitMs(statOf(path.join(dir, f)))));
  if (waitAll() && !(settleMs && await holdsStill(files.map((f) => path.join(dir, f)), settleMs))) {
    const wait = waitAll();
    if (wait) return { taken: null, waitMs: wait };
  }
  for (let i = 0; i < files.length; i++) {
    const src = path.join(dir, files[i]);
    if ((statOf(src)?.size ?? 0) > MAX_HAND_BYTES) {
      moveAside(dir, files[i], UNREADABLE);
      debug.error("game art: %s is larger than any picture taken, moved to %s/", src, UNREADABLE);
      continue;
    }
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
      // One still being written may read as broken: left where it is for the next look.
      if (!same()) return null;
      const fresh = waitMs(statOf(src));
      if (fresh) return { taken: null, waitMs: fresh };
      moveAside(dir, files[i], UNREADABLE);
      debug.error("game art: %s is not a picture that can be read, moved to %s/: %s", src, UNREADABLE, err.message);
      continue;
    }
    if (!same() || !ready()) return null;
    for (const other of files.slice(i + 1)) if (statOf(path.join(dir, other))) moveAside(dir, other, REPLACED);
    const artFile = path.join(dir, `${slot}.webp`);
    writeSlot(artFile, art, original);
    if (!fs.statSync(artFile).size || !fs.statSync(artCrop.originalPaths(artFile).image).size) throw new Error(`${artFile} was written empty`);
    // Changed while the slot was written: it stays, and the next look takes it.
    if (same()) {
      try {
        fs.rmSync(src);
      } catch (err) {
        debug.error("game art: %s is made into %s.webp but cannot be removed: %s", src, slot, err.message);
      }
    }
    return { taken: files[i] };
  }
  return { taken: null };
}
