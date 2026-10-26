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
 *
 * A game file asked for with a variant key in the query (a plugin's download
 * option, plugins/variants.js) goes out with that plugin's bytes laid over
 * whatever range is read: the same size, an ETag of its own, and a 409 when
 * the option cannot be served. (?rewrap=N, until it moves into a plugin, is
 * the one built-in option: meta/rewrap/serve.js.)
 */
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream";
import * as rewrap from "../meta/rewrap/serve.js";
import { CONSOLE_HEADER } from "../plugins/variants.js";
import { patchStream } from "../meta/rewrap/patch-stream.js";

export const READ_CHUNK = 4 * 1024 * 1024;
// What the shop lists and serves as games.
export const GAME_FILE_RE = /\.(nsp|nsz|xci|xcz|nro)$/i;

const etagOf = (st, tag) => `W/"${st.size.toString(16)}-${st.mtime.getTime().toString(16)}${tag ? `-${tag}` : ""}"`;

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

/**
 * Serves an already-resolved regular file; `variant` ({ tag, patches }, from
 * meta/rewrap/serve.js plan) serves it with those bytes replaced.
 */
export function sendLargeFile(req, res, abs, st, variant = null) {
  const etag = etagOf(st, variant?.tag);
  const lastModified = st.mtime.getTime();
  res.set({
    "Accept-Ranges": "bytes",
    "Cache-Control": variant?.vary ? "private, max-age=0" : "public, max-age=0",
    "Last-Modified": st.mtime.toUTCString(),
    ETag: etag,
  });
  if (variant?.vary) res.vary(CONSOLE_HEADER);
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
  const read = fs.createReadStream(abs, { start, end, highWaterMark: READ_CHUNK });
  const done = () => {
    // A console that hangs up mid-file is normal; the streams are closed either way.
  };
  if (variant?.patches.length) pipeline(read, patchStream(start, variant.patches), res, done);
  else pipeline(read, res, done);
}

/**
 * Whether a request path, once decoded the way express.static decodes it, has a
 * segment starting with "." (".cookingfoil-nsz-work", ".git", "..", "%2e…").
 * A path that does not decode counts as hidden too. Pure.
 */
export function hasHiddenSegment(rawPath) {
  let rel;
  try { rel = decodeURIComponent(String(rawPath ?? "")); } catch { return true; }
  return rel.includes("\0") || rel.split(/[/\\]/).some((s) => s.startsWith("."));
}

/**
 * Middleware: a 404 for any path with a hidden segment, ahead of the games
 * folder's file handlers. express.static (send) checks only the last segment
 * by default, so a file inside a dot-folder (the NSZ work folder) would
 * otherwise be served.
 */
export function hiddenPaths() {
  return (req, res, next) => (hasHiddenSegment(req.path) ? res.status(404).end() : next());
}

/**
 * The absolute path of the game file a request path names under `root`, or null: not a name `match` takes,
 * a hidden segment, or a path that leaves root. Pure.
 */
export function gameFilePath(root, rawPath, match) {
  let rel;
  try { rel = decodeURIComponent(rawPath); } catch { return null; }
  if (!match.test(rel) || hasHiddenSegment(rawPath)) return null;
  const base = path.resolve(root);
  const abs = path.resolve(base, "." + rel);
  return abs.startsWith(base + path.sep) ? abs : null;
}

const refuseVariant = (res, { status, body }) => res.status(status).set("Cache-Control", "no-store").json(body);

// The plugins are asked only when the query has something in it: a plain download never touches them.
async function pluginVariant(req, abs, st) {
  if (!req.query || !Object.keys(req.query).length) return null;
  const { pluginVariants } = await import("../plugins/instance.js");
  return pluginVariants().resolve(req, abs, st);
}

/**
 * Middleware for the files under root whose names match `match`; anything else
 * (other files, folders, missing paths) falls through to the next handler.
 * Hidden segments (checked on the decoded path) and paths that leave root fall
 * through too: hiddenPaths(), mounted ahead, answers those with a 404.
 * `variants(req, abs, st)` is plugins/variants.js resolve.
 */
export function largeFiles(root, match, { variants = pluginVariant } = {}) {
  return (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const abs = gameFilePath(root, req.path, match);
    if (!abs) return next();
    fs.stat(abs, (err, st) => {
      if (err || !st.isFile()) return next();
      variants(req, abs, st).then((found) => {
        if (found?.refusal) return refuseVariant(res, found.refusal);
        if (found?.variant) return sendLargeFile(req, res, abs, st, found.variant);
        if (!rewrap.asksRewrap(req)) return sendLargeFile(req, res, abs, st);
        return rewrap.plan(abs, st, req.query[rewrap.PARAM]).then(
          (variant) => sendLargeFile(req, res, abs, st, variant),
          (failure) => rewrap.refuse(req, res, abs, failure) || next(failure),
        );
      }).catch(next);
    });
  };
}
