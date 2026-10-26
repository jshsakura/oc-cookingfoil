/**
 * GET /api/library/screenshot/:titleId/:idx[?v=&size=sm|md|lg|xl] — the admin's
 * upload in that slot; game files carry no screenshots, so with none uploaded it is the one filled
 * in from titledb or a plugin (meta/art-fill.js), and any other is a 404.
 * Bounds the index to a sane upper limit (no infinite range requests).
 * Immutable for the current ?v=, `public, max-age=300` with an ETag otherwise.
 */
import * as customArt from "../meta/custom-art.js";
import { isCurrentVersion } from "../meta/artwork-version.js";
import { fillPath, shotSlots } from "../meta/art-fill.js";
import {
  baseTitleIdOf,
  normalizeTitleId,
  placeholder,
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
  const custom = customArt.serveOptions(base, "screenshot", idx);
  const current = isCurrentVersion(req, "screenshot", base, { idx });
  if (custom.overridePath) {
    await serveImage(req, res, { wide: true, cachePath: null, ...custom, current });
    return;
  }
  // Pictures filled in from outside count only while the admin has uploaded none of their own.
  const filled = customArt.list(base).screens.length === 0 && shotSlots(base).includes(idx) ? fillPath(base, "screenshot", idx) : null;
  if (!filled) return placeholder(res);
  await serveImage(req, res, { wide: true, cachePath: filled, current });
}
