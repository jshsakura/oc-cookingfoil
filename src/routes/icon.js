/**
 * GET /api/shop/icon/:titleId
 *
 * Serves the local icon cache; on miss, lazily fetches from the
 * Nintendo eShop CDN URL stored in titledb (iconUrl) and writes the
 * bytes to disk for next time. Falls back to a 1×1 transparent PNG
 * when the titleId isn't in titledb either, so listings never break
 * (no-omission invariant, FINDINGS §7).
 */
import * as titledbStore from "../meta/titledb-store.js";
import {
  baseTitleIdOf,
  cachePathFor,
  normalizeTitleId,
  placeholder,
  serveImage,
} from "../meta/image-cache.js";

export default async function iconRoute(req, res) {
  const tid = normalizeTitleId(req.params.titleId);
  if (!tid) {
    res.status(400).type("text/plain").send("invalid titleId");
    return;
  }
  const base = baseTitleIdOf(tid);
  const entry = titledbStore.get(base);
  await serveImage(res, {
    cachePath: cachePathFor(base, "icon"),
    upstreamUrl: entry?.iconUrl,
  });
}
