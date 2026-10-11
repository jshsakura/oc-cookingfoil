/**
 * Square box art for the Switch's square tiles. Box art comes in every shape
 * (tall SNES boxes, wide Japanese ones, near-square cartridges), and cropping
 * would cut titles off, so the whole cover sits centred on a blurred, darkened
 * copy of itself.
 *
 * Squares are made ahead of time after each catalog scan and kept in
 * <data dir>/retro-art/, keyed by the source file's size and mtime so a
 * replaced cover is redrawn. Files for games that are gone are removed.
 */
import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import sharp from "sharp";
import debug from "../debug.js";

export const SQUARE_PX = 256;
const QUALITY = 82;
const CONCURRENCY = 2;

/** Where a game's square lives, or null when it has no box art. */
export function squarePath(artDir, game) {
  if (!game.icon) return null;
  let st;
  try {
    st = fs.statSync(game.icon);
  } catch {
    return null;
  }
  const key = crypto.createHash("sha1").update(`${game.icon}\0${st.size}\0${st.mtimeMs}`).digest("hex").slice(0, 12);
  return path.join(artDir, `${game.id}-${key}.jpg`);
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
  const tmp = `${dest}.tmp`;
  await sharp(backdrop).composite([{ input: cover, gravity: "centre" }]).jpeg({ quality: QUALITY, mozjpeg: true }).toFile(tmp);
  await fsp.rename(tmp, dest);
}

/** The square for one game, drawn now if it isn't on disk yet; null without box art. */
export async function ensureSquare(artDir, game) {
  const dest = squarePath(artDir, game);
  if (!dest) return null;
  if (!fs.existsSync(dest)) await makeSquare(game.icon, dest);
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
      const dest = squarePath(artDir, g);
      if (!dest) continue;
      wanted.add(path.basename(dest));
      if (!fs.existsSync(dest)) todo.push([g, dest]);
    }
    let made = 0;
    let next = 0;
    await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
      while (next < todo.length) {
        const [g, dest] = todo[next++];
        try {
          await makeSquare(g.icon, dest);
          made++;
        } catch (err) {
          debug.error("retro: square art for %s failed: %s", g.id, err.message);
        }
      }
    }));
    let removed = 0;
    for (const f of await fsp.readdir(artDir).catch(() => [])) {
      if (f.endsWith(".jpg") && !wanted.has(f)) {
        await fsp.rm(path.join(artDir, f), { force: true });
        removed++;
      }
    }
    if (made || removed) debug.log("retro: square art %d drawn, %d removed", made, removed);
  })().finally(() => (running = null));
  return running;
}
