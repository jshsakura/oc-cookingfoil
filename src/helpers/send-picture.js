/**
 * Sends one item picture (meta/item-media.js) as it is on the disk: immutable
 * under the ?v= a listing gives, revalidated otherwise.
 */
import path from "path";
import { IMMUTABLE, UNVERSIONED } from "../meta/image-cache.js";

const TYPES = { ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png" };

export function sendPicture(req, res, pic, tag = pic?.version) {
  if (!pic) return res.status(404).json({ error: "no picture" });
  res.set({ "Content-Type": TYPES[path.extname(pic.file).toLowerCase()] ?? "application/octet-stream", "Cache-Control": req.query.v && req.query.v === tag ? IMMUTABLE : UNVERSIONED, ETag: `"${pic.version}"` });
  if (req.fresh) return res.status(304).end();
  res.sendFile(pic.file, { etag: false, lastModified: false });
}

/** The routes for one store's banner and screenshot/:n under `router` (ids already checked). */
export function mountPictures(router, store, wrap) {
  router.get("/:id/banner", wrap(async (req, res) => sendPicture(req, res, store.pictures(req.params.id).banner)));
  router.get("/:id/screenshot/:n", wrap(async (req, res) => {
    const { shots } = store.pictures(req.params.id);
    const n = Number(req.params.n);
    return sendPicture(req, res, Number.isInteger(n) ? shots[n - 1] : null, store.shotsVersion(req.params.id));
  }));
}
