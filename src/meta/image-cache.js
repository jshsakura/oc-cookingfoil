/**
 * On-disk image cache + lazy upstream fetcher + on-the-fly thumbnail/WebP
 * variant pipeline.
 *
 * Variants live next to the original:
 *   <titleId>.jpg             ← upstream JPEG (eShop CDN)
 *   <titleId>.banner.jpg
 *   <titleId>.screen.<n>.jpg
 *   <titleId>.sm.jpg|webp     ← 160×160 cover (?size=sm, client list cards)
 *   <titleId>.thumb.jpg|webp  ← 256×256 cover (?size=md)
 *   <titleId>.md.jpg|webp     ← 512×512 cover (?size=lg|xl, browser cards)
 *   <…>.xl-wide.jpg|webp      ← banners and screenshots at screen width, 1280 (?size=xl)
 *
 * WebP variants are written as .q75.webp: quality 75 at the slowest effort, about
 * 35-40% under the JPEG. The full-screen xl is .q50.webp: at 1280 px quality 50
 * looks the same as 75 and weighs a quarter less (a screenshot 95 KB as JPEG,
 * 57 KB at 75, 42 KB at 50). The CookingFoil client decodes WebP and asks for
 * it with `Accept: image/webp`.
 *
 * The client app's sizes (sm and md, as JPEG) are drawn ahead of time by
 * prewarmIcons, so a list never waits for a resize.
 *
 * Console clients (Tinfoil/CyberFoil) request the original — no Accept:
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
import { iconCacheDir, eshopArtwork } from "../helpers/envs.js";
import { dlcBaseTitleId } from "./filename-parser.js";
import * as activity from "../tasks/activity.js";

// libvips operation cache lives in C-land — bumping it pays for itself the
// first time a hot icon's WebP variant is regenerated, since the source
// JPEG's decode state stays warm. Defaults are 50 MB / 100 file slots.
sharp.cache({ memory: 256, files: 200 });

const THUMB_PX = 256;
// ?size= → longest edge in px. Icons are square and cropped to it; banners and
// screenshots keep their aspect ratio and are scaled to that width.
const SIZES = { sm: 160, md: THUMB_PX, lg: 512, xl: 512 };
// File suffix per size. md and lg keep the names their 256- and 512-px files
// had before sm existed, so variants already on disk stay valid.
const SUFFIXES = { sm: "sm", md: "thumb", lg: "md", xl: "md" };
// Banners and screenshots keep the widths they always had: sm 256, md and lg 512;
// xl is the console's screen width, for a full-screen gallery or hero.
const WIDE_SIZES = { sm: THUMB_PX, md: 512, lg: 512, xl: 1280 };
const WIDE_SUFFIXES = { sm: "thumb-wide", md: "md-wide", lg: "md-wide", xl: "xl-wide" };
const WEBP_EXT = "q75.webp";
const WEBP_OPTIONS = { quality: 75, effort: 6 };
const XL_WEBP_EXT = "q50.webp";
const XL_WEBP_OPTIONS = { quality: 50, effort: 6 };
const JPEG_QUALITY = 80;
export const IMMUTABLE = "public, max-age=31536000, immutable";
export const UNVERSIONED = "public, max-age=300";
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
  // 404 — NOT a 200 with a 1×1 transparent PNG. Tinfoil and other
  // embedded clients cache responses by URL: a 200 + valid PNG looks
  // like a successful icon and gets memoized indefinitely, so a later
  // NACP extraction filling in the real icon never reaches the screen.
  // A 404 signals "not yet available" semantically, lets the client
  // render its own generic placeholder, and clears the way for retries
  // once the extractor lands the real bytes.
  //
  // For the browser dashboard we still want a graceful fallback: the
  // landing template wires `cover.onerror → visibility:hidden`, so 404
  // collapses to an empty card slot without a broken-image glyph.
  res.set("Cache-Control", "no-store");
  res.status(404).type("text/plain").send("icon not available");
}

export function cachePathFor(titleId, kind, idx) {
  switch (kind) {
    case "icon":       return path.join(iconCacheDir, `${titleId}.jpg`);
    case "banner":     return path.join(iconCacheDir, `${titleId}.banner.jpg`);
    case "screenshot": return path.join(iconCacheDir, `${titleId}.screen.${idx}.jpg`);
    // A language's own art (idx is the language): from that region's eShop, or the game file's icon_<Language>.dat
    case "icon-lang":   return path.join(iconCacheDir, `${titleId}.icon.${idx}.jpg`);
    case "banner-lang": return path.join(iconCacheDir, `${titleId}.banner.${idx}.jpg`);
    default:           throw new Error(`unknown image kind: ${kind}`);
  }
}

/** Build a variant filename next to the original: foo.jpg → foo.thumb.webp. */
function variantPath(originalPath, suffix, ext) {
  const dir = path.dirname(originalPath);
  const base = path.basename(originalPath).replace(/\.[^.]+$/, "");
  return path.join(dir, `${base}.${suffix}.${ext}`);
}

