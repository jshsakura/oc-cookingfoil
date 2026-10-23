/**
 * BPS (byuu's beat): "BPS1", the source, target and metadata sizes, the metadata, actions that
 * build the target from the source, the patch and itself, then the CRC-32 of the source, the
 * target and the patch. A source whose size or CRC differs is refused before anything is built.
 */
import zlib from "zlib";
import { RomPatchError, broken } from "./error.js";

const HEADER = Buffer.from("BPS1");
const FOOTER = 12;

/** A reader of the variable-length numbers BPS and UPS share, over `buf` from `at`. */
export function numbers(buf, at, format) {
  const r = {
    at,
    next() {
      let value = 0;
      let shift = 1;
      for (;;) {
        if (r.at >= buf.length) throw broken(format, "a number runs past the end");
        const x = buf[r.at++];
        value += (x & 0x7f) * shift;
        if (x & 0x80) return value;
        shift *= 128;
        value += shift;
        if (!Number.isSafeInteger(value)) throw broken(format, "a number is too large");
      }
    },
  };
  return r;
}

const crc = (buf) => zlib.crc32(buf) >>> 0;

/** The three CRC-32s at the end of a BPS or UPS patch, after checking the patch's own. */
export function footerOf(patch, format) {
  const end = patch.length - FOOTER;
  const sums = { source: patch.readUInt32LE(end), target: patch.readUInt32LE(end + 4), patch: patch.readUInt32LE(end + 8) };
  if (crc(patch.subarray(0, end + 8)) !== sums.patch) throw broken(format, "its own checksum does not match");
  return sums;
}

/** Refuses a source that is not the one the patch was made from. */
export function checkSource(source, size, sum, format) {
  if (source.length !== size || crc(source) !== sum) {
    throw new RomPatchError("source-mismatch", `${format} patch is for another ROM (size ${size}, CRC ${sum.toString(16).padStart(8, "0")})`);
  }
}

/** Refuses a result whose CRC is not the one the patch promises. */
export function checkTarget(target, sum, format) {
  if (crc(target) !== sum) throw broken(format, "the result's checksum does not match");
}

/** `source` with the BPS `patch` applied, as a new Buffer; throws when the source is not its own. Pure. */
export function applyBps(source, patch) {
  if (patch.length < HEADER.length + FOOTER || !patch.subarray(0, 4).equals(HEADER)) throw broken("BPS", "no BPS1 header");
  const sums = footerOf(patch, "BPS");
  const n = numbers(patch, 4, "BPS");
  const sourceSize = n.next();
  const targetSize = n.next();
  const metadata = n.next();
  n.at += metadata; // unread
  checkSource(source, sourceSize, sums.source, "BPS");
  const target = Buffer.alloc(targetSize);
  const end = patch.length - FOOTER;
  let out = 0;
  let sourceAt = 0;
  let targetAt = 0;
  while (n.at < end) {
    const action = n.next();
    const len = Math.floor(action / 4) + 1;
    if (out + len > targetSize) throw broken("BPS", "it writes past the target size");
    const mode = action % 4;
    if (mode === 0) {
      if (out + len > source.length) throw broken("BPS", "it reads past the source");
      source.copy(target, out, out, out + len);
    } else if (mode === 1) {
      if (n.at + len > end) throw broken("BPS", "its data runs past the end");
      patch.copy(target, out, n.at, n.at + len);
      n.at += len;
    } else {
      const d = n.next();
      const step = (d % 2 ? -1 : 1) * Math.floor(d / 2);
      if (mode === 2) {
        sourceAt += step;
        if (sourceAt < 0 || sourceAt + len > source.length) throw broken("BPS", "it reads past the source");
        source.copy(target, out, sourceAt, sourceAt + len);
        sourceAt += len;
      } else {
        targetAt += step;
        if (targetAt < 0 || targetAt >= out) throw broken("BPS", "it reads target bytes not written yet");
        // Byte by byte: the copy may overlap what it is writing, which repeats a pattern.
        for (let i = 0; i < len; i++) target[out + i] = target[targetAt++];
      }
    }
    out += len;
  }
  checkTarget(target, sums.target, "BPS");
  return target;
}
