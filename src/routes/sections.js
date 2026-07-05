/**
 * GET /api/shop/sections   (alias: /api/remote/sections)
 *
 * Native sections response for CyberFoil v1.4.5+. The client's remote menu
 * probes `/api/remote/sections` then `/api/shop/sections` FIRST and only falls
 * back to the flat legacy index (served at `/`, `/shop.tfl`) when both 404.
 * On that legacy fallback CyberFoil can only recover metadata by scraping the
 * `[TITLEID][vVER]`-stamped `name` string — so titles render with degraded
 * info. Serving this endpoint puts the client on its first-class path, where
 * it reads clean `name` + first-class `title_id`/`app_version`/`app_type`/
 * `icon_url` fields and shows full info (and grid icons) as designed.
 *
 * The body is built, compressed (br/gzip) and per-origin-memoized inside
 * shop-cache (getSectionsEncodedForOrigin) — one serialize per rebuild, reused
 * across requests with ETag/304 — exactly like the /shop.tfl path. URLs are
 * made absolute against the request origin there too, so on-device curl (which
 * resolves neither a host-relative `/api/shop/icon/...` nor a `../foo`
 * download) receives absolute URLs.
 */
import * as shopCache from "../meta/shop-cache.js";
import { resolveOrigin } from "../helpers/origin.js";
import { publicBaseUrl } from "../helpers/envs.js";
import debug from "../debug.js";

export default async function sectionsRoute(req, res) {
  let payload;
  try {
    const origin = resolveOrigin(req, publicBaseUrl);
    payload = await shopCache.getSectionsEncodedForOrigin(
      req.acceptsEncodings(),
      origin
    );
  } catch (err) {
    debug.error("sections: build failed: %s", err.stack || err.message);
    res.status(503).json({ error: "sections unavailable" });
    return;
  }

  res.header("Content-Type", "application/json");
  if (payload.contentEncoding) {
    res.header("Content-Encoding", payload.contentEncoding);
    res.header("Vary", "Accept-Encoding");
  }
  if (payload.etag) res.header("ETag", payload.etag);
  // The catalog changes underneath us as files are added; never let a client
  // treat a cached copy as fresh without revalidating (ETag → 304 when unchanged).
  res.header("Cache-Control", "private, max-age=0, must-revalidate");
  if (req.fresh) {
    res.status(304).end();
    return;
  }
  res.header("Content-Length", String(payload.body.length));
  res.status(200).end(payload.body);
}
