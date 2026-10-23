/**
 * The area of an uploaded picture an admin chose to keep, and the original kept
 * beside the art so the area can be chosen again without another upload.
 *
 *   <art>.orig.webp   the upload, upright, at most ORIG_MAX on its longest side
 *   <art>.orig.json   { crop: { x, y, w, h }, at }   the area last used, 0..1 of the original
 *
 * `<art>` is the art file without its extension ("…/icon.webp" keeps
 * "…/icon.orig.webp"), so each store keeps its own layout and its own names.
 * The rectangle is a fraction of the upright picture, so it means the same on
 * the full-size upload and on the smaller original kept for later.
 */
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { discard } from "../library/trash-service.js";

export const ORIG_MAX = 2048;
const ORIG_QUALITY = 85;
// The smallest area worth keeping, in pixels of the picture it is cut from.
export const MIN_CROP_PX = 16;
const MAX_INPUT_PIXELS = 50e6;
export const FULL = Object.freeze({ x: 0, y: 0, w: 1, h: 1 });

export class CropError extends Error {}

const round = (n) => Math.round(n * 1e6) / 1e6;

/**
 * The area from a request: an object or its JSON text, each side a fraction 0..1.
 * Absent (undefined, null, "") gives null: the whole picture.
 */
export function parseCrop(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  let v = raw;
  if (typeof v === "string") {
    if (v.length > 200) throw new CropError("자를 영역이 맞지 않습니다");
    try { v = JSON.parse(v); } catch { throw new CropError("자를 영역이 맞지 않습니다"); }
  }
  if (!v || typeof v !== "object") throw new CropError("자를 영역이 맞지 않습니다");
  const r = {};
  for (const k of ["x", "y", "w", "h"]) {
    const n = v[k];
    if (typeof n !== "number" || !Number.isFinite(n)) throw new CropError("자를 영역이 맞지 않습니다");
    r[k] = round(n);
  }
  // A hair of slack for rounding in the browser; anything more is outside the picture.
  const EPS = 1e-4;
  if (r.x < 0 || r.y < 0 || r.w <= 0 || r.h <= 0 || r.x + r.w > 1 + EPS || r.y + r.h > 1 + EPS) {
    throw new CropError("자를 영역이 그림 밖으로 나갑니다");
  }
  return { x: r.x, y: r.y, w: Math.min(r.w, 1 - r.x), h: Math.min(r.h, 1 - r.y) };
}

/** Width and height as the picture stands once its EXIF orientation is applied. */
export async function uprightSize(input, failOn = "error") {
  let m;
  try {
    m = await sharp(input, { failOn, limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch (err) {
    throw new CropError(`이미지를 읽지 못했습니다: ${err.message}`);
  }
  if (!m.width || !m.height) throw new CropError("이미지를 읽지 못했습니다");
  return (m.orientation ?? 1) >= 5 ? { width: m.height, height: m.width } : { width: m.width, height: m.height };
}

/**
 * The chosen area of `input` as a picture the store's own encoder takes next
 * (lossless, so the area is encoded once, by the store). No area: `input` itself.
 */
export async function cropOf(input, crop, { failOn = "error" } = {}) {
  if (!crop) return input;
  const { width, height } = await uprightSize(input, failOn);
  const left = Math.min(width - 1, Math.max(0, Math.round(crop.x * width)));
  const top = Math.min(height - 1, Math.max(0, Math.round(crop.y * height)));
  const w = Math.min(width - left, Math.round(crop.w * width));
  const h = Math.min(height - top, Math.round(crop.h * height));
  if (w < MIN_CROP_PX || h < MIN_CROP_PX) throw new CropError(`자를 영역은 ${MIN_CROP_PX}픽셀 이상이어야 합니다`);
  if (left === 0 && top === 0 && w === width && h === height) return input;
  try {
    return await sharp(input, { failOn, limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .extract({ left, top, width: w, height: h })
      .png({ compressionLevel: 0 })
      .toBuffer();
  } catch (err) {
    throw new CropError(`이미지를 자르지 못했습니다: ${err.message}`);
  }
}

/** The upload, upright and no longer than ORIG_MAX on a side, as the WebP kept for later. */
export async function shrinkOriginal(input, { failOn = "error" } = {}) {
  try {
    return await sharp(input, { failOn, limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize(ORIG_MAX, ORIG_MAX, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: ORIG_QUALITY, effort: 4 })
      .toBuffer();
  } catch (err) {
    throw new CropError(`이미지를 읽지 못했습니다: ${err.message}`);
  }
}

/** Where the original of one art file and its area are kept. */
export function originalPaths(artFile) {
  const stem = artFile.replace(/\.[^./]+$/, "");
  return { image: `${stem}.orig.webp`, meta: `${stem}.orig.json` };
}

function writeAtomic(file, buf) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // A dot name with the pid, like the rest: one left behind is never taken for a picture, two writers never meet.
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, file);
}

/** Keeps `webp` (from shrinkOriginal) as the original of `artFile`, with the area used. */
export function keepOriginal(artFile, webp, crop, now = Date.now(), of = null) {
  const p = originalPaths(artFile);
  writeAtomic(p.image, webp);
  writeCrop(artFile, crop, now, of);
}

/**
 * Records the area now used for `artFile` (its original stays as it is). `of`, when
 * given, is the version of the picture cut from it: one replaced since is not its cut.
 */
export function writeCrop(artFile, crop, now = Date.now(), of = null) {
  writeAtomic(originalPaths(artFile).meta, `${JSON.stringify({ crop: crop ?? FULL, at: now, ...(of ? { of } : {}) })}\n`);
}

/** The kept original of `artFile`: { image, crop, of }, or null when there is none. */
export function readOriginal(artFile) {
  const p = originalPaths(artFile);
  if (!fs.existsSync(p.image)) return null;
  let crop = FULL;
  let of = null;
  try {
    const saved = JSON.parse(fs.readFileSync(p.meta, "utf8"));
    crop = parseCrop(saved?.crop) ?? FULL;
    of = typeof saved?.of === "string" ? saved.of : null;
  } catch { /* no record of the area: the whole picture */ }
  return { image: p.image, crop, of };
}

/** The kept original of `artFile` and its area record, those that exist. */
export function originalFiles(artFile) {
  const p = originalPaths(artFile);
  return [p.image, p.meta].filter((f) => fs.existsSync(f));
}

/** Moves the kept original of `artFile` (and its area) to the trash, when there is one. */
export async function discardOriginal(artFile, action = "art-remove") {
  const files = originalFiles(artFile);
  if (files.length) await discard(files, { kind: "item-art", action, name: path.basename(files[0]) });
}

/**
 * Moves an original along with its art (screenshots closing up after one is taken out). `toArt`'s
 * slot holds no picture by then, so an original still there belongs to nothing and is replaced.
 */
export function moveOriginal(fromArt, toArt) {
  const a = originalPaths(fromArt), b = originalPaths(toArt);
  if (fs.existsSync(a.image)) fs.renameSync(a.image, b.image);
  if (fs.existsSync(a.meta)) fs.renameSync(a.meta, b.meta);
}
