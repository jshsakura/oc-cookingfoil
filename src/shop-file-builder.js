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

    let body;
    try {
      body = await shopCache.get();
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
    res.status(200).send(body);
    debug.http("OUT-< %o", req.path);
  };
}
