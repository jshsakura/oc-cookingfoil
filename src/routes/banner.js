/**
 * GET /api/shop/banner/:titleId — local-cached banner artwork.
 * Same lazy-fetch pattern as the icon route; the upstream URL comes
 * from titledb's bannerUrl field.
 */
import * as titledbStore from "../meta/titledb-store.js";
import {
  baseTitleIdOf,
  cachePathFor,
  normalizeTitleId,
  serveImage,
} from "../meta/image-cache.js";

export default async function bannerRoute(req, res) {
  const tid = normalizeTitleId(req.params.titleId);
  if (!tid) {
    res.status(400).type("text/plain").send("invalid titleId");
    return;
  }
  const base = baseTitleIdOf(tid);
  const entry = titledbStore.get(base);
  await serveImage(req, res, {
    cachePath: cachePathFor(base, "banner"),
    upstreamUrl: entry?.bannerUrl,
  });
}
