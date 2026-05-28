/**
 * Generate the Tinfoil/CookingFoil shop index on every request:
 *   - GET /shop.json  → application/json (browser-readable)
 *   - GET /shop.tfl   → application/octet-stream (consumed by the client)
 *
 * Both endpoints return the same payload, served from the chokidar-warmed
 * in-memory cache in src/meta/shop-cache.js — concurrent requests share a
 * single in-flight build and never trigger a duplicate fast-glob scan.
 */
import debug from "./debug.js";
import * as shopCache from "./meta/shop-cache.js";

export default function shopFileBuilder() {
  return async (req, res, next) => {
    if (req.path !== "/shop.json" && req.path !== "/shop.tfl") {
      return next();
    }
    debug.http("IN-> %o", req.path);

    let payload;
    try {
      // req.acceptsEncodings() returns the list ranked by client preference.
      // We pre-built both identity and gzip Buffers at shop-cache build time,
      // so this is just a header check + buffer pick — no per-request work.
      payload = await shopCache.getEncoded(req.acceptsEncodings());
    } catch (err) {
      debug.error("shop cache get failed: %s", err.stack || err.message);
      res
        .status(500)
        .type("application/json")
        .send(JSON.stringify({ error: "shop build failed: " + (err.message || String(err)) }));
      return;
    }

    res.header(
      "Content-Type",
      req.path === "/shop.json" ? "application/json" : "application/octet-stream"
    );
    if (payload.contentEncoding) {
      res.header("Content-Encoding", payload.contentEncoding);
      res.header("Vary", "Accept-Encoding");
    }
    // Explicit Content-Length keeps HTTP/1.1 connections cleanly framed and
    // avoids chunked-encoding overhead for what's already a single Buffer.
    res.header("Content-Length", String(payload.body.length));
    res.status(200).end(payload.body);
    debug.http("OUT-< %o", req.path);
  };
}
