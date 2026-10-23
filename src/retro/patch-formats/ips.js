/**
 * IPS: "PATCH", then records of a 3-byte offset, a 2-byte size and that many bytes (a size of 0
 * is a run: 2-byte count, 1 byte value), then "EOF" and, optionally, a 3-byte size to cut the
 * result to. The format carries no checksum, so nothing says the source was the right ROM.
 */
import { broken } from "./error.js";

const HEADER = Buffer.from("PATCH");
const EOF_MARK = 0x454f46;

/** `source` with the IPS `patch` applied, as a new Buffer. Pure. */
export function applyIps(source, patch) {
  if (patch.length < 8 || !patch.subarray(0, 5).equals(HEADER)) throw broken("IPS", "no PATCH header");
  const writes = [];
  let size = source.length;
  let at = 5;
  for (;;) {
    if (at + 3 > patch.length) throw broken("IPS", "no EOF mark");
    const offset = patch.readUIntBE(at, 3);
    at += 3;
    if (offset === EOF_MARK) break;
    if (at + 2 > patch.length) throw broken("IPS", "a record is cut short");
    let len = patch.readUInt16BE(at);
    at += 2;
    let bytes;
    if (len) {
      bytes = patch.subarray(at, at + len);
      at += len;
    } else {
      if (at + 3 > patch.length) throw broken("IPS", "a run is cut short");
      len = patch.readUInt16BE(at);
      bytes = Buffer.alloc(len, patch[at + 2]);
      at += 3;
    }
    if (bytes.length !== len) throw broken("IPS", "a record is cut short");
    writes.push([offset, bytes]);
    size = Math.max(size, offset + len);
  }
  // The truncation extension: three more bytes after EOF give the size of the result.
  if (at + 3 <= patch.length) size = patch.readUIntBE(at, 3);
  const out = Buffer.alloc(Math.max(size, source.length));
  source.copy(out);
  for (const [offset, bytes] of writes) bytes.copy(out, offset);
  return out.subarray(0, size);
}
