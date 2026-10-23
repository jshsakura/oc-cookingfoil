/**
 * Reads one file out of a zip archive: enough to hash the ROM inside a
 * cartridge zip. Only stored and deflated entries, no zip64, no encryption;
 * anything else is null.
 */
import fs from "fs/promises";
import { createReadStream } from "fs";
import { Readable, Transform, pipeline } from "stream";
import zlib from "zlib";

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const EOCD_MIN = 22;
const EOCD_SEARCH = EOCD_MIN + 0xffff;
const CENTRAL_MIN = 46;
// A record is 46 bytes plus a name, an extra field and a comment of up to 64 KB each.
const CENTRAL_MAX = CENTRAL_MIN + 3 * 0xffff;
const DIR_MAX = 64 * 1024 * 1024;

/** Where the end-of-central-directory record of `buf` (the zip's tail) starts, or -1. Pure. */
function eocdAt(buf) {
  for (let i = buf.length - EOCD_MIN; i >= Math.max(0, buf.length - EOCD_SEARCH); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

/** `count` central directory entries read from `buf` starting at `at`; offsets are the zip's own. Pure. */
function centralEntries(buf, at, count) {
  const out = [];
  for (let n = 0; n < count && at + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(at) !== CENTRAL_SIG) break;
    const nameLen = buf.readUInt16LE(at + 28);
    out.push({
      flags: buf.readUInt16LE(at + 8),
      method: buf.readUInt16LE(at + 10),
      crc32: buf.readUInt32LE(at + 16).toString(16).padStart(8, "0"),
      compressed: buf.readUInt32LE(at + 20),
      size: buf.readUInt32LE(at + 24),
      offset: buf.readUInt32LE(at + 42),
      name: buf.toString("utf8", at + 46, at + 46 + nameLen),
    });
    at += 46 + nameLen + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
  }
  return out;
}

/** The central directory entries of a zip held in `buf`: [{ name, method, flags, crc32, compressed, size, offset }]. Pure. */
export function zipEntries(buf) {
  const eocd = eocdAt(buf);
  return eocd < 0 ? [] : centralEntries(buf, buf.readUInt32LE(eocd + 16), buf.readUInt16LE(eocd + 10));
}

/**
 * The central directory entries of the zip at `abs`, read from its tail alone: the
 * CRC-32 of every file without inflating any. [] when it is not a zip this can read.
 */
export async function zipDirectory(abs) {
  const fh = await fs.open(abs, "r");
  try {
    const { size } = await fh.stat();
    const tailLen = Math.min(size, EOCD_SEARCH);
    const tail = Buffer.alloc(tailLen);
    await fh.read(tail, 0, tailLen, size - tailLen);
    const eocd = eocdAt(tail);
    if (eocd < 0) return [];
    const count = tail.readUInt16LE(eocd + 10);
    const dirLen = tail.readUInt32LE(eocd + 12);
    const dirAt = tail.readUInt32LE(eocd + 16);
    if (dirAt + dirLen > size || dirLen > DIR_MAX || dirLen < count * CENTRAL_MIN || dirLen > count * CENTRAL_MAX) return [];
    const dir = Buffer.alloc(dirLen);
    await fh.read(dir, 0, dirLen, dirAt);
    return centralEntries(dir, 0, count);
  } finally {
    await fh.close();
  }
}

/** Passes at most `max` bytes on; one more fails the stream (a zip bomb, or a size the directory lied about). */
function capped(max) {
  let seen = 0;
  return new Transform({
    transform(chunk, _enc, cb) {
      seen += chunk.length;
      cb(seen > max ? new Error(`zip entry inflates past its declared ${max} bytes`) : null, chunk);
    },
  });
}

/**
 * A stream of `entry`'s uncompressed bytes from the zip at `abs`, or null when it
 * cannot be read here. Inflating past the size the directory declares fails it.
 */
export async function entryStream(abs, entry) {
  if (entry.flags & 1 || (entry.method !== 0 && entry.method !== 8)) return null;
  const fh = await fs.open(abs, "r");
  let start;
  try {
    const local = Buffer.alloc(30);
    const { bytesRead } = await fh.read(local, 0, 30, entry.offset);
    if (bytesRead !== 30 || local.readUInt32LE(0) !== LOCAL_SIG) return null;
    start = entry.offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
  } finally {
    await fh.close();
  }
  if (!entry.compressed) return Readable.from([]);
  const raw = createReadStream(abs, { start, end: start + entry.compressed - 1, highWaterMark: 1024 * 1024 });
  if (entry.method === 0) return raw;
  return pipeline(raw, zlib.createInflateRaw(), capped(entry.size), () => {});
}

/** The bytes of `entry` in the zip held in `buf`, or null when it cannot be read here. Pure. */
export function entryData(buf, entry) {
  if (entry.flags & 1) return null; // encrypted
  const at = entry.offset;
  if (at + 30 > buf.length || buf.readUInt32LE(at) !== LOCAL_SIG) return null;
  const start = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28);
  const raw = buf.subarray(start, start + entry.compressed);
  if (raw.length !== entry.compressed) return null;
  if (entry.method === 0) return raw;
  if (entry.method !== 8) return null;
  try {
    const out = zlib.inflateRawSync(raw, { maxOutputLength: entry.size + 1 });
    return out.length === entry.size ? out : null;
  } catch {
    return null;
  }
}

/**
 * The largest file in the zip at `abs` (a cartridge zip holds one ROM, maybe a
 * readme beside it) as { name, data }, or null. Archives over `maxBytes` are not read.
 */
export async function largestEntry(abs, { maxBytes = 64 * 1024 * 1024 } = {}) {
  const stat = await fs.stat(abs);
  if (stat.size > maxBytes) return null;
  const buf = await fs.readFile(abs);
  const files = zipEntries(buf).filter((e) => !e.name.endsWith("/") && e.size <= maxBytes);
  const best = files.sort((a, b) => b.size - a.size)[0];
  if (!best) return null;
  const data = entryData(buf, best);
  return data ? { name: best.name, data } : null;
}
