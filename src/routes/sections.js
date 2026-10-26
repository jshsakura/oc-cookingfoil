/**
 * GET /api/library/sections
 *
 * The catalog the CookingFoil client and the web page read. Each item carries
 * a clean `name` and its own `title_id`/`app_version`/`app_type`/`icon_url`
 * fields, so the client shows full info (and grid icons) without reading
 * anything back out of a file name.
 *
 * The body is built, compressed (br/gzip) and per-origin-memoized inside
 * library-cache (getSectionsEncodedForOrigin) — one serialize per rebuild, reused
 * across requests with ETag/304, exactly like /games.json. URLs are
 * made absolute against the request origin there too, so on-device curl (which
 * resolves neither a host-relative `/api/library/icon/...` nor a `../foo`
 * download) receives absolute URLs.
 */
import * as libraryCache from "../meta/library-cache.js";
import { resolveOrigin } from "../helpers/origin.js";
import { publicBaseUrl } from "../helpers/envs.js";
import * as downloadLinks from "../security/download-links.js";
import debug from "../debug.js";

export default async function sectionsRoute(req, res) {
  let payload;
  try {
    const origin = resolveOrigin(req, publicBaseUrl);
    payload = await libraryCache.getSectionsEncodedForOrigin(
      req.acceptsEncodings(),
      origin,
      downloadLinks.forRequest(req)
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
