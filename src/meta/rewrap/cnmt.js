/**
 * Lowers the RequiredSystemVersion in a meta NCA (.cnmt.nca), so a console on
 * an older firmware does not refuse the install, and keeps every hash over it
 * consistent.
 *
 * Reference: https://switchbrew.org/wiki/NCA, https://switchbrew.org/wiki/CNMT
 *   header 0x240  section 0 start, end (u32, 0x200 units)
 *          0x280  SHA-256 of section 0's FS header
 *          0x320  key area slot 2: the section's AES-CTR key
 *   FS header (0x400):
 *     0x02  1 = PFS0, 0x03  2 = HierarchicalSha256, 0x04  1 none / 3 AES-CTR
 *     0x08  master hash (SHA-256 of the hash table)
 *     0x28  block size, 0x2C layer count (2)
 *     0x30  hash table offset, size; 0x40 PFS0 offset, size (relative to the section)
 *     0x140 upper half of the counter, stored little-endian
 *   The hash table holds one SHA-256 per block of the PFS0, the last block
 *   hashed over what is left of it.
 *   cnmt: 0x0C type (0x80 application, 0x81 patch), 0x0E extended header size,
 *         0x20 + 0x08 RequiredSystemVersion
 *
 * Only the changed cnmt block's hash, the master hash and the FS header hash
 * move; the section is encrypted again with its own key, so its other bytes
 * stay as they were. The existing hashes are checked first: a section whose
 * hashes did not match before is refused rather than "fixed".
 *
 * Pure.
 */
import crypto from "crypto";
import { ctr, ecbDecrypt, headerGeneration, keyAreaKey } from "../nca-crypto.js";
import { parsePfs0Header } from "../pfs0.js";
import { firmwareOf } from "./generations.js";
import { rightsIdOf } from "./header.js";
import { RewrapError } from "./refusals.js";

const MEDIA_UNIT = 0x200;
const FS_HEADER = 0x400;
const FS_HEADER_HASH = 0x280;
const FS_PFS0 = 1;
const HASH_SHA256 = 2;
const ENC_NONE = 1;
const ENC_CTR = 3;
const RSV_TYPES = new Set([0x80, 0x81]);
const RSV_AT = 0x20 + 0x08;

const sha = (buf) => crypto.createHash("sha256").update(buf).digest();
const unsupported = (detail) => new RewrapError("unsupported", {}, `meta NCA: ${detail}`);

/** Section 0 of a meta NCA as this module reads it, from its original decrypted header. */
function sectionOf(header, ncaSize) {
  const fsh = header.subarray(FS_HEADER, FS_HEADER + 0x200);
  if (fsh[0x02] !== FS_PFS0 || fsh[0x03] !== HASH_SHA256) throw unsupported("section 0 is not a hashed PFS0");
  if (fsh.readUInt32LE(0x2c) !== 2) throw unsupported("unexpected hash layer count");
  const start = header.readUInt32LE(0x240) * MEDIA_UNIT;
  const end = header.readUInt32LE(0x244) * MEDIA_UNIT;
  const region = (at) => ({ offset: Number(fsh.readBigUInt64LE(at)), size: Number(fsh.readBigUInt64LE(at + 8)) });
  const table = region(0x30);
  const data = region(0x40);
  const blockSize = fsh.readUInt32LE(0x28);
  const inside = (r) => r.offset + r.size <= end - start;
  if (!(start < end && end <= ncaSize && blockSize > 0 && inside(table) && inside(data))) throw unsupported("section lies outside the NCA");
  if (table.size < Math.ceil(data.size / blockSize) * 0x20) throw unsupported("hash table too small");
  return { fsh, start, end, table, data, blockSize, encryption: fsh[0x04] };
}

function cipherOf(header, section, keys) {
  if (section.encryption === ENC_NONE) return null;
  if (section.encryption !== ENC_CTR) throw unsupported("unknown section encryption");
  if (rightsIdOf(header)) throw unsupported("titlekey-encrypted meta NCA");
  const gen = headerGeneration(header);
  const kak = keyAreaKey(keys, header[0x207], gen);
  if (!kak) throw new RewrapError("keyMissing", { gen, firmware: firmwareOf(gen) }, `meta NCA: no key area key for generation ${gen}`);
  return { key: ecbDecrypt(kak, header.subarray(0x320, 0x330)), upper: Buffer.from(section.fsh.subarray(0x140, 0x148)).reverse() };
}

const blockHash = (data, s, b) => sha(data.subarray(b * s.blockSize, Math.min((b + 1) * s.blockSize, s.data.size)));

/**
 * `{ header, section: { at, bytes } }`: the meta NCA's header with its FS
 * header hash renewed (start from `lowered`, the header after lowerHeader) and
 * its re-encrypted section 0, both to replace what `nca` (the NCA's bytes)
 * holds. null when the RequiredSystemVersion is `systemVersion` or lower
 * already, or the cnmt has none. Throws RewrapError.
 *
 * `original` is the decrypted header as the file has it, for the section key.
 */
export function lowerRequiredSystem({ original, lowered, nca, keys }, systemVersion) {
  const s = sectionOf(original, nca.length);
  const cipher = cipherOf(original, s, keys);
  const raw = nca.subarray(s.start, s.end);
  const plain = cipher ? ctr(cipher.key, cipher.upper, s.start, raw) : Buffer.from(raw);
  const table = plain.subarray(s.table.offset, s.table.offset + s.table.size);
  const data = plain.subarray(s.data.offset, s.data.offset + s.data.size);
  if (!sha(table).equals(s.fsh.subarray(0x08, 0x28))) throw unsupported("master hash does not match");

  const pfs0 = parsePfs0Header(data);
  const entry = pfs0?.entries?.find((e) => /\.cnmt$/i.test(e.name));
  if (!entry || entry.offset + entry.size > data.length || entry.size < RSV_AT + 4) throw unsupported("no cnmt in the PFS0");
  const cnmt = data.subarray(entry.offset, entry.offset + entry.size);
  if (!RSV_TYPES.has(cnmt[0x0c]) || cnmt.readUInt16LE(0x0e) < 0x0c) return null;
  if (cnmt.readUInt32LE(RSV_AT) <= systemVersion) return null;

  const at = entry.offset + RSV_AT;
  const blocks = [Math.floor(at / s.blockSize), Math.floor((at + 3) / s.blockSize)];
  for (const b of new Set(blocks)) {
    if (!blockHash(data, s, b).equals(table.subarray(b * 0x20, b * 0x20 + 0x20))) throw unsupported("block hash does not match");
  }
  data.writeUInt32LE(systemVersion, at);
  for (const b of new Set(blocks)) blockHash(data, s, b).copy(table, b * 0x20);

  const header = Buffer.from(lowered);
  const fsh = header.subarray(FS_HEADER, FS_HEADER + 0x200);
  sha(table).copy(fsh, 0x08);
  sha(fsh).copy(header, FS_HEADER_HASH);
  return { header, section: { at: s.start, bytes: cipher ? ctr(cipher.key, cipher.upper, s.start, plain) : plain } };
}
