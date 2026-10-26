/**
 * Square box art for the client app's square tiles. Box art comes in every shape
 * (tall SNES boxes, wide Japanese ones, near-square cartridges), and cropping
 * would cut titles off, so the whole cover sits centred on a blurred, darkened
 * copy of itself.
 *
 * Squares are made ahead of time after each catalog scan, at 256 px (md) and
 * 160 px (sm), and kept in <data dir>/retro-art/, keyed by the source file's
 * size and mtime so a replaced cover is redrawn under a new key (the key is
 * also the icon URL's ?v=, which makes the URL safe to cache for good).
 * Files for games that are gone are removed.
 *
 * The squares stay JPEG on disk. What goes to a screen over HTTP is WebP: the
 * squares' WebP twins, and the box art itself (the detail screen's cover)
 * fitted within 256 px (md) or 160 px (sm) with its own shape and never
 * enlarged, or whole (full). Those are drawn on first use into
 * <data dir>/retro-art/boxart/ under the same key, and dropped with their game
 * like the squares. The covers themselves stay PNG in thumbnails/: RetroArch
 * reads them from the SD card.
 */
import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import sharp from "sharp";
import debug from "../debug.js";

export const SQUARE_PX = 256;
export const SQUARE_SIZES = { md: SQUARE_PX, sm: 160 };
const QUALITY = 82;
const CONCURRENCY = 2;

/** A short hash of the game's box art file (path, size, mtime), or null without one. */
export function artKey(game) {
  if (!game.icon) return null;
  let st;
  try {
    st = fs.statSync(game.icon);
  } catch {
    return null;
  }
  return crypto.createHash("sha1").update(`${game.icon}\0${st.size}\0${st.mtimeMs}`).digest("hex").slice(0, 12);
}

/** Where a game's square lives at `size` (md or sm), or null when it has no box art. */
export function squarePath(artDir, game, size = "md") {
  const key = artKey(game);
  if (!key) return null;
  return path.join(artDir, size === "md" ? `${game.id}-${key}.jpg` : `${game.id}-${key}.${size}.jpg`);
}

// The same file drawn by a request and by prewarm at once is drawn once: both
// wait on one promise, and each draw writes its own temporary name.
const drawing = new Map();
function drawOnce(dest, draw) {
  let p = drawing.get(dest);
  if (!p) {
    const tmp = `${dest}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    p = draw(tmp)
      .then(() => fsp.rename(tmp, dest))
      .catch(async (err) => { await fsp.rm(tmp, { force: true }); throw err; })
      .finally(() => drawing.delete(dest));
    drawing.set(dest, p);
  }
  return p;
}

export const BOXART_SIZES = { md: SQUARE_PX, sm: 160 };
const BOXART_DIR = "boxart";

/**
 * The box art as WebP: fitted within `size` (md 256, sm 160), never enlarged,
 * or whole for "full". Null without box art.
 */
export async function ensureBoxart(artDir, game, size = "md") {
  const key = artKey(game);
  if (!key) return null;
  const px = size === "full" ? null : BOXART_SIZES[size] ?? SQUARE_PX;
  const dest = path.join(artDir, BOXART_DIR, `${game.id}-${key}.${px ? size : "full"}.webp`);
  if (fs.existsSync(dest)) return dest;
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await drawOnce(dest, (tmp) => {
    const img = sharp(game.icon, { failOn: "none" });
    const fitted = px ? img.resize(px, px, { fit: "inside", withoutEnlargement: true }) : img;
    return fitted.webp({ quality: 75, effort: 6 }).toFile(tmp);
  });
  return dest;
}

/** The WebP twin of a square, the one sent to screens, about a third smaller. */
export const webpPath = (square) => square.replace(/\.jpg$/, ".webp");

/** The WebP twin of a game's square, made from the JPEG square on first use; null without box art. */
export async function ensureSquareWebp(artDir, game, size = "md") {
  const square = await ensureSquare(artDir, game, size);
  if (!square) return null;
  const dest = webpPath(square);
  if (!fs.existsSync(dest)) await drawOnce(dest, (tmp) => sharp(square).webp({ quality: 75, effort: 6 }).toFile(tmp));
  return dest;
}

/** Draw the square for `src` into `dest`. */
export async function makeSquare(src, dest, size = SQUARE_PX) {
  const backdrop = await sharp(src, { failOn: "none" })
    .resize(size, size, { fit: "cover" })
    .blur(size / 14)
    .modulate({ brightness: 0.55 })
    .toBuffer();
  const cover = await sharp(src, { failOn: "none" }).resize(size, size, { fit: "inside" }).toBuffer();
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await drawOnce(dest, (tmp) => sharp(backdrop).composite([{ input: cover, gravity: "centre" }]).jpeg({ quality: QUALITY, mozjpeg: true }).toFile(tmp));
}

/** The square for one game at `size`, drawn now if it isn't on disk yet; null without box art. */
export async function ensureSquare(artDir, game, size = "md") {
  const dest = squarePath(artDir, game, size);
  if (!dest) return null;
  if (!fs.existsSync(dest)) await makeSquare(game.icon, dest, SQUARE_SIZES[size]);
  return dest;
}

let running = null;

/** Draw every missing square and drop the ones no game uses any more. */
export function prewarm(artDir, games) {
  if (running) return running;
  running = (async () => {
    const wanted = new Set();
    const todo = [];
    for (const g of games) {
      for (const [size, px] of Object.entries(SQUARE_SIZES)) {
        const dest = squarePath(artDir, g, size);
        if (!dest) break;
        wanted.add(path.basename(dest));
        if (!fs.existsSync(dest)) todo.push([g, dest, px]);
      }
    }
    let made = 0;
    let next = 0;
    await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
      while (next < todo.length) {
        const [g, dest, px] = todo[next++];
        try {
          await makeSquare(g.icon, dest, px);
          made++;
        } catch (err) {
          debug.error("retro: square art for %s failed: %s", g.id, err.message);
        }
      }
    }));
    let removed = 0;
    // <id>-<key>.<size>.<ext>: everything up to the first dot names the game and its cover.
    const keys = new Set(games.map((g) => { const k = artKey(g); return k && `${g.id}-${k}`; }).filter(Boolean));
    // Box art is WebP only: a .png or .jpg there was drawn by an older server for clients without WebP.
    for (const f of await fsp.readdir(path.join(artDir, BOXART_DIR)).catch(() => [])) {
      if (!keys.has(f.slice(0, f.indexOf("."))) || /\.(png|jpg)$/.test(f)) {
        await fsp.rm(path.join(artDir, BOXART_DIR, f), { force: true });
        removed++;
      }
    }
    for (const f of await fsp.readdir(artDir).catch(() => [])) {
      if ((f.endsWith(".jpg") && !wanted.has(f)) || (f.endsWith(".webp") && !wanted.has(f.replace(/\.webp$/, ".jpg")))) {
        await fsp.rm(path.join(artDir, f), { force: true });
        removed++;
      }
    }
    if (made || removed) debug.log("retro: square art %d drawn, %d removed", made, removed);
  })().finally(() => (running = null));
  return running;
}
