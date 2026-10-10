/**
 * GET /api/shop/banner/:titleId — local-cached banner artwork.
 * Same lazy-fetch pattern as the icon route; the upstream URL comes
 * from titledb's bannerUrl field.
 */
import * as titledbStore from "../meta/titledb-store.js";
import * as customArt from "../meta/custom-art.js";
import { artLang, bannerSource } from "../meta/localized-art.js";
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
  const lang = artLang(req.query?.lang);
  const own = bannerSource(base, lang);
  if (own) {
    await serveImage(req, res, { wide: true, cachePath: cachePathFor(base, "banner-lang", lang), upstreamUrl: own });
    return;
  }
  await serveImage(req, res, {
    wide: true,
    cachePath: cachePathFor(base, "banner"),
    upstreamUrl: entry?.bannerUrl,
    overridePath: customArt.hasOverride(base, "banner")
      ? customArt.pathFor(base, "banner")
      : undefined,
  });
}
