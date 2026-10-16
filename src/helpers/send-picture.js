/**
 * Sends one stored picture (meta/item-media.js): immutable under the ?v= a listing
 * gives, revalidated otherwise; WebP for a client that says it reads it (browsers,
 * the CookingFoil client), else its JPEG twin, made once.
 */
import fs from "fs";
import { IMMUTABLE, UNVERSIONED } from "../meta/image-cache.js";
import { jpegOf } from "../meta/item-media.js";

export async function sendPicture(req, res, file, v, tag = v) {
  if (!v || !fs.existsSync(file)) return res.status(404).json({ error: "no picture" });
  const webp = (req.get("accept") || "").includes("image/webp");
  res.set({ "Content-Type": webp ? "image/webp" : "image/jpeg", "Cache-Control": req.query.v === v ? IMMUTABLE : UNVERSIONED, ETag: `"${tag}${webp ? "" : "-jpg"}"`, Vary: "Accept" });
  if (req.fresh) return res.status(304).end();
  res.sendFile(webp ? file : await jpegOf(file), { etag: false, lastModified: false });
}

/** The routes for one store's pictures: icon, banner and screenshot/:n under `router` (ids already checked). */
export function mountPictures(router, store, wrap) {
  router.get("/:id/banner", wrap(async (req, res) => sendPicture(req, res, store.bannerPath(req.params.id), store.bannerVersion(req.params.id))));
  router.get("/:id/screenshot/:n", wrap(async (req, res) => {
    const n = Number(req.params.n);
    const s = store.record(req.params.id).shots;
    if (!Number.isInteger(n) || !s?.count || n < 1 || n > s.count) return res.status(404).json({ error: "no picture" });
    const v = s.at.toString(36);
    return sendPicture(req, res, store.shotPath(req.params.id, n), v, `${v}-${n}`);
  }));
}
