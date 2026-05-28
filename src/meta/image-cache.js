/**
 * On-disk image cache + lazy upstream fetcher + on-the-fly thumbnail/WebP
 * variant pipeline.
 *
 * Variants live next to the original:
 *   <titleId>.jpg             ← upstream JPEG (Nintendo eShop CDN)
 *   <titleId>.banner.jpg
 *   <titleId>.screen.<n>.jpg
 *   <titleId>.thumb.jpg       ← 256×256 cover (mozjpeg q85)
 *   <titleId>.thumb.webp      ← 256×256 cover (webp q80)
 *
 * Switch clients (Tinfoil/CyberFoil) request the original — no Accept:
 * image/webp header from them, so they always get JPEG.
 * Browsers requesting `?size=sm` with `Accept: image/webp` get the WebP
 * thumbnail (~70% smaller than the original JPEG); JPEG falls through
 * for the rest.
 */
import fs from "fs";
import path from "path";
import { mkdir, rename, writeFile, stat as statAsync } from "fs/promises";
import sharp from "sharp";
import debug from "../debug.js";
import { iconCacheDir } from "../helpers/envs.js";

// libvips operation cache lives in C-land — bumping it pays for itself the
// first time a hot icon's WebP variant is regenerated, since the source
// JPEG's decode state stays warm. Defaults are 50 MB / 100 file slots.
sharp.cache({ memory: 256, files: 200 });

const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64"
);

const THUMB_PX = 256;
const inFlightFetch = new Map();   // upstream-fetch coalescing
const inFlightVariant = new Map(); // variant-generation coalescing

// Once we've confirmed a file is on disk, skip the syscall on subsequent
// requests. A grid of 24 cards triggers 24+ image hits; on a warm cache
// every one of those was paying for an `fs.existsSync` round-trip per
// request. Membership-only set — entries are never removed during the
// process lifetime (we never delete from the cache at runtime), so the
// only stale shape is "user deleted the file behind our back", which is
// not a supported live mutation.
const knownExists = new Set();

function existsCached(p) {
  if (knownExists.has(p)) return true;
  if (fs.existsSync(p)) {
    knownExists.add(p);
    return true;
  }
  return false;
}

export function placeholder(res) {
  res.set("Cache-Control", "no-store");
  res.type("image/png").status(200).send(TRANSPARENT_PNG);
}

export function cachePathFor(titleId, kind, idx) {
  switch (kind) {
    case "icon":       return path.join(iconCacheDir, `${titleId}.jpg`);
    case "banner":     return path.join(iconCacheDir, `${titleId}.banner.jpg`);
    case "screenshot": return path.join(iconCacheDir, `${titleId}.screen.${idx}.jpg`);
    default:           throw new Error(`unknown image kind: ${kind}`);
  }
}

/** Build a variant filename next to the original: foo.jpg → foo.thumb.webp. */
function variantPath(originalPath, suffix, ext) {
  const dir = path.dirname(originalPath);
  const base = path.basename(originalPath).replace(/\.[^.]+$/, "");
  return path.join(dir, `${base}.${suffix}.${ext}`);
}

async function fetchAndStore(url, cachePath) {
  const start = Date.now();
  const upstream = await fetch(url, { redirect: "follow" });
  if (!upstream.ok) throw new Error(`upstream HTTP ${upstream.status}`);
  const buf = Buffer.from(await upstream.arrayBuffer());
  await mkdir(path.dirname(cachePath), { recursive: true });
  const tmp = `${cachePath}.tmp.${process.pid}`;
  await writeFile(tmp, buf);
  await rename(tmp, cachePath);
  knownExists.add(cachePath);
  debug.log(
    "image cache: stored %s (%d bytes, %dms)",
    path.basename(cachePath), buf.length, Date.now() - start
  );
  return { buf, contentType: upstream.headers.get("content-type") ?? "image/jpeg" };
}

async function ensureOriginal(cachePath, upstreamUrl) {
  if (existsCached(cachePath)) return;
  if (!upstreamUrl) throw new Error("no upstream URL and no cache");
  let pending = inFlightFetch.get(cachePath);
  if (!pending) {
    pending = fetchAndStore(upstreamUrl, cachePath).finally(() => inFlightFetch.delete(cachePath));
    inFlightFetch.set(cachePath, pending);
  }
  await pending;
}

async function ensureVariant(originalPath, variant) {
  if (existsCached(variant.path)) return variant.path;
  const key = variant.path;
  let pending = inFlightVariant.get(key);
  if (!pending) {
    pending = (async () => {
      const tmp = `${variant.path}.tmp.${process.pid}`;
      let pipeline = sharp(originalPath, { failOn: "none" });
      if (variant.resize) {
        pipeline = pipeline.resize(variant.resize, variant.resize, { fit: "cover", position: "center" });
      }
      if (variant.format === "webp")  pipeline = pipeline.webp({ quality: 80, effort: 4 });
      else if (variant.format === "jpeg") pipeline = pipeline.jpeg({ quality: 85, mozjpeg: true });
      const t0 = Date.now();
      await pipeline.toFile(tmp);
      await rename(tmp, variant.path);
      knownExists.add(variant.path);
      const sz = (await statAsync(variant.path)).size;
      debug.log("image cache: variant %s (%d bytes, %dms)", path.basename(variant.path), sz, Date.now() - t0);
    })().finally(() => inFlightVariant.delete(key));
    inFlightVariant.set(key, pending);
  }
  await pending;
  return variant.path;
}

