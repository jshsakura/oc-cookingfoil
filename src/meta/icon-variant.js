/**
 * A small square icon held in memory (a homebrew app's icon, read from its
 * .nro) at the size a client shows it: ?size=sm 160 px or md 256 px (the
 * default), never enlarged, as WebP for every client.
 *
 * WebP is quality 75 at the slowest effort, the same as the library's icon
 * variants (image-cache.js). Results are memoized by the caller's key (which
 * names the build), so one icon is drawn once per size.
 */
import sharp from "sharp";
import debug from "../debug.js";

export const ICON_SIZES = { sm: 160, md: 256 };
const WEBP_OPTIONS = { quality: 75, effort: 6 };
const MEMO_MAX = 256;
const memo = new Map(); // key -> Promise<{ body, type }>

const isPng = (buf) => buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47;
const ownType = (buf) => (isPng(buf) ? "image/png" : "image/jpeg");

async function draw(buf, px) {
  try {
    const sized = sharp(buf, { failOn: "none" }).resize(px, px, { fit: "inside", withoutEnlargement: true });
    return { body: await sized.webp(WEBP_OPTIONS).toBuffer(), type: "image/webp" };
  } catch (err) {
    // Not a picture sharp can read: send what the app carries.
    debug.cache("icon variant: %s", err.message);
    return { body: buf, type: ownType(buf) };
  }
}

/** The icon for one request: { body, type }. `key` must change whenever buf can. */
export function iconVariant(key, buf, { size }) {
  const px = ICON_SIZES[size] ?? ICON_SIZES.md;
  const k = `${key}\0${px}`;
  let p = memo.get(k);
  if (!p) {
    p = draw(buf, px);
    memo.set(k, p);
    if (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value);
  }
  return p;
}
