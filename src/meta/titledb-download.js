/**
 * Streams one titledb file to disk with the limits a mirror can't be trusted
 * to keep: a mirror that stops sending is cut off after STALL_MS without a
 * byte (so a hung mirror can't hold the refresh forever), and a body larger
 * than MAX_BYTES is refused before it fills the disk. The largest upstream
 * file (US.en.json) is ~200 MB, so the cap leaves plenty of room.
 */
import { createWriteStream } from "fs";
import { mkdir, unlink } from "fs/promises";
import { randomBytes } from "crypto";
import path from "path";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import { guardedFetch } from "../security/outbound-guard.js";

export const MAX_BYTES = 1024 ** 3;
export const STALL_MS = 60_000;

/** A temporary name beside `file` that no other download of it is using. */
export const tmpPathFor = (file) => `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;

/**
 * GET `url` into `destPath`. Resolves { status } for a non-2xx answer (nothing
 * written), { status, bytes } once the body is on disk, and rejects on a
 * network error, a stall or an oversized body (the partial file is removed).
 */
export async function downloadToFile(url, destPath, { maxBytes = MAX_BYTES, stallMs = STALL_MS } = {}) {
  const controller = new AbortController();
  let timer;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(new Error(`no data for ${stallMs / 1000} s`)), stallMs);
  };
  arm();
  try {
    // The source may be an operator-set mirror: no private address, on any redirect hop either.
    const res = await guardedFetch(url, { signal: controller.signal });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return { status: res.status };
    }
    const declared = Number(res.headers.get("content-length"));
    if (declared > maxBytes) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`body of ${declared} bytes is over the ${maxBytes} byte limit`);
    }
    await mkdir(path.dirname(destPath), { recursive: true });
    const bytes = await writeBody(res.body, destPath, maxBytes, arm, controller.signal);
    return { status: res.status, bytes };
  } catch (err) {
    throw controller.signal.aborted && controller.signal.reason instanceof Error ? controller.signal.reason : err;
  } finally {
    clearTimeout(timer);
  }
}

async function writeBody(body, destPath, maxBytes, onChunk, signal) {
  let bytes = 0;
  const counter = new Transform({
    transform(chunk, _encoding, done) {
      onChunk();
      bytes += chunk.length;
      done(bytes > maxBytes ? new Error(`body is over the ${maxBytes} byte limit`) : null, chunk);
    },
  });
  try {
    // pipeline settles on every failure (disk full, abort, oversize) and closes both ends.
    await pipeline(body ? Readable.fromWeb(body) : Readable.from([]), counter, createWriteStream(destPath), { signal });
    return bytes;
  } catch (err) {
    await unlink(destPath).catch(() => {});
    throw err;
  }
}
