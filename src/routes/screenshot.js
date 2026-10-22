/**
 * GET /api/shop/screenshot/:titleId/:idx[?v=&size=sm|md|lg|xl] — one screenshot
 * from titledb, or the admin's upload in that slot.
 * Bounds the index to a sane upper limit (no infinite range requests).
 * Immutable for the current ?v=, `public, max-age=300` with an ETag otherwise.
 */
import * as titledbStore from "../meta/titledb-store.js";
import * as customArt from "../meta/custom-art.js";
import { isCurrentVersion } from "../meta/artwork-version.js";
import {
  baseTitleIdOf,
  cachePathFor,
  normalizeTitleId,
  serveImage,
} from "../meta/image-cache.js";

const MAX_SCREENSHOT_INDEX = 30;

export default async function screenshotRoute(req, res) {
  const tid = normalizeTitleId(req.params.titleId);
  const idx = Number.parseInt(req.params.idx, 10);
  if (!tid || !Number.isInteger(idx) || idx < 0 || idx > MAX_SCREENSHOT_INDEX) {
    res.status(400).type("text/plain").send("invalid titleId or index");
    return;
  }
  const base = baseTitleIdOf(tid);
  const entry = titledbStore.get(base);
  const shots = Array.isArray(entry?.screenshots) ? entry.screenshots : [];
  await serveImage(req, res, {
    wide: true,
    cachePath: cachePathFor(base, "screenshot", idx),
    upstreamUrl: shots[idx],
    ...customArt.serveOptions(base, "screenshot", idx),
    current: isCurrentVersion(req, "screenshot", base, { idx }),
  });
}
