/**
 * Lays a patch map over the bytes of a file as they stream out, for any range
 * of it: a Range request that starts or ends inside a patch gets exactly the
 * patched bytes of that range.
 */
import { Transform } from "node:stream";

/**
 * `chunk`, which starts at file offset `at`, with every patch that overlaps it
 * written in. Returns `chunk` itself when none does, else a copy. Pure.
 */
export function overlay(chunk, at, patches) {
  const end = at + chunk.length;
  let out = chunk;
  for (const p of patches) {
    const pEnd = p.offset + p.bytes.length;
    if (p.offset >= end) break; // sorted: none further on overlaps
    if (pEnd <= at) continue;
    if (out === chunk) out = Buffer.from(chunk);
    const from = Math.max(p.offset, at);
    p.bytes.copy(out, from - at, from - p.offset, Math.min(pEnd, end) - p.offset);
  }
  return out;
}

/** A stream that patches file bytes passing through it, the first of them at file offset `start`. */
export function patchStream(start, patches) {
  let at = start;
  return new Transform({
    transform(chunk, _encoding, done) {
      const out = overlay(chunk, at, patches);
      at += chunk.length;
      done(null, out);
    },
  });
}
