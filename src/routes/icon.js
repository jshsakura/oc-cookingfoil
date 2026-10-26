/**
 * GET /api/library/icon/:titleId[?v=&size=sm|md|lg|xl&lang=ko|en|ja|zh]
 *
 * Serves the admin's icon, else the one read from the game file (data/icons).
 * Answers 404 (no-store) while there is none yet, so listings never break and
 * the icon shows once the extractor has read it (no-omission invariant, FINDINGS §7).
 *
 * ?v= is the content version every list hands out (meta/artwork-version.js).
 * The current v gets `public, max-age=31536000, immutable`; no v or an old one
 * gets `public, max-age=300` with an ETag (304 on If-None-Match).
 */
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
  // ?lang=en|ja|zh|ko: that language's own box art when the game has one.
  const lang = artLang(req.query?.lang);
  const current = isCurrentVersion(req, "icon", base, { lang });
  const own = iconSource(base, lang);
  if (own) {
    await serveImage(req, res, { cachePath: cachePathFor(base, "icon-lang", lang), current });
    return;
  }
  await serveImage(req, res, {
    cachePath: cachePathFor(base, "icon"),
    ...customArt.serveOptions(base, "icon", null),
    current,
  });
}
