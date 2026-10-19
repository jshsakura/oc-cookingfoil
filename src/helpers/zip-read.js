/**
 * Reads one file out of a zip archive: enough to hash the ROM inside a
 * cartridge zip. Only stored and deflated entries, no zip64, no encryption;
 * anything else is null.
 */
import fs from "fs/promises";
import zlib from "zlib";

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const EOCD_MIN = 22;
const EOCD_SEARCH = EOCD_MIN + 0xffff;

/** The central directory entries of a zip held in `buf`: [{ name, method, flags, compressed, size, offset }]. Pure. */
export function zipEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - EOCD_MIN; i >= Math.max(0, buf.length - EOCD_SEARCH); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) return [];
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let n = 0; n < count && at + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(at) !== CENTRAL_SIG) break;
    const nameLen = buf.readUInt16LE(at + 28);
    out.push({
      flags: buf.readUInt16LE(at + 8),
      method: buf.readUInt16LE(at + 10),
      compressed: buf.readUInt32LE(at + 20),
      size: buf.readUInt32LE(at + 24),
      offset: buf.readUInt32LE(at + 42),
      name: buf.toString("utf8", at + 46, at + 46 + nameLen),
    });
    at += 46 + nameLen + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
  }
  return out;
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
