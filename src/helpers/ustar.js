/**
 * Minimal POSIX ustar writer for streaming downloads: regular files and
 * directories only, no compression, so the size is known before the first
 * byte (Content-Length) and a client can unpack while it reads.
 *
 * A path that doesn't fit ustar (name 100 bytes; a Korean title is 3 bytes a
 * character) gets a POSIX pax extended header ("x") carrying `path=` just
 * before its own header, as GNU tar, bsdtar and libarchive read it. A file of
 * 8 GiB or more doesn't fit the 11 octal digits of the size field: its size
 * goes both into a pax `size=` record and, GNU style, base-256 into the field.
 */
import crypto from "crypto";

const BLOCK = 512;
const NAME_MAX = 100;
const PREFIX_MAX = 155;
// 11 octal digits in the size field; larger sizes take a pax record and base-256.
const OCTAL_MAX = 8 ** 11 - 1;
// Past this a file's bytes can't be counted exactly in a JavaScript number.
export const MAX_FILE_SIZE = Number.MAX_SAFE_INTEGER;

/**
 * Splits a path into ustar { name, prefix } at a "/", or null when it does not
 * fit (name 100 bytes, prefix 155 bytes). Pure.
 */
export function splitPath(path) {
  const bytes = Buffer.from(path, "utf8");
  if (bytes.length <= NAME_MAX) return { name: bytes, prefix: Buffer.alloc(0) };
  for (let i = bytes.length - 1; i > 0; i--) {
    if (bytes[i] !== 0x2f || i === bytes.length - 1) continue;
    const prefix = bytes.subarray(0, i);
    const name = bytes.subarray(i + 1);
    if (name.length > NAME_MAX) return null;
    if (prefix.length <= PREFIX_MAX) return { name, prefix };
  }
  return null;
}

/** True when a file path, and the directory path of each of its parents, fit ustar. */
export function fitsUstar(filePath) {
  if (!splitPath(filePath)) return false;
  const parts = filePath.split("/");
  for (let i = 1; i < parts.length; i++) {
    if (!splitPath(parts.slice(0, i).join("/") + "/")) return false;
  }
  return true;
}

function octal(value, width) {
  return value.toString(8).padStart(width - 1, "0") + "\0";
}

/** GNU base-256 for the 12-byte size field: high bit set, the value big-endian. Pure. */
function base256(value) {
  const out = Buffer.alloc(12);
  let v = BigInt(value);
  for (let i = 11; i > 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  out[0] = 0x80;
  return out;
}

/** One pax record, "<length> <key>=<value>\n", whose length counts its own digits. Pure. */
export function paxRecord(key, value) {
  const body = ` ${key}=${value}\n`;
  const bodyBytes = Buffer.byteLength(body, "utf8");
  let length = bodyBytes + 1;
  while (String(length).length + bodyBytes !== length) length = String(length).length + bodyBytes;
  return Buffer.from(`${length}${body}`, "utf8");
}

/** A short stand-in name for a header whose real path travels in a pax record. */
function shortName(path, dir) {
  const ext = dir ? "/" : (path.match(/\.[A-Za-z0-9]{1,8}$/)?.[0] ?? "");
  return `PaxPath/${crypto.createHash("sha1").update(path).digest("hex").slice(0, 16)}${ext}`;
}

/**
 * The header block(s) for one entry: the ustar header, preceded by a pax
 * header and its records when the path is too long or the size too large.
 * `path` ends with "/" for a directory.
 */
export function header(entry) {
  const records = paxRecords(entry);
  if (!records.length) return ustarHeader(entry);
  const record = Buffer.concat(records);
  const own = splitPath(entry.path) ? entry.path : shortName(entry.path, entry.dir);
  return Buffer.concat([
    ustarHeader({ path: `PaxHeaders/${shortName(entry.path, false)}`, size: record.length, mtime: entry.mtime, type: "x" }),
    record,
    padding(record.length),
    ustarHeader({ ...entry, path: own }),
  ]);
}

/** The pax records an entry needs: a path that doesn't fit, a size past the octal field. Pure. */
function paxRecords(entry) {
  const out = [];
  if (!splitPath(entry.path)) out.push(paxRecord("path", entry.path));
  if (!entry.dir && entry.size > OCTAL_MAX) out.push(paxRecord("size", String(entry.size)));
  return out;
}

/** Bytes header() writes for this entry. Pure. */
export function headerSize(entry) {
  const record = paxRecords(entry).reduce((n, r) => n + r.length, 0);
  return record ? BLOCK + Math.ceil(record / BLOCK) * BLOCK + BLOCK : BLOCK;
}

function ustarHeader({ path, size = 0, mtime = 0, dir = false, type }) {
  const split = splitPath(path);
  if (!split) throw new Error(`path does not fit ustar: ${path}`);
  if (size > MAX_FILE_SIZE) throw new Error(`file too large: ${path}`);
  const h = Buffer.alloc(BLOCK);
  split.name.copy(h, 0);
  h.write(octal(dir ? 0o755 : 0o644, 8), 100, "ascii");
  h.write(octal(0, 8), 108, "ascii");
  h.write(octal(0, 8), 116, "ascii");
  const sized = dir && !type ? 0 : size;
  if (sized > OCTAL_MAX) base256(sized).copy(h, 124);
  else h.write(octal(sized, 12), 124, "ascii");
  h.write(octal(Math.max(0, Math.floor(mtime)), 12), 136, "ascii");
  h.fill(0x20, 148, 156); // checksum counts as spaces while it is summed
  h.write(type ?? (dir ? "5" : "0"), 156, "ascii");
  h.write("ustar\0", 257, "ascii");
  h.write("00", 263, "ascii");
  split.prefix.copy(h, 345);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
  return h;
}

export function padding(size) {
  const rest = size % BLOCK;
  return rest ? Buffer.alloc(BLOCK - rest) : Buffer.alloc(0);
}

/** End-of-archive marker: two zero blocks. */
export const TRAILER = Buffer.alloc(BLOCK * 2);

/** Archive size for these entries: each header, file data padded to blocks, the trailer. Pure. */
export function archiveSize(entries) {
  let total = TRAILER.length;
  for (const e of entries) total += headerSize(e) + (e.dir ? 0 : Math.ceil(e.size / BLOCK) * BLOCK);
  return total;
}
