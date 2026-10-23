/**
 * UPS: "UPS1", the source and target sizes, then runs of a gap (bytes kept as they are) and
 * bytes XORed into the source up to a 0, then the CRC-32 of the source, the target and the patch.
 * Only the forward direction is applied: a source that is not the patch's own is refused.
 */
import { broken } from "./error.js";
import { checkSource, checkTarget, footerOf, numbers } from "./bps.js";

const HEADER = Buffer.from("UPS1");
const FOOTER = 12;

/** `source` with the UPS `patch` applied, as a new Buffer; throws when the source is not its own. Pure. */
export function applyUps(source, patch) {
  if (patch.length < HEADER.length + FOOTER || !patch.subarray(0, 4).equals(HEADER)) throw broken("UPS", "no UPS1 header");
  const sums = footerOf(patch, "UPS");
  const n = numbers(patch, 4, "UPS");
  const sourceSize = n.next();
  const targetSize = n.next();
  checkSource(source, sourceSize, sums.source, "UPS");
  const target = Buffer.alloc(targetSize);
  source.copy(target, 0, 0, Math.min(source.length, targetSize));
  const end = patch.length - FOOTER;
  let pos = 0;
  while (n.at < end) {
    pos += n.next();
    for (;;) {
      if (n.at >= end) throw broken("UPS", "a run has no end");
      const x = patch[n.at++];
      if (x === 0) break;
      if (pos >= targetSize) throw broken("UPS", "it writes past the target size");
      target[pos++] ^= x;
    }
    pos++;
  }
  checkTarget(target, sums.target, "UPS");
  return target;
}
