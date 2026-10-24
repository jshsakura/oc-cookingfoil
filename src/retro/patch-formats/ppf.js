/**
 * PPF: "PPF", a zero byte and the version (1, 2 or 3); versions 2 and 3 carry an image name,
 * version 3 also the original's size (its low four bytes) and always ends with 1024 bytes of
 * validation data. A block is a 4-byte offset, a 1-byte length and that many bytes, and blocks
 * only ever overwrite, never extend. No whole-source checksum exists, so like IPS the source is
 * not verified; version 3's declared size is checked and a mismatch refuses the patch.
 */
import { broken, RomPatchError } from "./error.js";

const MAGIC = Buffer.from("PPF\x00", "latin1");
const VALIDATION_BYTES = 1024;

/** `source` with the PPF `patch` applied, as a new Buffer. Pure. */
export function applyPpf(source, patch) {
  if (patch.length < 6 || !patch.subarray(0, 4).equals(MAGIC)) throw broken("PPF", "no PPF header");
  const version = patch[4];
  if (version < 1 || version > 3) throw broken("PPF", `unknown version ${version}`);
  let at = 5;
  if (version >= 2) {
    if (at + 4 > patch.length) throw broken("PPF", "the image name length is cut short");
    const nameLen = patch.readUInt32BE(at);
    at += 4;
    if (at + nameLen > patch.length) throw broken("PPF", "the image name is cut short");
    at += nameLen;
  }
  if (version === 3) {
    if (at + 4 > patch.length) throw broken("PPF", "the original's size is cut short");
    const size = patch.readUInt32BE(at);
    at += 4;
    if ((source.length >>> 0) !== size) {
      throw new RomPatchError("source-mismatch", `PPF patch is for a ${size}-byte file, the ROM is ${source.length}`);
    }
    if (patch.length - at < VALIDATION_BYTES) throw broken("PPF", "the validation data is missing");
  }
  const writes = [];
  let end = source.length;
  const last = patch.length - (version === 3 ? VALIDATION_BYTES : 0);
  while (at < last) {
    if (at + 5 > last) throw broken("PPF", "a block is cut short");
    const offset = patch.readUInt32BE(at);
    const len = patch[at + 4];
    at += 5;
    if (!len || at + len > last) throw broken("PPF", "a block is cut short");
    writes.push([offset, patch.subarray(at, at + len)]);
    at += len;
    end = Math.max(end, offset + len);
  }
  const out = Buffer.alloc(end);
  source.copy(out);
  for (const [offset, bytes] of writes) bytes.copy(out, offset);
  return out;
}
