/**
 * gzip (or brotli, when the client asks) for JSON replies over 1 KB: every
 * list and detail the console and the web page read. Files, tars, images and
 * event streams are never touched, so a download keeps its Content-Length and
 * Range. A reply that already names its encoding (/api/library/sections,
 * /api/retro/index: compressed once and reused) goes as it is.
 */
import compression from "compression";

const THRESHOLD = 1024;

/** True for a JSON reply the client can take compressed; a file sent for download (Range, attachment) never is. */
export function compressible(req, res) {
  if (res.getHeader("Accept-Ranges") || res.getHeader("Content-Disposition")) return false;
  return /^application\/json\b/i.test(String(res.getHeader("Content-Type") ?? "")) && compression.filter(req, res);
}

/**
 * "br" when the Accept-Encoding header takes it, else "gzip", else null: our
 * order, not the header's (browsers list gzip first, yet brotli is smaller).
 * A q of 0 refuses; "*" takes either. Pure.
 */
export function pickEncoding(header) {
  const q = new Map();
  for (const part of String(header ?? "").split(",")) {
    const [name, ...params] = part.trim().toLowerCase().split(";");
    if (!name) continue;
    const qParam = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    q.set(name, qParam ? Number.parseFloat(qParam.slice(2)) || 0 : 1);
  }
  const takes = (name) => (q.has(name) ? q.get(name) > 0 : (q.get("*") ?? 0) > 0);
  return takes("br") ? "br" : takes("gzip") ? "gzip" : null;
}

export default function jsonCompression() {
  return compression({ threshold: THRESHOLD, filter: compressible });
}
