/**
 * Minimal POSIX ustar writer for streaming downloads: regular files and
 * directories only, no compression, so the size is known before the first
 * byte (Content-Length) and a client can unpack while it reads.
 */
const BLOCK = 512;
const NAME_MAX = 100;
const PREFIX_MAX = 155;
// 11 octal digits in the size field.
export const MAX_FILE_SIZE = 8 ** 11 - 1;

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

/** One 512-byte header. `path` ends with "/" for a directory. */
export function header({ path, size = 0, mtime = 0, dir = false }) {
  const split = splitPath(path);
  if (!split) throw new Error(`path does not fit ustar: ${path}`);
  if (size > MAX_FILE_SIZE) throw new Error(`file too large for ustar: ${path}`);
  const h = Buffer.alloc(BLOCK);
  split.name.copy(h, 0);
  h.write(octal(dir ? 0o755 : 0o644, 8), 100, "ascii");
  h.write(octal(0, 8), 108, "ascii");
  h.write(octal(0, 8), 116, "ascii");
  h.write(octal(dir ? 0 : size, 12), 124, "ascii");
  h.write(octal(Math.max(0, Math.floor(mtime)), 12), 136, "ascii");
  h.fill(0x20, 148, 156); // checksum counts as spaces while it is summed
  h.write(dir ? "5" : "0", 156, "ascii");
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
  for (const e of entries) total += BLOCK + (e.dir ? 0 : Math.ceil(e.size / BLOCK) * BLOCK);
  return total;
}
