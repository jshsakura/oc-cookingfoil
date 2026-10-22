/**
 * The pictures of a game in its folder (meta/game-meta.js), and how they are made:
 *
 *   icon.webp  banner.webp  screenshot-01.webp … screenshot-08.webp
 *   <slot>.orig.webp, <slot>.orig.json   the picture before it was cut, to cut again (meta/art-crop.js)
 *
 * A screenshot's file counts from 1; the API's index counts from 0. Every
 * picture is WebP: the console client and the browsers all ask for it.
 */
import fs from "fs";
import path from "path";
import sharp from "sharp";
import * as artCrop from "./art-crop.js";

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

/**
 * A picture put into `dir` by hand (`file`, a .jpg, .jpeg or .png) made into
 * `slot`'s .webp and original. The hand-placed file goes only once both are
 * written; a picture that cannot be read throws and leaves everything as it was.
 */
export async function convertHand(dir, slot, file) {
  const [kind] = kindOf(slot);
  const src = path.join(dir, file);
  const input = await fs.promises.readFile(src);
  const art = await encode(kind, input);
  const original = await artCrop.shrinkOriginal(input);
  const artFile = path.join(dir, `${slot}.webp`);
  writeSlot(artFile, art, original);
  if (!fs.statSync(artFile).size || !fs.statSync(artCrop.originalPaths(artFile).image).size) throw new Error("written empty");
  fs.rmSync(src);
  return artFile;
}
