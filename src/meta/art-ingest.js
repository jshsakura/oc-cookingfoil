/**
 * The one place a picture from outside becomes a picture the server keeps.
 *
 *   shrink(input, spec)        bytes in, the kept bytes out: upright, inside spec's size, never enlarged, no metadata
 *   writeAtomic(file, buf)     a file appears whole or not at all
 *   ingest({ input, spec, dest })    shrink, then write: { path, bytes, version }
 *   fetchImage(url, { fetchImpl, maxBytes })   the bytes at an address, at most maxBytes
 *   versionOf(buf)             12 hex characters of what the bytes are: a URL key that changes when the picture does
 *
 * What comes in is never kept. A picture that cannot be read, is over the pixel or byte limit, or has no
 * size to shrink to is refused (IngestError) and nothing is written: there is no "keep the original
 * because shrinking failed". The admin's own upload editor keeps a shrunk copy for cutting again
 * (art-crop.js); that is its own feature of the admin's pictures and goes through shrink() too.
 *
 * Pictures that are drawn from ones already kept (the banner drawn from an icon, square art, the sized
 * copies image-cache serves, a forwarder's icon) are renderings, not ingest, and live in their own modules.
 * test/unit/sharp-importers.test.js lists who may import sharp and why.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

export const MAX_INPUT_PIXELS = 50e6;
export const MAX_INPUT_BYTES = 32 * 1024 * 1024;

export class IngestError extends Error {
  constructor(code, detail = "") {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "IngestError";
    this.code = code;
  }
}

/** The kept pictures of a game folder: WebP, inside the kind's size, upright. */
export const ART = Object.freeze({
  icon: Object.freeze({ format: "webp", width: 1024, height: 1024, quality: 88, effort: 4, failOn: "error" }),
  banner: Object.freeze({ format: "webp", width: 1280, height: 720, quality: 85, effort: 4, failOn: "error" }),
  screenshot: Object.freeze({ format: "webp", width: 1280, height: 720, quality: 85, effort: 4, failOn: "error" }),
});

/** The icon read from a game file: JPEG no larger than the 256 px NACP makes them at. */
export const NACP_ICON = Object.freeze({ format: "jpeg", width: 256, height: 256, quality: 85, mozjpeg: true, failOn: "none", rotate: false });

/** A picture next to a game's files (the metadata folder), at most w by h. */
export const sidecarSpec = (width, height) => ({ format: "webp", width, height, quality: 80, effort: 5, failOn: "none" });

/** Box art of a retro game: a paletted PNG inside width by height. */
export const coverSpec = (width, height) => ({ format: "png", width, height, palette: true, quality: 90, effort: 10, compressionLevel: 9, failOn: "none" });

/** `input` may also be a file path or a Buffer; pictures from outside are held to maxBytes (ingest, fetchImage), pictures the admin placed are not. */
export async function shrink(input, spec) {
  if (!Buffer.isBuffer(input) && !(input instanceof Uint8Array) && typeof input !== "string") throw new IngestError("not-bytes");
  if (typeof input !== "string" && input.length === 0) throw new IngestError("empty");
  if (!(spec?.width > 0) || !(spec?.height > 0)) throw new IngestError("no-size");
  try {
    let pipeline = sharp(input, { failOn: spec.failOn ?? "error", limitInputPixels: MAX_INPUT_PIXELS });
    if (spec.rotate !== false) pipeline = pipeline.rotate();
    pipeline = pipeline.resize({ width: spec.width, height: spec.height, fit: spec.fit ?? "inside", withoutEnlargement: true });
    if (spec.format === "webp") pipeline = pipeline.webp({ quality: spec.quality, effort: spec.effort });
    else if (spec.format === "jpeg") pipeline = pipeline.jpeg({ quality: spec.quality, mozjpeg: spec.mozjpeg === true });
    else if (spec.format === "png") pipeline = pipeline.png({ palette: spec.palette === true, quality: spec.quality, effort: spec.effort, compressionLevel: spec.compressionLevel });
    else throw new IngestError("bad-format", String(spec.format));
    return await pipeline.toBuffer();
  } catch (err) {
    if (err instanceof IngestError) throw err;
    throw new IngestError("unreadable", err.message);
  }
}

export function writeAtomic(file, buf) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // A dot name, so one left behind by a crash is never taken for a picture.
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, file);
}

export const versionOf = (buf) => crypto.createHash("sha256").update(buf).digest("hex").slice(0, 12);

export async function ingest({ input, spec, dest, maxBytes = MAX_INPUT_BYTES }) {
  if (input?.length > maxBytes) throw new IngestError("too-big");
  const out = await shrink(input, spec);
  writeAtomic(dest, out);
  return { path: dest, bytes: out.length, version: versionOf(out) };
}

/** The bytes at `url`, read as they come and dropped once they pass maxBytes. The caller picks fetchImpl (a plugin's ctx.fetch checks its hosts). */
export async function fetchImage(url, { fetchImpl = fetch, maxBytes = MAX_INPUT_BYTES, signal } = {}) {
  const res = await fetchImpl(url, { signal, redirect: "follow" });
  if (!res.ok) throw new IngestError("http", String(res.status));
  const declared = Number(res.headers.get("content-length"));
  if (declared > maxBytes) throw new IngestError("too-big");
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > maxBytes) throw new IngestError("too-big");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
