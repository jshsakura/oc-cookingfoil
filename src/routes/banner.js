/**
 * GET /api/library/banner/:titleId[?v=&size=sm|md|lg|xl&lang=] — the admin's
 * banner, else one drawn from the game's icon (meta/icon-banner.js); 404
 * while the game has no icon yet. Immutable for the current ?v=,
 * `public, max-age=300` with an ETag otherwise, as the icon route.
 */
import * as customArt from "../meta/custom-art.js";
import { artLang } from "../meta/localized-art.js";
import { isCurrentVersion } from "../meta/artwork-version.js";
import { ensureBanner } from "../meta/icon-banner.js";
import debug from "../debug.js";
import {
  baseTitleIdOf,
  normalizeTitleId,
  placeholder,
  serveImage,
} from "../meta/image-cache.js";

export default async function bannerRoute(req, res) {
  const tid = normalizeTitleId(req.params.titleId);
  if (!tid) {
    res.status(400).type("text/plain").send("invalid titleId");
    return;
  }
  const base = baseTitleIdOf(tid);
  const lang = artLang(req.query?.lang);
  const current = isCurrentVersion(req, "banner", base, { lang });
  const custom = customArt.serveOptions(base, "banner", null);
  if (custom.overridePath) {
    await serveImage(req, res, { wide: true, cachePath: null, ...custom, current });
    return;
  }
  const drawn = await ensureBanner(base, lang).catch((err) => {
    debug.error("banner: drawing %s failed: %s", base, err.message);
    return null;
  });
  if (!drawn) return placeholder(res);
  await serveImage(req, res, { wide: true, cachePath: drawn, current });
}
