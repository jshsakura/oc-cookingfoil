/**
 * Reads the file table of the "secure" partition of an XCI (or XCZ), where
 * the game's NCAs live, without unpacking anything.
 *
 * Reference: https://switchbrew.org/wiki/Gamecard_Format
 *   XCI header at 0x000 (0x1000 later when a key area is prepended):
 *     0x100  4  "HEAD"
 *     0x130  8  offset of the root HFS0
 *     0x138  8  size of the root HFS0 header
 *   HFS0:
 *     0x00  4  "HFS0"
 *     0x04  4  file count
 *     0x08  4  string table size
 *     0x0C  4  reserved
 *     0x10  file count × 0x40 entries: offset u64, size u64, name offset u32,
 *           hashed size u32, reserved u64, sha256 [0x20]
 *     then the string table, then file data (offsets are relative to its start)
 *
 * The root HFS0 lists the partitions (update, normal, secure, logo); each is
 * itself an HFS0 at root data start + its offset.
 */
import fs from "fs/promises";

const HFS0_MAGIC = "HFS0";
const HEADER_SIZE = 0x10;
const ENTRY_SIZE = 0x40;
const MAX_FILES = 4096;
const MAX_STRING_TABLE = 1 << 20;
// Where the XCI header can start: at 0, or after a prepended 0x1000 key area.
const XCI_STARTS = [0, 0x1000];

/**
 * Parses an HFS0 header from the start of `buf`; entry offsets are absolute
 * when `base` is where the HFS0 starts in the file. Returns { entries },
 * { needBytes } when the buffer is too short, or null when it is not an HFS0.
 */
export function parseHfs0Header(buf, base = 0) {
  if (!Buffer.isBuffer(buf) || buf.length < HEADER_SIZE) return null;
  if (buf.toString("ascii", 0, 4) !== HFS0_MAGIC) return null;
  const count = buf.readUInt32LE(0x04);
  const stringTableSize = buf.readUInt32LE(0x08);
  if (count > MAX_FILES || stringTableSize > MAX_STRING_TABLE) return null;
  const stringsAt = HEADER_SIZE + count * ENTRY_SIZE;
  const dataStart = stringsAt + stringTableSize;
  if (buf.length < dataStart) return { needBytes: dataStart };
  const entries = [];
  for (let i = 0; i < count; i++) {
    const at = HEADER_SIZE + i * ENTRY_SIZE;
    const nameOffset = buf.readUInt32LE(at + 0x10);
    const nameEnd = buf.indexOf(0, stringsAt + nameOffset);
    entries.push({
      name: buf.toString("utf8", stringsAt + nameOffset, nameEnd < 0 || nameEnd > dataStart ? dataStart : nameEnd),
      nameAt: base + stringsAt + nameOffset,
      offset: base + dataStart + Number(buf.readBigUInt64LE(at)),
      size: Number(buf.readBigUInt64LE(at + 0x08)),
      hashedSize: buf.readUInt32LE(at + 0x14),
      sha256: buf.subarray(at + 0x20, at + 0x40).toString("hex"),
    });
  }
  return { entries };
}

async function readAt(handle, position, length) {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buf, 0, length, position);
  return buf.subarray(0, bytesRead);
}

/** The HFS0 at `position`, read with as many bytes as its header needs; null when there is none. */
async function readHfs0(handle, position) {
  let length = 0x4000;
  for (;;) {
    const buf = await readAt(handle, position, length);
    const parsed = parseHfs0Header(buf, position);
    if (!parsed) return null;
    if (parsed.entries) return parsed.entries;
    if (buf.length < length) return null; // truncated file
    length = parsed.needBytes;
  }
}

/**
 * The entries of the secure partition of the XCI/XCZ at `filePath`, with
 * absolute offsets; null when the file is not a readable gamecard image.
 */
export async function readXciSecureEntries(filePath) {
  const handle = await fs.open(filePath, "r");
  try {
    for (const start of XCI_STARTS) {
      const head = await readAt(handle, start, 0x140);
      if (head.length < 0x140 || head.toString("ascii", 0x100, 0x104) !== "HEAD") continue;
      const rootAt = start + Number(head.readBigUInt64LE(0x130));
      const root = await readHfs0(handle, rootAt);
      const secure = root?.find((e) => e.name === "secure");
      if (!secure) return null;
      return await readHfs0(handle, secure.offset);
    }
    return null;
  } finally {
    await handle.close();
  }
}
