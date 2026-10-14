/**
 * Stream an uncompressed ustar archive whose paths are relative to the SD card
 * root, directories first, so a client can unpack straight onto the card while
 * it reads. Content-Length is exact, for progress.
 *
 * An entry is { path, size, mtime } plus either `abs` (a file on disk) or
 * `data` (a Buffer made on the fly, such as a generated config).
 *
 * A single byte range is served (206) so a client can resume a large download.
 * The ETag names the exact bytes: with `fixedTimes` every header carries mtime 0,
 * so the bytes follow only from paths and contents and the caller's content hash
 * is the ETag; otherwise the ETag also covers each entry's path, size and mtime.
 */
import crypto from "crypto";
import fs from "fs";
import { Readable, pipeline } from "stream";
import debug from "../debug.js";
import { header, padding, TRAILER, archiveSize } from "./ustar.js";
import { parseRange } from "./byte-range.js";

/** Directory entries for every parent of the files, then the files. Pure. */
export function tarEntries(files) {
  const dirs = new Set();
  for (const f of files) {
    const parts = f.path.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/") + "/");
  }
  return [
    ...[...dirs].sort().map((d) => ({ path: d, dir: true, mtime: 0 })),
    ...files.map((f) => ({ ...f, dir: false })),
  ];
}

/** The archive as a list of pieces: Buffers, and { abs, size, path } for file bodies. Pure. */
function pieces(entries) {
  const out = [];
  for (const e of entries) {
    out.push(header(e));
    if (e.dir) continue;
    if (e.data) out.push(e.data);
    else if (e.size) out.push({ abs: e.abs, size: e.size, path: e.path });
    out.push(padding(e.size));
  }
  out.push(TRAILER);
  return out.filter((p) => (Buffer.isBuffer(p) ? p.length : p.size) > 0);
}

// Small file bodies are read whole, several at once, ahead of the one being sent.
// A hard disk then gets the next reads together and orders its own seeks, instead
// of waiting out one seek per file; big files stream as before.
const SMALL_FILE = 1024 * 1024;
const READ_AHEAD = 8; // at most 8 MiB held per download

/** Bytes `from`..`to` (inclusive) of one file, or an error when it no longer has them. */
async function readSlice(p, from, to) {
  const len = to - from + 1;
  const fh = await fs.promises.open(p.abs, "r");
  try {
    const buf = Buffer.allocUnsafe(len);
    let got = 0;
    while (got < len) {
      const { bytesRead } = await fh.read(buf, got, len - got, from + got);
      if (!bytesRead) break;
      got += bytesRead;
    }
    if (got !== len) throw new Error(`${p.path} changed while sending`);
    return buf;
  } finally {
    await fh.close();
  }
}

/** The slices of the archive that bytes `start`..`end` cover: [piece, from, to]. Pure. */
function plan(entries, start, end) {
  const out = [];
  let at = 0;
  for (const p of pieces(entries)) {
    const len = Buffer.isBuffer(p) ? p.length : p.size;
    const from = Math.max(start - at, 0);
    const to = Math.min(end - at, len - 1);
    at += len;
    if (to >= from) out.push([p, from, to]);
    if (at > end) break;
  }
  return out;
}

/** Bytes `start`..`end` (inclusive) of the archive; the whole of it by default. */
export async function* archive(entries, start = 0, end = Infinity) {
  const slices = plan(entries, start, end);
  const isSmall = ([p, from, to]) => !Buffer.isBuffer(p) && to - from + 1 <= SMALL_FILE;
  const ahead = new Map(); // slice index → its bytes being read
  let next = 0;
  const fill = (from) => {
    next = Math.max(next, from);
    while (ahead.size < READ_AHEAD && next < slices.length) {
      const i = next++;
      if (!isSmall(slices[i])) continue;
      const read = readSlice(...slices[i]);
      read.catch(() => {}); // a download given up on leaves reads nobody waits for
      ahead.set(i, read);
    }
  };
  for (let i = 0; i < slices.length; i++) {
    const [p, from, to] = slices[i];
    if (Buffer.isBuffer(p)) {
      yield p.subarray(from, to + 1);
      continue;
    }
    fill(i);
    if (ahead.has(i)) {
      const buf = await ahead.get(i);
      ahead.delete(i);
      fill(i + 1);
      yield buf;
      continue;
    }
    let sent = 0;
    for await (const chunk of fs.createReadStream(p.abs, { start: from, end: to, highWaterMark: 1024 * 1024 })) {
      sent += chunk.length;
      yield chunk;
    }
    // A file that shrank mid-download would corrupt every later entry.
    if (sent !== to - from + 1) throw new Error(`${p.path} changed while sending`);
  }
}

/** Send `files` as a tar download, or the one byte range the request asks for. */
export function sendTar(res, files, { filename, etag, label = "tar", fixedTimes = false }) {
  const entries = tarEntries(fixedTimes ? files.map((f) => ({ ...f, mtime: 0 })) : files);
  const total = archiveSize(entries);
  const tag = fixedTimes && etag
    ? etag
    : crypto.createHash("sha1").update(JSON.stringify([etag ?? null, entries.map((e) => [e.path, e.size ?? 0, Math.floor(e.mtime ?? 0)])])).digest("hex");
  res.header("Content-Type", "application/x-tar");
  res.header("Content-Disposition", `attachment; filename="${filename}"`);
  res.header("ETag", `"${tag}"`);
  res.header("Accept-Ranges", "bytes");
  res.header("Cache-Control", "private, no-cache");
  const range = parseRange(res.req?.headers, total, tag);
  if (range === "unsatisfiable") {
    res.header("Content-Range", `bytes */${total}`);
    res.status(416).end();
    return;
  }
  const [start, end] = range ?? [0, total - 1];
  if (range) {
    res.status(206);
    res.header("Content-Range", `bytes ${start}-${end}/${total}`);
  }
  res.header("Content-Length", String(end - start + 1));
  pipeline(Readable.from(archive(entries, start, end)), res, (err) => {
    if (err && err.code !== "ERR_STREAM_PREMATURE_CLOSE") debug.error("%s: download %s failed: %s", label, filename, err.message);
  });
}
