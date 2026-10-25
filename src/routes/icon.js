/**
 * GET /api/library/icon/:titleId[?v=&size=sm|md|lg|xl&lang=ko|en|ja|zh]
 *
 * Serves the local icon cache; on miss, lazily fetches from the
 * eShop CDN URL stored in titledb (iconUrl) and writes the
 * bytes to disk for next time. Answers 404 (no-store)
 * when the titleId isn't in titledb either, so listings never break
 * (no-omission invariant, FINDINGS §7).
 *
 * ?v= is the content version every list hands out (meta/artwork-version.js).
 * The current v gets `public, max-age=31536000, immutable`; no v or an old one
 * gets `public, max-age=300` with an ETag (304 on If-None-Match).
 */
import * as titledbStore from "../meta/titledb-store.js";
import * as customArt from "../meta/custom-art.js";
import { artLang, iconSource } from "../meta/localized-art.js";
import { isCurrentVersion } from "../meta/artwork-version.js";
import {
  baseTitleIdOf,
  cachePathFor,
  normalizeTitleId,
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
  // ?lang=en|ja|zh|ko: that language's own box art when the game has one.
  const lang = artLang(req.query?.lang);
  const current = isCurrentVersion(req, "icon", base, { lang });
  const own = iconSource(base, lang);
  if (own) {
    await serveImage(req, res, { cachePath: cachePathFor(base, "icon-lang", lang), upstreamUrl: own.url, current });
    return;
  }
  await serveImage(req, res, {
    cachePath: cachePathFor(base, "icon"),
    upstreamUrl: entry?.iconUrl,
    ...customArt.serveOptions(base, "icon", null),
    current,
  });
}
