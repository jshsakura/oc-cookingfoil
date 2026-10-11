/**
 * Stream an uncompressed ustar archive whose paths are relative to the SD card
 * root, directories first, so a client can unpack straight onto the card while
 * it reads. Content-Length is exact, for progress.
 *
 * An entry is { path, size, mtime } plus either `abs` (a file on disk) or
 * `data` (a Buffer made on the fly, such as a generated config).
 */
import fs from "fs";
import { Readable, pipeline } from "stream";
import debug from "../debug.js";
import { header, padding, TRAILER, archiveSize } from "./ustar.js";

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

export async function* archive(entries) {
  for (const e of entries) {
    yield header(e);
    if (e.dir) continue;
    let sent = 0;
    if (e.data) {
      sent = e.data.length;
      yield e.data;
    } else if (e.size) {
      for await (const chunk of fs.createReadStream(e.abs, { start: 0, end: e.size - 1, highWaterMark: 1024 * 1024 })) {
        sent += chunk.length;
        yield chunk;
      }
    }
    // A file that shrank mid-download would corrupt every later entry.
    if (sent !== e.size) throw new Error(`${e.path} changed while sending`);
    yield padding(e.size);
  }
  yield TRAILER;
}

/** Send `files` as a tar download. */
export function sendTar(res, files, { filename, etag, label = "tar" }) {
  const entries = tarEntries(files);
  res.header("Content-Type", "application/x-tar");
  res.header("Content-Length", String(archiveSize(entries)));
  res.header("Content-Disposition", `attachment; filename="${filename}"`);
  if (etag) res.header("ETag", `"${etag}"`);
  res.header("Cache-Control", "private, no-cache");
  pipeline(Readable.from(archive(entries)), res, (err) => {
    if (err && err.code !== "ERR_STREAM_PREMATURE_CLOSE") debug.error("%s: download %s failed: %s", label, filename, err.message);
  });
}
