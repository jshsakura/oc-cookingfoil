/**
 * A small square icon held in memory (a homebrew app's icon, read from its
 * .nro) at the size a client shows it: ?size=sm 160 px or md 256 px (the
 * default), never enlarged, as WebP for a client that sends Accept: image/webp.
 * A client without WebP gets the icon's own bytes when they already fit, or a
 * JPEG of that size.
 *
 * WebP is quality 75 at the slowest effort, the same as the shop's icon
 * variants (image-cache.js). Results are memoized by the caller's key (which
 * names the build), so one icon is drawn once per size and format.
 */
import sharp from "sharp";
import debug from "../debug.js";

export const ICON_SIZES = { sm: 160, md: 256 };
const WEBP_OPTIONS = { quality: 75, effort: 6 };
const JPEG_QUALITY = 80;
const MEMO_MAX = 256;
const memo = new Map(); // key -> Promise<{ body, type }>

const isPng = (buf) => buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47;
const ownType = (buf) => (isPng(buf) ? "image/png" : "image/jpeg");

async function draw(buf, px, webp) {
  try {
    const img = sharp(buf, { failOn: "none" });
    const { width = 0, height = 0 } = await img.metadata();
    const fits = width <= px && height <= px;
    if (!webp && fits) return { body: buf, type: ownType(buf) };
    const sized = fits ? img : img.resize(px, px, { fit: "inside", withoutEnlargement: true });
    return webp
      ? { body: await sized.webp(WEBP_OPTIONS).toBuffer(), type: "image/webp" }
      : { body: await sized.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer(), type: "image/jpeg" };
  } catch (err) {
    // Not a picture sharp can read: send what the app carries.
    debug.cache("icon variant: %s", err.message);
    return { body: buf, type: ownType(buf) };
  }
}

/** The icon for one request: { body, type }. `key` must change whenever buf can. */
export function iconVariant(key, buf, { size, webp }) {
  const px = ICON_SIZES[size] ?? ICON_SIZES.md;
  const k = `${key}\0${px}\0${webp ? "webp" : "own"}`;
  let p = memo.get(k);
  if (!p) {
    p = draw(buf, px, webp);
    memo.set(k, p);
    if (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value);
  }
  return p;
}