/** The thumbnail variant paths derived from an original — used by callers
 *  (e.g. custom-art) that need to invalidate them when the original changes. */
export function thumbVariantPaths(originalPath) {
  const suffixes = new Set([...Object.values(SUFFIXES), ...Object.values(WIDE_SUFFIXES)]);
  return [...suffixes].flatMap((s) => [variantPath(originalPath, s, "jpg"), variantPath(originalPath, s, "webp"), variantPath(originalPath, s, WEBP_EXT), variantPath(originalPath, s, XL_WEBP_EXT)]);
}

/** Forget any memoized existence / in-flight state for a path. Call after
 *  writing or deleting a file behind the cache's back (custom-art mutations)
 *  so the next request re-checks the filesystem instead of trusting a stale
 *  positive from `knownExists`. */
export function forget(filePath) {
  knownExists.delete(filePath);
  inFlightFetch.delete(filePath);
  inFlightVariant.delete(filePath);
}

async function fetchAndStore(url, cachePath) {
  // COOK_ESHOP_ARTWORK=false: nothing is fetched from the eShop CDN.
  if (!eshopArtwork) throw new Error("eShop artwork fetching is off");
  const start = Date.now();
  const upstream = await fetch(url, { redirect: "follow" });
  if (!upstream.ok) throw new Error(`upstream HTTP ${upstream.status}`);
  const buf = Buffer.from(await upstream.arrayBuffer());
  await mkdir(path.dirname(cachePath), { recursive: true });
  const tmp = `${cachePath}.tmp.${process.pid}`;
  await writeFile(tmp, buf);
  await rename(tmp, cachePath);
  knownExists.add(cachePath);
  // Per-icon I/O is high-frequency during the prewarm pass — log to the
  // `cache` namespace so the default DEBUG pattern doesn't flood the user.
  debug.cache(
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
      if (variant.resize && variant.wide) {
        pipeline = pipeline.resize({ width: variant.resize, withoutEnlargement: true });
      } else if (variant.resize) {
        pipeline = pipeline.resize(variant.resize, variant.resize, { fit: "cover", position: "center" });
      }
      if (variant.format === "webp")  pipeline = pipeline.webp(variant.webp ?? WEBP_OPTIONS);
      else if (variant.format === "jpeg") pipeline = pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true });
      const t0 = Date.now();
      await pipeline.toFile(tmp);
      await rename(tmp, variant.path);
      knownExists.add(variant.path);
      const sz = (await statAsync(variant.path)).size;
      debug.cache("image cache: variant %s (%d bytes, %dms)", path.basename(variant.path), sz, Date.now() - t0);
    })().finally(() => inFlightVariant.delete(key));
    inFlightVariant.set(key, pending);
  }
  await pending;
  return variant.path;
}

function acceptsWebp(req) {
  // Console clients (Tinfoil/CyberFoil) don't send `image/webp`; modern
  // browsers include it in the Accept header. We only check the explicit
  // mime — relying on a bare `*/*` to mean "supports webp" produces
  // false positives for legacy HTTP clients.
  const a = req.get("accept") || "";
  return a.includes("image/webp");
}

function variantSuffix(size, wide) {
  return wide ? WIDE_SUFFIXES[size] : SUFFIXES[size];
}

/**
 * Serve a cached image. `?size=sm` (160 px), `?size=md` (256 px) and
 * `?size=lg|xl` (512 px) return a smaller square icon; banners and screenshots
 * (`wide`) come at 256, 512, 512 and 1280 px wide; the default returns the original. `wide` keeps the aspect
 * ratio (banners, screenshots) instead of cropping to a square (icons). When
 * the client says `Accept: image/webp` we serve WebP for a variant; otherwise JPEG.
 */
