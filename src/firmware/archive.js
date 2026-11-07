/**
 * What a firmware zip must look like before the server lists its numbers or
 * hands it to a console: a zip (not zip64) whose every entry is a stored,
 * unencrypted *.nca file at the root. A console unpacks it straight onto the
 * SD card, so a name that could walk out of the folder it is unpacked into
 * ("..", a slash, a backslash, a colon) refuses the whole zip.
 *
 * The directory is read from the zip's tail alone: from GitHub with Range
 * requests while the list is read (remoteDirectory), and from the cached file
 * once it is downloaded (fileDirectory).
 */
import crypto from "crypto";
import fs from "fs/promises";
import { createReadStream } from "fs";
import { EOCD_SEARCH, centralEntries, directoryAt } from "../helpers/zip-read.js";

// Enough tail for the end record and, for a firmware zip (about 240 short names), the whole directory.
export const TAIL_BYTES = 128 * 1024;
const NCA_RE = /^[^/\\:]+\.nca$/i;

/** A zip this cannot read or will not serve; the message says why. */
export class ArchiveError extends Error {}

/** What the list says of a zip's directory: { files, unpacked, dir_hash }. Pure. */
export function summarize(entries) {
  const hash = crypto.createHash("sha256");
  for (const e of entries) hash.update(`${e.name}\0${e.size}\0${e.crc32}\n`);
  return { files: entries.length, unpacked: entries.reduce((n, e) => n + e.size, 0), dir_hash: hash.digest("hex") };
}

/**
 * Why `entries` (a zip's central directory) are not a firmware zip, or null when they are.
 * `expect` ({ files, unpacked, dir_hash }, any of them unknown as 0 or null) is what the list
 * said of this version: a zip that differs from it is refused too. Pure.
 */
export function firmwareProblem(entries, expect = {}) {
  if (!entries.length) return "the zip holds no files";
  const names = new Set();
  for (const e of entries) {
    if (e.name.includes("..") || !NCA_RE.test(e.name)) return `"${e.name}" is not an .nca file at the zip's root`;
    if (names.has(e.name.toLowerCase())) return `"${e.name}" is in the zip twice`;
    names.add(e.name.toLowerCase());
    if (e.flags & 1) return `"${e.name}" is encrypted`;
    if (e.method !== 0 || e.compressed !== e.size) return `"${e.name}" is compressed; firmware zips are stored`;
  }
  const got = summarize(entries);
  if (expect.files && got.files !== expect.files) return `the zip holds ${got.files} files, the list says ${expect.files}`;
  if (expect.unpacked && got.unpacked !== expect.unpacked) return `the zip unpacks to ${got.unpacked} bytes, the list says ${expect.unpacked}`;
  if (expect.dir_hash && got.dir_hash !== expect.dir_hash) return "the zip's files are not the ones listed";
  return null;
}

/** The entries of a zip whose directory sits at `where` (directoryAt), with `tail` and a way to read more. */
async function entriesOf(tail, size, readAt) {
  const where = directoryAt(tail, size);
  if (!where) throw new ArchiveError("not a zip this can read");
  if (where.zip64) throw new ArchiveError("a zip64 archive, which firmware zips never are");
  const tailAt = size - tail.length;
  const dir = where.dirAt >= tailAt
    ? tail.subarray(where.dirAt - tailAt, where.dirAt - tailAt + where.dirLen)
    : await readAt(where.dirAt, where.dirLen);
  const entries = centralEntries(dir, 0, where.count);
  if (entries.length !== where.count) throw new ArchiveError(`the directory lists ${entries.length} of its ${where.count} files`);
  const end = entries.reduce((n, e) => Math.max(n, e.offset + 30 + e.compressed), 0);
  if (end > where.dirAt) throw new ArchiveError("the directory points past the files");
  return entries;
}

/**
 * The central directory of a zip `size` bytes long elsewhere; `range(start, end)` resolves to
 * those bytes (inclusive). One read of the tail, a second only for a directory larger than it.
 */
export async function remoteDirectory(range, size) {
  if (!(size >= 22)) throw new ArchiveError(`${size} bytes is no zip`);
  const len = Math.min(size, TAIL_BYTES);
  const tail = await range(size - len, size - 1);
  if (tail.length !== len) throw new ArchiveError(`asked for ${len} bytes of the tail, got ${tail.length}`);
  return entriesOf(tail, size, (at, n) => range(at, at + n - 1));
}

/** The central directory of the zip at `abs`; throws ArchiveError when it is not one this reads. */
export async function fileDirectory(abs) {
  const fh = await fs.open(abs, "r");
  try {
    const { size } = await fh.stat();
    const len = Math.min(size, EOCD_SEARCH);
    const tail = Buffer.alloc(len);
    await fh.read(tail, 0, len, size - len);
    return await entriesOf(tail, size, async (at, n) => {
      const buf = Buffer.alloc(n);
      const { bytesRead } = await fh.read(buf, 0, n, at);
      return buf.subarray(0, bytesRead);
    });
  } finally {
    await fh.close();
  }
}

/** The sha256 of the file at `abs`, read through once. */
export async function fileSha256(abs) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of createReadStream(abs, { highWaterMark: 4 * 1024 * 1024 })) hash.update(chunk);
  return hash.digest("hex");
}
