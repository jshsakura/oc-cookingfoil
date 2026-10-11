/**
 * GET /api/patches                 every user patch  { patches: [P…] }, with ETag.
 *                                  Each P carries `game` { name, names, icon } when
 *                                  titledb or the game's own file knows the title,
 *                                  so a client can label patches for games it doesn't list.
 * GET /api/patches/:id/download    one patch as an uncompressed ustar archive
 *
 * Archive paths are relative to the SD card root, directories first, so a
 * client can unpack straight onto the card while it reads. Content-Length is
 * exact, for progress.
 */
import crypto from "crypto";
import express from "express";
import * as userPatches from "../meta/user-patches.js";
import * as titledbStore from "../meta/titledb-store.js";
import * as extractedMeta from "../meta/extracted-meta-store.js";
import { resolveOrigin } from "../helpers/origin.js";
import { publicBaseUrl } from "../helpers/envs.js";
import { sendTar, tarEntries } from "../helpers/tar-stream.js";

export { tarEntries };

const ID_RE = /^[0-9A-F]{16}-[0-9a-f]{12}$/;

/** The game a patch is for, or null when nothing knows the title. */
export function gameOf(titleId, origin = "") {
  const entry = titledbStore.get(titleId);
  const names = titledbStore.namesOf(titleId);
  const extracted = extractedMeta.get(titleId);
  const name = entry?.name || extracted?.name || names?.en || (names && Object.values(names)[0]);
  if (!name) return null;
  const game = { name, names: names ?? {} };
  // Absolute, like the shop's artwork URLs, so curl-style clients can fetch it with the shop's auth.
  if (entry?.iconUrl || titledbStore.iconsOf(titleId) || extracted?.iconPath) game.icon = `${origin}/api/shop/icon/${titleId}`;
  return game;
}

async function listRoute(req, res) {
  let listing;
  try {
    listing = await userPatches.list();
  } catch (err) {
    if (!(err instanceof userPatches.ScanPending)) throw err;
    // The server is reading the patch folder for the first time; ask again shortly.
    res.set({ "Retry-After": "30", "Cache-Control": "no-store" });
    res.status(503).json({ error: "patches are still being scanned", retryAfter: 30 });
    return;
  }
  const origin = resolveOrigin(req, publicBaseUrl);
  const body = JSON.stringify({
    patches: listing.map((p) => {
      const game = gameOf(p.title_id, origin);
      return game ? { ...p, game } : p;
    }),
  });
  res.header("Content-Type", "application/json");
  res.header("ETag", `"${crypto.createHash("sha1").update(body).digest("hex")}"`);
  res.header("Cache-Control", "private, max-age=0, must-revalidate");
  if (req.fresh) {
    res.status(304).end();
    return;
  }
  res.status(200).end(body);
}

async function downloadRoute(req, res) {
  const id = String(req.params.id || "");
  if (!ID_RE.test(id)) {
    res.status(400).json({ error: "invalid patch id" });
    return;
  }
  const opened = await userPatches.openForDownload(id);
  if (!opened) {
    res.status(404).json({ error: "no such patch" });
    return;
  }
  sendTar(res, opened.entries, { filename: `${id}.tar`, etag: opened.patch.hash, label: "patches" });
}

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

export default function patchesRouter() {
  const router = express.Router();
  router.get("/", wrap(listRoute));
  router.get("/:id/download", wrap(downloadRoute));
  return router;
}
