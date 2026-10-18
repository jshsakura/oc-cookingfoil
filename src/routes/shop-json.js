/**
 * GET /shop.json: the whole library as one flat list, for automation that runs
 * with an API token the admin made on the admin page (security/api-tokens.js).
 * Anything else signed in (a console's keys, a browser) is answered 404; the
 * CookingFoil client and the web page read /api/shop/sections instead.
 *
 *   → { files: [{ url, name, size, mtime?, titleId?, baseTitleId?, kind?, icon_url? }] }
 *
 * `name` ends in "[TITLEID][vVERSION]" for every file with a title id, and every
 * URL is absolute on the request's origin. Served from the warmed shop cache
 * with br/gzip and an ETag, like the sections list.
 */
import debug from "../debug.js";
import * as shopCache from "../meta/shop-cache.js";
import { resolveOrigin } from "../helpers/origin.js";
import { publicBaseUrl } from "../helpers/envs.js";
import * as downloadLinks from "../security/download-links.js";

export default async function shopJsonRoute(req, res) {
  if (!req.apiToken) return res.status(404).type("text/plain").send("not found");
  let payload;
  try {
    payload = await shopCache.getEncodedForOrigin(req.acceptsEncodings(), resolveOrigin(req, publicBaseUrl), downloadLinks.forRequest(req));
  } catch (err) {
    debug.error("shop.json: build failed: %s", err.stack || err.message);
    return res.status(503).json({ error: "catalog unavailable" });
  }
  res.header("Content-Type", "application/json");
  if (payload.contentEncoding) {
    res.header("Content-Encoding", payload.contentEncoding);
    res.header("Vary", "Accept-Encoding");
  }
  if (payload.etag) res.header("ETag", payload.etag);
  res.header("Cache-Control", "private, max-age=0, must-revalidate");
  if (req.fresh) return res.status(304).end();
  res.header("Content-Length", String(payload.body.length));
  res.status(200).end(payload.body);
}
