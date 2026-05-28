/**
 * Generate the Tinfoil/CookingFoil shop index on every request:
 *   - GET /shop.json  → application/json (browser-readable)
 *   - GET /shop.tfl   → application/octet-stream (consumed by the client)
 *
 * Both endpoints return the same payload produced by `generateIndex`.
 */
import debug from "./debug.js";
import generateIndex from "./create-index-content.js";

export default function shopFileBuilder() {
  return async (req, res, next) => {
    if (req.path === "/shop.json") {
      debug.http("IN-> %o", req.path);
      res.header("Content-Type", "application/json");
      res.status(200).send(await generateIndex());
      debug.http("OUT-< %o", req.path);
      return;
    }
    if (req.path === "/shop.tfl") {
      debug.http("IN-> %o", req.path);
      res.header("Content-Type", "application/octet-stream");
      res.status(200).send(await generateIndex());
      debug.http("OUT-< %o", req.path);
      return;
    }
    debug.http("IN-> %o", req.path);
    next();
  };
}
