/**
 * GET / → CookingFoil landing page.
 *
 * The template is read once, the version token substituted once, and three
 * response Buffers (identity / gzip / brotli) are prepared lazily on first
 * request for each origin (the share tags carry the absolute image URL). Subsequent hits pick the best encoding from Accept-Encoding and
 * write that Buffer straight to the socket — no fs touch, no compression
 * per request. An ETag derived from the identity bytes lets repeat visits
 * short-circuit to 304 + 0 bytes when the binary hasn't changed.
 */
import { readFile } from "node:fs/promises";
import { iconSet } from "../views/icons.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { promisify } from "node:util";

import pkg from "../package.js";
import { publicBaseUrl } from "../helpers/envs.js";
import { resolveOrigin } from "../helpers/origin.js";
import debug from "../debug.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The names the page's buttons may use (landing.html, BTN_ICON_FOR and data-icon).
const BUTTON_ICON_NAMES = ["download", "x", "refresh", "file", "folder", "upload", "save", "undo", "arrowright", "chevleft", "chevright", "trash"];
const TEMPLATE_PATH = path.join(__dirname, "../views/landing.html");

const gzipAsync = promisify(zlib.gzip);
const brotliAsync = promisify(zlib.brotliCompress);

let template = null;     // the page with its version filled in, origin still open
let preparing = null;    // in-flight Promise for concurrent first-hitters
// One encoded page per origin it was asked for (the share tags carry it);
// a handful of hosts at most, capped so odd Host headers can't grow it.
const encodedByOrigin = new Map();
const MAX_ORIGINS = 16;
// Only a plain scheme://host[:port][/path] goes into the page; anything else
// (an odd Host header) leaves the share image root-relative.
const SAFE_ORIGIN = /^https?:\/\/[A-Za-z0-9.\-[\]:]+(\/[A-Za-z0-9._~%/-]*)?$/;

async function loadTemplate() {
  if (template) return template;
  if (preparing) return preparing;
  preparing = (async () => {
    try {
      const raw = await readFile(TEMPLATE_PATH, "utf-8");
      template = raw
        .replace(/id="version">v\?/g, `id="version">v${pkg.version}`)
        .replace("__BUTTON_ICONS__", () => JSON.stringify(iconSet(BUTTON_ICON_NAMES)));
      return template;
    } finally {
      preparing = null;
    }
  })();
  return preparing;
}

/** The page for one origin: the share tags point at its absolute image URL. */
export function pageForOrigin(html, origin) {
  return html.replaceAll("__ORIGIN__", SAFE_ORIGIN.test(origin ?? "") ? origin : "");
}

async function prepare(origin) {
  const key = SAFE_ORIGIN.test(origin ?? "") ? origin : "";
  const hit = encodedByOrigin.get(key);
  if (hit) return hit;
  const identity = Buffer.from(pageForOrigin(await loadTemplate(), key));
  const etag = `"${crypto.createHash("sha1").update(identity).digest("base64url")}"`;
  // brotli at quality 5 hits a sweet spot for 30–80 KB HTML: ~10ms to
  // compress, ~25% smaller than gzip. gzip kept as the universal fallback.
  const [gzip, br] = await Promise.all([
    gzipAsync(identity, { level: 6 }),
    brotliAsync(identity, {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 },
    }),
  ]);
  const encoded = { identity, gzip, br, etag };
  if (encodedByOrigin.size >= MAX_ORIGINS) encodedByOrigin.delete(encodedByOrigin.keys().next().value);
  encodedByOrigin.set(key, encoded);
  debug.log(
    "landing: encoded for %s (identity=%d B, gzip=%d B, br=%d B)",
    key || "(relative)", identity.length, gzip.length, br.length
  );
  return encoded;
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
    e = await prepare(resolveOrigin(req, publicBaseUrl));
  } catch (err) {
    debug.error("landing: template load failed: %s", err.message);
    return res.type("html").send(
      `<!doctype html><meta charset=utf-8><title>CookingFoil</title>
        <h1>CookingFoil</h1><p>landing template missing.</p>`
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
