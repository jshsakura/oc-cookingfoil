/**
 * GET / → CookingFoil landing page.
 *
 * The template is read once, the version token substituted once, and three
 * response Buffers (identity / gzip / brotli) are prepared lazily on first
 * request. Subsequent hits pick the best encoding from Accept-Encoding and
 * write that Buffer straight to the socket — no fs touch, no compression
 * per request. An ETag derived from the identity bytes lets repeat visits
 * short-circuit to 304 + 0 bytes when the binary hasn't changed.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { promisify } from "node:util";

import pkg from "../package.js";
import debug from "../debug.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, "../views/landing.html");

const gzipAsync = promisify(zlib.gzip);
const brotliAsync = promisify(zlib.brotliCompress);

let encoded = null;     // { identity, gzip, br, etag }
let preparing = null;   // in-flight Promise for concurrent first-hitters

async function prepare() {
  if (encoded) return encoded;
  if (preparing) return preparing;
  preparing = (async () => {
    try {
      const raw = await readFile(TEMPLATE_PATH, "utf-8");
      const html = raw.replace(/id="version">v\?/g, `id="version">v${pkg.version}`);
      const identity = Buffer.from(html);
      const etag = `"${crypto.createHash("sha1").update(identity).digest("base64url")}"`;
      // brotli at quality 5 hits a sweet spot for 30–80 KB HTML: ~10ms to
      // compress, ~25% smaller than gzip. gzip kept as the universal fallback.
      const [gzip, br] = await Promise.all([
        gzipAsync(identity, { level: 6 }),
        brotliAsync(identity, {
          params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 },
        }),
      ]);
      encoded = { identity, gzip, br, etag };
      debug.log(
        "landing: encoded (identity=%d B, gzip=%d B, br=%d B)",
        identity.length, gzip.length, br.length
      );
      return encoded;
    } finally {
      preparing = null;
    }
  })();
  return preparing;
}

function pickEncoding(req, e) {
  // br > gzip > identity. Express returns false when nothing matches.
  const best = req.acceptsEncodings(["br", "gzip", "identity"]);
  if (best === "br")   return { body: e.br,       contentEncoding: "br" };
  if (best === "gzip") return { body: e.gzip,     contentEncoding: "gzip" };
  return                    { body: e.identity, contentEncoding: null };
}

export default async function landingRoute(req, res) {
  let e;
  try {
    e = await prepare();
  } catch (err) {
    debug.error("landing: template load failed: %s", err.message);
    return res.type("html").send(
      `<!doctype html><meta charset=utf-8><title>CookingFoil</title>
        <h1>CookingFoil</h1><p>landing template missing — try <a href="/shop.json">/shop.json</a>.</p>`
    );
  }

  res.set("ETag", e.etag);
  res.set("Cache-Control", "private, max-age=0, must-revalidate");
  res.set("Vary", "Accept-Encoding");
  if (req.fresh) {
    return res.status(304).end();
  }

  const picked = pickEncoding(req, e);
  res.type("html");
  if (picked.contentEncoding) res.set("Content-Encoding", picked.contentEncoding);
  res.set("Content-Length", String(picked.body.length));
  res.status(200).end(picked.body);
}
