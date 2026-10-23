/**
 * Reads the cnmt of an NSP, NSZ, XCI or XCZ straight from the file with the
 * console keys: a few kilobytes read, no tool started, nothing copied out.
 * nstool needs the whole meta NCA on disk first; this decrypts only the
 * header, the PFS0 table and the cnmt itself.
 *
 * Reference: https://switchbrew.org/wiki/NCA
 *   0x000-0xC00  header, AES-128-XTS with header_key, 0x200 sectors, tweak = sector number big-endian
 *     0x200  "NCA3" (NCA2: each section header is its own sector 0)
 *     0x205  content type (1 = meta)
 *     0x206  key generation (old), 0x220 key generation; master key revision = max - 1
 *     0x207  key area key index (0 application, 1 ocean, 2 system)
 *     0x230  rights id (all zero for a meta NCA)
 *     0x240  section table, 4 × 0x10: start u32, end u32 in 0x200 units
 *     0x300  key area, 4 × 0x10, AES-128-ECB with key_area_key_*; [2] is the CTR key
 *   0x400 + 0x200 × i  section header i
 *     0x02  type (1 = PFS0), 0x04 encryption (1 none, 3 CTR)
 *     0x08  hierarchical sha256 data: 0x24 layer count, 0x28 regions × (offset u64, size u64); the last is the PFS0
 *     0x140 upper half of the CTR, stored little-endian
 */
import fs from "fs/promises";
import { readPfs0Entries, parsePfs0Header } from "./pfs0.js";
import { readXciSecureEntries } from "./hfs0.js";
import { loadKeys } from "../security/prod-keys.js";
import { HEADER_BYTES, decryptHeader, ecbDecrypt, ctr, headerGeneration, keyAreaKey } from "./nca-crypto.js";

const MEDIA_UNIT = 0x200;
const CONTENT_META = 1;
const FS_PFS0 = 1;
const ENC_NONE = 1;
const ENC_CTR = 3;
const MAX_CNMT = 1 << 20;
const PFS0_TABLE_START = 0x4000;

/**
 * Where section 0's PFS0 sits in the NCA and how to read it, from a decrypted
 * header; null when this is no readable meta NCA. Pure.
 */
export function metaSection(header, keys) {
  const magic = header.toString("ascii", 0x200, 0x204);
  if (magic !== "NCA3" && magic !== "NCA2") return null;
  if (header[0x205] !== CONTENT_META) return null;
  const fsh = header.subarray(0x400, 0x600);
  if (fsh[0x02] !== FS_PFS0) return null;
  const start = header.readUInt32LE(0x240) * MEDIA_UNIT;
  const layers = fsh.readUInt32LE(0x08 + 0x24);
  if (layers < 1 || layers > 5) return null;
  const pfs0At = start + Number(fsh.readBigUInt64LE(0x08 + 0x28 + (layers - 1) * 0x10));
  const encryption = fsh[0x04];
  if (encryption === ENC_NONE) return { pfs0At, key: null, upper: null };
  if (encryption !== ENC_CTR) return null;
  const kak = keyAreaKey(keys, header[0x207], headerGeneration(header));
  if (!kak) return null;
  const key = ecbDecrypt(kak, header.subarray(0x300 + 0x20, 0x300 + 0x30));
  return { pfs0At, key, upper: Buffer.from(fsh.subarray(0x140, 0x148)).reverse() };
}

/**
 * Reads up to `length` plaintext bytes at NCA offset `at` of a section; fewer
 * when the file ends first (a meta NCA is often the last thing in an NSP).
 */
async function readSection(handle, ncaAt, section, at, length) {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buf, 0, length, ncaAt + at);
  if (bytesRead === 0) return null;
  const raw = buf.subarray(0, bytesRead);
  return section.key ? ctr(section.key, section.upper, at, raw) : raw;
}

/** The cnmt bytes of the meta NCA at `ncaAt` in an open file; null when unreadable. */
export async function readCnmtAt(handle, ncaAt, keys) {
  const headerKey = keys.get("header_key");
  if (headerKey?.length !== 64) return null;
  const raw = Buffer.alloc(HEADER_BYTES);
  const { bytesRead } = await handle.read(raw, 0, HEADER_BYTES, ncaAt);
  if (bytesRead < HEADER_BYTES) return null;
  const section = metaSection(decryptHeader(raw, Buffer.from(headerKey, "hex")), keys);
  if (!section) return null;
  let length = PFS0_TABLE_START;
  for (;;) {
    const table = await readSection(handle, ncaAt, section, section.pfs0At, length);
    if (!table) return null;
    const parsed = parsePfs0Header(table);
    if (!parsed) return null;
    if (parsed.needBytes) {
      if (parsed.needBytes <= table.length) return null;
      length = parsed.needBytes;
      continue;
    }
    const cnmt = parsed.entries.find((e) => /\.cnmt$/i.test(e.name));
    if (!cnmt || cnmt.size > MAX_CNMT) return null;
    const body = await readSection(handle, ncaAt, section, section.pfs0At + cnmt.offset, cnmt.size);
    return body?.length === cnmt.size ? body : null;
  }
}

const XCI_RE = /\.xc[iz]$/i;

/**
 * Every cnmt of an NSP, NSZ, XCI or XCZ (a cartridge can carry its update
 * too); empty when the keys or the file cannot give one.
 */
export async function readCnmts(absPath, keys = loadKeys()) {
  if (!keys) return [];
  const entries = XCI_RE.test(absPath) ? await readXciSecureEntries(absPath) : await readPfs0Entries(absPath);
  const metas = (entries ?? []).filter((e) => /\.cnmt\.nca$/i.test(e.name));
  if (!metas.length) return [];
  const handle = await fs.open(absPath, "r");
  try {
    const out = [];
    for (const meta of metas) {
      const cnmt = await readCnmtAt(handle, meta.offset, keys);
      if (cnmt) out.push({ entry: meta, cnmt });
    }
    return out;
  } finally {
    await handle.close();
  }
}