function acceptsWebp(req) {
  // Switch clients (Tinfoil/CyberFoil) don't send `image/webp`; modern
  // browsers include it in the Accept header. We only check the explicit
  // mime — relying on a bare `*/*` to mean "supports webp" produces
  // false positives for legacy HTTP clients.
  const a = req.get("accept") || "";
  return a.includes("image/webp");
}

/**
 * Serve a cached image. `?size=sm` returns a 256-px thumb; the default
 * returns the original. When the client says `Accept: image/webp` we
 * serve WebP for any variant we have; otherwise JPEG.
 */
export async function serveImage(req, res, { cachePath, upstreamUrl }) {
  res.set("Cache-Control", "public, max-age=86400, immutable");

  const wantThumb = req.query?.size === "sm";
  const wantWebp = wantThumb && acceptsWebp(req); // we only transcode the thumb

  try {
    await ensureOriginal(cachePath, upstreamUrl);
  } catch (err) {
    debug.log("image cache: original miss for %s — %s", path.basename(cachePath), err.message);
    return placeholder(res);
  }

  if (!wantThumb) {
    res.type("image/jpeg");
    return res.sendFile(cachePath);
  }

  try {
    const variant = wantWebp
      ? { path: variantPath(cachePath, "thumb", "webp"), resize: THUMB_PX, format: "webp" }
      : { path: variantPath(cachePath, "thumb", "jpg"),  resize: THUMB_PX, format: "jpeg" };
    await ensureVariant(cachePath, variant);
    res.set("Vary", "Accept");
    res.type(wantWebp ? "image/webp" : "image/jpeg");
    return res.sendFile(variant.path);
  } catch (err) {
    debug.error("image cache: variant failed for %s: %s", cachePath, err.message);
    // Worst case: send the original full-size, still works.
    res.type("image/jpeg");
    return res.sendFile(cachePath);
  }
}

/** Updates/DLC share the base game's icon — fold the suffix to 000. */
export function baseTitleIdOf(titleId) {
  if (!titleId || titleId.length !== 16) return titleId;
  const sfx = titleId.slice(-3).toLowerCase();
  if (sfx === "000") return titleId;
  return titleId.slice(0, -3) + "000";
}

export function normalizeTitleId(raw) {
  if (typeof raw !== "string") return null;
  const hex = raw.toUpperCase().replace(/[^0-9A-F]/g, "");
  return hex.length === 16 ? hex : null;
}

/**
 * Background prefetch of icons for the title IDs the user actually has
 * in their library. Only fetches the ORIGINAL JPEG — variant transcoding
 * is still on-demand (cheaper to defer than pre-generate both WebP+JPEG
 * sizes for thousands of titles).
 *
 * Concurrency capped so we don't hammer the eShop CDN; we also skip any
 * file already on disk so reruns are no-ops.
 */
export async function prewarmIcons(getUpstreamForBase, baseIds, { concurrency = 8 } = {}) {
  const queue = Array.from(new Set(baseIds)).filter((tid) => tid && tid.length === 16);
  if (queue.length === 0) return { done: 0, skipped: 0, failed: 0, thumbs: 0 };
  let done = 0, skipped = 0, failed = 0, thumbs = 0;
  // Cursor instead of `.shift()` (O(n) per pop on an Array). For a 5k-title
  // library that's 25M array-element moves over the prewarm pass.
  let cursor = 0;
  async function worker() {
    while (cursor < queue.length) {
      const tid = queue[cursor++];
      const cp = cachePathFor(tid, "icon");
      const webpThumb = variantPath(cp, "thumb", "webp");
      const haveOriginal = existsCached(cp);
      const haveThumb = existsCached(webpThumb);
      if (haveOriginal && haveThumb) { skipped++; continue; }

      const url = getUpstreamForBase(tid);
      if (!url && !haveOriginal) { skipped++; continue; }

      try {
        if (!haveOriginal) {
          await ensureOriginal(cp, url);
          done++;
        }
        // Eagerly transcode the WebP thumbnail too. Browsers hitting the
        // grid request `?size=sm` with Accept: image/webp — having the
        // variant on disk means the first paint never waits for sharp.
        // Sharp's internal threadpool handles CPU parallelism, so the only
        // backpressure we apply is at the network-fetch level.
        if (!haveThumb) {
          await ensureVariant(cp, { path: webpThumb, resize: THUMB_PX, format: "webp" });
          thumbs++;
        }
      } catch {
        failed++;
      }
    }
  }
  const t0 = Date.now();
  await Promise.all(Array(concurrency).fill(0).map(worker));
  debug.log(
    "image cache: prewarm done — %d new, %d thumbs, %d skipped, %d failed (%dms)",
    done, thumbs, skipped, failed, Date.now() - t0
  );
  return { done, skipped, failed, thumbs };
}
