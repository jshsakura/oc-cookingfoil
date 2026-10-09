/**
 * Reads the file table of a PFS0 container (NSP and NSZ are both PFS0) and
 * copies single entries out without unpacking the rest.
 *
 * Reference: https://switchbrew.org/wiki/NCA#PFS0
 *   0x00  4  "PFS0"
 *   0x04  4  file count
 *   0x08  4  string table size
 *   0x0C  4  reserved
 *   0x10  file count × 0x18 entries: data offset u64, size u64, name offset u32, reserved u32
 *   then the string table, then file data (offsets are relative to its start)
 *
 * The full nstool dump copies multi-GB program NCAs to read a few kilobytes of
 * metadata; this reads only the header and the entries actually needed.
 */
import fs from "fs/promises";

const MAGIC = "PFS0";
const HEADER_SIZE = 0x10;
const ENTRY_SIZE = 0x18;
const MAX_FILES = 4096;
const MAX_STRING_TABLE = 1 << 20;
const COPY_CHUNK = 1 << 20;

/** Parses the PFS0 header from the start of a buffer; null when it is not one. */
export function parsePfs0Header(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < HEADER_SIZE) return null;
  if (buf.toString("ascii", 0, 4) !== MAGIC) return null;
  const count = buf.readUInt32LE(0x04);
  const stringTableSize = buf.readUInt32LE(0x08);
  if (count > MAX_FILES || stringTableSize > MAX_STRING_TABLE) return null;
  const stringsAt = HEADER_SIZE + count * ENTRY_SIZE;
  const dataStart = stringsAt + stringTableSize;
  if (buf.length < dataStart) return { needBytes: dataStart };
  const entries = [];
  for (let i = 0; i < count; i++) {
    const at = HEADER_SIZE + i * ENTRY_SIZE;
    const offset = Number(buf.readBigUInt64LE(at));
    const size = Number(buf.readBigUInt64LE(at + 8));
    const nameOffset = buf.readUInt32LE(at + 16);
    const nameEnd = buf.indexOf(0, stringsAt + nameOffset);
    const name = buf.toString("utf8", stringsAt + nameOffset, nameEnd < 0 ? dataStart : nameEnd);
    entries.push({ name, offset: dataStart + offset, size });
  }
  return { entries };
}

/** Lists the entries of a PFS0 file on disk; null when it is not a PFS0. */
export async function readPfs0Entries(filePath) {
  const handle = await fs.open(filePath, "r");
  try {
    let length = 0x4000;
    for (;;) {
      const buf = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buf, 0, length, 0);
      const parsed = parsePfs0Header(buf.subarray(0, bytesRead));
      if (!parsed) return null;
      if (parsed.entries) return parsed.entries;
      if (parsed.needBytes > bytesRead && bytesRead < length) return null; // truncated file
      length = parsed.needBytes;
    }
  } finally {
    await handle.close();
  }
}

/** Copies one entry's bytes to `destPath`. */
export async function copyPfs0Entry(filePath, entry, destPath) {
  const src = await fs.open(filePath, "r");
  const dest = await fs.open(destPath, "w");
  try {
    const buf = Buffer.alloc(Math.min(COPY_CHUNK, Math.max(1, entry.size)));
    let done = 0;
    while (done < entry.size) {
      const want = Math.min(buf.length, entry.size - done);
      const { bytesRead } = await src.read(buf, 0, want, entry.offset + done);
      if (bytesRead === 0) throw new Error("pfs0 entry is truncated");
      await dest.write(buf, 0, bytesRead);
      done += bytesRead;
    }
  } finally {
    await src.close();
    await dest.close();
  }
}
