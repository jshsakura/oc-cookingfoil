/**
 * GET /api/shop/screenshot/:titleId/:idx — one screenshot from titledb.
 * Bounds the index to a sane upper limit (no infinite range requests).
 */
import * as titledbStore from "../meta/titledb-store.js";
import * as customArt from "../meta/custom-art.js";
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
    cachePath: cachePathFor(base, "screenshot", idx),
    upstreamUrl: shots[idx],
    overridePath: customArt.hasOverride(base, "screenshot", idx)
      ? customArt.pathFor(base, "screenshot", idx)
      : undefined,
  });
}
