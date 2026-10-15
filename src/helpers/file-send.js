/**
 * Sends a game file the way express.static does (Range, If-Range, ETag,
 * Last-Modified, 304, HEAD), but reads it in large pieces.
 *
 * express.static reads with Node's default 64 KiB chunks. A console fetches a
 * title over several connections at once, each at its own offset, so on spinning
 * disks those small reads from different places in the same file interleave and
 * the heads keep moving. Reading 4 MiB at a time keeps each connection's reads
 * long and sequential, and cuts the thread-pool round trips per gigabyte from
 * about 16,000 to 256.
 *
 * The ETag is the same as express.static's (weak, size and mtime), so a client
 * resuming with If-Range across the change still matches.
 */
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream";

export const READ_CHUNK = 4 * 1024 * 1024;
// What the shop lists and serves as games.
export const GAME_FILE_RE = /\.(nsp|nsz|xci|xcz|nro)$/i;

const etagOf = (st) => `W/"${st.size.toString(16)}-${st.mtime.getTime().toString(16)}"`;

/** One byte range of a file this size, or null when the header asks for none we serve (multi-range, other units). */
export function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start, end;
  if (m[1] === "") {
    const suffix = Number(m[2]);
    if (suffix === 0) return { unsatisfiable: true };
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return { unsatisfiable: true };
  return { start, end };
}

// If-Range holds the ETag or the date the client saw; the range applies only if the file is still that one.
function ifRangeMatches(req, etag, lastModified) {
  const want = req.headers["if-range"];
  if (!want) return true;
  if (want.includes('"')) return want === etag || want === etag.slice(2);
  const at = Date.parse(want);
  return Number.isFinite(at) && Math.floor(lastModified / 1000) <= Math.floor(at / 1000);
}

/** Serves an already-resolved regular file. */
export function sendLargeFile(req, res, abs, st) {
  const etag = etagOf(st);
  const lastModified = st.mtime.getTime();
  res.set({
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=0",
    "Last-Modified": st.mtime.toUTCString(),
    ETag: etag,
  });
  if (!res.get("Content-Type")) res.type(path.extname(abs) || "application/octet-stream");
  if (req.fresh) return res.status(304).end();

  let start = 0, end = st.size - 1;
  const header = req.headers.range;
  if (header && ifRangeMatches(req, etag, lastModified)) {
    const range = parseRange(header, st.size);
    if (range?.unsatisfiable) {
      res.set("Content-Range", `bytes */${st.size}`);
      return res.status(416).end();
    }
    if (range) {
      ({ start, end } = range);
      res.status(206).set("Content-Range", `bytes ${start}-${end}/${st.size}`);
    }
  }
  res.set("Content-Length", String(st.size === 0 ? 0 : end - start + 1));
  if (req.method === "HEAD" || st.size === 0) return res.end();
  pipeline(fs.createReadStream(abs, { start, end, highWaterMark: READ_CHUNK }), res, () => {
    // A console that hangs up mid-file is normal; the streams are closed either way.
  });
}

/**
 * Middleware for the files under root whose names match `match`; anything else
 * (other files, folders, missing paths) falls through to the next handler.
 * Hidden segments and paths that leave root are left to express.static, which refuses them.
 */
export function largeFiles(root, match) {
  const base = path.resolve(root);
  return (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    let rel;
    try { rel = decodeURIComponent(req.path); } catch { return next(); }
    if (!match.test(rel) || rel.includes("\0") || rel.split("/").some((s) => s.startsWith("."))) return next();
    const abs = path.resolve(base, "." + rel);
    if (!abs.startsWith(base + path.sep)) return next();
    fs.stat(abs, (err, st) => {
      if (err || !st.isFile()) return next();
      sendLargeFile(req, res, abs, st);
    });
  };
}
