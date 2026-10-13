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

/**
 * A short hash of the game's box art file (path, size, mtime), or null without one.
 * The path is `iconKey` when the catalog gives one: where the file sat before its
 * system folder was renamed, so squares and forwarders made then stay current.
 */
export function artKey(game) {
  if (!game.icon) return null;
  let st;
  try {
    st = fs.statSync(game.icon);
  } catch {
    return null;
  }
  return crypto.createHash("sha1").update(`${game.iconKey ?? game.icon}\0${st.size}\0${st.mtimeMs}`).digest("hex").slice(0, 12);
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

/** The WebP twin of a square (for clients that send `Accept: image/webp`), about a third smaller. */
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
