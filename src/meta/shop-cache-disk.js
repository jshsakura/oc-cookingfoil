/**
 * Persistent on-disk format for the shop response cache.
 *
 * The shop builder pre-serializes the response body to three Buffers
 * (identity / gzip / brotli) plus a strong ETag. On orderly shutdown +
 * restart that whole state would be rebuilt from scratch — for a 5k-title
 * library that's ~500 ms of fast-glob + ~100 ms of stringify + ~200 ms
 * of compression on the critical path of the first request after a
 * container restart.
 *
 * We sidestep all of that by writing the state to disk after each build
 * and re-hydrating on boot. The on-the-wire format is a single binary
 * file with length-prefixed sections under an 8-byte magic, written
 * atomically via .tmp + rename. Bumping the magic invalidates older
 * caches on upgrade (recovery is a single fresh build — no big deal).
 */
import { readFile, writeFile, rename, mkdir } from "fs/promises";
import path from "path";

const MAGIC = Buffer.from("OC_SHOP1");
const CACHE_FILE = "shop-cache.bin";

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}

export async function write(dir, { etag, identity, gzip, brotli }) {
  await mkdir(dir, { recursive: true });
  const finalPath = path.join(dir, CACHE_FILE);
  const tmp = `${finalPath}.tmp.${process.pid}`;
  const etagBuf = Buffer.from(etag, "utf-8");
  const out = Buffer.concat([
    MAGIC,
    u32(etagBuf.length), etagBuf,
    u32(identity.length), identity,
    u32(gzip ? gzip.length : 0), gzip ?? Buffer.alloc(0),
    u32(brotli ? brotli.length : 0), brotli ?? Buffer.alloc(0),
  ]);
  await writeFile(tmp, out);
  await rename(tmp, finalPath);
  return out.length;
}

export async function read(dir) {
  const buf = await readFile(path.join(dir, CACHE_FILE));
  if (buf.length < MAGIC.length || !buf.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("bad magic — cache from older build");
  }

  let off = MAGIC.length;
  const readSlice = (n) => {
    // Copy out of the underlying buffer so the parsed pieces can outlive
    // it without pinning the whole file in memory.
    const out = Buffer.from(buf.subarray(off, off + n));
    off += n;
    return out;
  };
  const readU32 = () => {
    const v = buf.readUInt32LE(off);
    off += 4;
    return v;
  };

  const etag = readSlice(readU32()).toString("utf-8");
  const identity = readSlice(readU32());
  const gLen = readU32(); const gzip = gLen > 0 ? readSlice(gLen) : null;
  const bLen = readU32(); const brotli = bLen > 0 ? readSlice(bLen) : null;
  return { etag, identity, gzip, brotli };
}
