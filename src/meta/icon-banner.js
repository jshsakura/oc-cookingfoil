/**
 * A game's banner, drawn from its icon: the icon blown up and blurred to fill
 * a 16:9 frame, darkened, with the icon itself in the middle. Game files carry
 * no banner, so this is every banner the admin did not upload.
 *
 * Drawn once into data/icons/<id>.banner[.<lang>].jpg and again only when the
 * icon it came from is newer. The language's own icon gives that language's
 * banner; the admin's icon, when there is one, gives every language's
 * (as <id>.banner.custom.jpg).
 */
import fs from "fs";
import path from "path";
import { mkdir, rename, writeFile } from "fs/promises";
import sharp from "sharp";
import * as customArt from "./custom-art.js";
import { cachePathFor, dropVariants, hasCached } from "./image-cache.js";
import { fillPath, iconFallback, noteWritten } from "./art-fill.js";

/** Raised when the drawing changes, so every banner URL changes with it (artwork-version.js). */
export const BANNER_STYLE = 1;

const WIDTH = 1280;
const HEIGHT = 720;
const ICON_PX = 432;
const BLUR_SIGMA = 40;
const DIM = 0.55;

const drawing = new Map();

const mtimeOf = (file) => {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return -1;
  }
};

/** The icon a banner is drawn from, or null when the game has none on disk. */
function iconFileFor(base, lang) {
  const custom = customArt.serveOptions(base, "icon", null).overridePath;
  if (custom) return { file: custom, lang: null, custom: true };
  const own = lang ? cachePathFor(base, "icon-lang", lang) : null;
  if (own && hasCached(own)) return { file: own, lang };
  const icon = cachePathFor(base, "icon");
  if (hasCached(icon)) return { file: icon, lang: null };
  // A game whose files carry no icon: the one filled in from outside (meta/art-fill.js), drawn into that folder.
  const filled = iconFallback(base);
  return filled ? { file: filled, lang: null, filled: true } : null;
}

/** The banner as a JPEG buffer, from the icon's bytes. */
export async function drawBanner(iconBytes) {
  const back = await sharp(iconBytes, { failOn: "none" })
    .resize(WIDTH, HEIGHT, { fit: "cover" })
    .blur(BLUR_SIGMA)
    .modulate({ brightness: DIM })
    .toBuffer();
  const front = await sharp(iconBytes, { failOn: "none" }).resize(ICON_PX, ICON_PX, { fit: "cover" }).toBuffer();
  return sharp(back).composite([{ input: front, gravity: "center" }]).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
}

/** Path of the game's banner for `lang` (drawn now if missing or older than its icon), or null without an icon. */
export async function ensureBanner(base, lang = null) {
  const source = iconFileFor(base, lang);
  if (!source) return null;
  const plain = cachePathFor(base, "banner");
  // The admin's icon draws a banner of its own name, so taking that icon away brings back the game file's.
  const out = source.filled ? fillPath(base, "drawn") : source.custom ? plain.replace(/\.jpg$/, ".custom.jpg") : source.lang ? cachePathFor(base, "banner-lang", source.lang) : plain;
  if (mtimeOf(out) >= mtimeOf(source.file)) return out;
  let pending = drawing.get(out);
  if (!pending) {
    pending = (async () => {
      const buf = await drawBanner(fs.readFileSync(source.file));
      await mkdir(path.dirname(out), { recursive: true });
      const tmp = `${out}.tmp.${process.pid}`;
      await writeFile(tmp, buf);
      await rename(tmp, out);
      dropVariants(out);
      if (source.filled) noteWritten(out);
      return out;
    })().finally(() => drawing.delete(out));
    drawing.set(out, pending);
  }
  return pending;
}