export async function serveImage(req, res, { cachePath, upstreamUrl, overridePath, wide = false, current = false }) {
  const size = Object.hasOwn(SIZES, req.query?.size) ? req.query.size : null;
  const wantThumb = size !== null;
  const wantWebp = wantThumb && acceptsWebp(req); // we only transcode the thumb

  // Operator-supplied art wins outright over the titledb CDN proxy / NACP
  // cache. When present we serve it (and derive thumbs from it) and never
  // touch the upstream. `existsCached` keeps the common no-override path a
  // pure Set lookup after the first hit.
  let source = cachePath;
  let fromOverride = false;
  if (overridePath && existsCached(overridePath)) {
    source = overridePath;
    fromOverride = true;
  } else {
    try {
      await ensureOriginal(cachePath, upstreamUrl);
    } catch (err) {
      debug.cache("image cache: original miss for %s — %s", path.basename(cachePath), err.message);
      return placeholder(res);
    }
  }

  // `current`: the request's ?v= is the slot's content version
  // (artwork-version.js), so these bytes never change under this URL and may
  // be kept for a year. Without it (no v, an old one) the picture can still be
  // replaced: a short cache, revalidated by the ETag sendFile sets. Art the
  // admin uploads is edited from the dashboard, so it revalidates sooner.
  res.set(
    "Cache-Control",
    current
      ? IMMUTABLE
      : fromOverride
        ? "public, max-age=60, must-revalidate"
        : UNVERSIONED
  );

  if (!wantThumb) {
    res.type("image/jpeg");
    return res.sendFile(source);
  }

  try {
    const suffix = variantSuffix(size, wide);
    const px = (wide ? WIDE_SIZES : SIZES)[size];
    const variant = wantWebp
      ? size === "xl"
        ? { path: variantPath(source, suffix, XL_WEBP_EXT), resize: px, wide, format: "webp", webp: XL_WEBP_OPTIONS }
        : { path: variantPath(source, suffix, WEBP_EXT), resize: px, wide, format: "webp" }
      : { path: variantPath(source, suffix, "jpg"), resize: px, wide, format: "jpeg" };
    await ensureVariant(source, variant);
    res.set("Vary", "Accept");
    res.type(wantWebp ? "image/webp" : "image/jpeg");
    return res.sendFile(variant.path);
  } catch (err) {
    debug.error("image cache: variant failed for %s: %s", source, err.message);
    // Worst case: send the original full-size, still works.
    res.type("image/jpeg");
    return res.sendFile(source);
  }
}

/** Updates/DLC share the base game's icon — fold the suffix to 000. */
export function baseTitleIdOf(titleId) {
  if (!titleId || titleId.length !== 16) return titleId;
  const sfx = titleId.slice(-3).toLowerCase();
  if (sfx === "000") return titleId;
  if (sfx === "800") return titleId.slice(0, -3) + "000";
  return /^[0-9A-Fa-f]{16}$/.test(titleId) ? dlcBaseTitleId(titleId) : titleId;
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
  // The job appears with the first icon that needs work: most passes find every one cached.
  let job = null;
  async function worker() {
    while (cursor < queue.length) {
      const tid = queue[cursor++];
      job?.step(cursor);
      const cp = cachePathFor(tid, "icon");
      // Client app cards (sm and md) as JPEG for older clients and WebP for the CookingFoil client and browsers.
      const variants = [
        { path: variantPath(cp, SUFFIXES.sm, "jpg"), resize: SIZES.sm, format: "jpeg" },
        { path: variantPath(cp, SUFFIXES.md, "jpg"), resize: SIZES.md, format: "jpeg" },
        { path: variantPath(cp, SUFFIXES.sm, WEBP_EXT), resize: SIZES.sm, format: "webp" },
        { path: variantPath(cp, SUFFIXES.md, WEBP_EXT), resize: SIZES.md, format: "webp" },
      ];
      const haveOriginal = existsCached(cp);
      const missing = variants.filter((v) => !existsCached(v.path));
      if (haveOriginal && !missing.length) { skipped++; continue; }

      const url = getUpstreamForBase(tid);
      if (!url && !haveOriginal) { skipped++; continue; }
      job ??= activity.begin("prewarm", { title: "게임 아이콘을 미리 받습니다", total: queue.length });

      try {
        if (!haveOriginal) {
          await ensureOriginal(cp, url);
          done++;
        }
        // Eagerly transcode the thumbnails too, so the first paint of a
        // list never waits for sharp.
        // Sharp's internal threadpool handles CPU parallelism, so the only
        // backpressure we apply is at the network-fetch level.
        for (const v of missing) {
          await ensureVariant(cp, v);
          thumbs++;
        }
      } catch {
        failed++;
      }
    }
  }
  const t0 = Date.now();
  try {
    await Promise.all(Array(concurrency).fill(0).map(worker));
  } catch (err) {
    job?.fail(err);
    throw err;
  }
  // Icons whose address is gone fail on every pass: a pass that made nothing new leaves no trace.
  if (done + thumbs) job?.done(`새로 ${done}개${failed ? ` · 실패 ${failed}개` : ""}`);
  else job?.discard();
  debug.log(
    "image cache: prewarm done — %d new, %d thumbs, %d skipped, %d failed (%dms)",
    done, thumbs, skipped, failed, Date.now() - t0
  );
  return { done, skipped, failed, thumbs };
}
