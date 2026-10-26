/**
 * On-disk image cache + on-the-fly WebP variant pipeline.
 *
 * The originals come from the game files only (nacp-extractor.js), in data/icons/:
 *   <titleId>.jpg             ← the game file's icon
 *   <titleId>.icon.<lang>.jpg ← its icon for one language, where it differs
 *   <titleId>.banner.jpg      ← drawn from the icon (icon-banner.js)
 * Nothing is fetched from a store; a picture not on disk is a 404.
 *
 * What is sent is always WebP, drawn from them into data/thumbs/icons/ (a
 * cache: never backed up, made again on demand):
 *   <titleId>.sm.q75.webp       ← 160×160 cover (?size=sm, client list cards)
 *   <titleId>.thumb.q75.webp    ← 256×256 cover (?size=md)
 *   <titleId>.md.q75.webp       ← 512×512 cover (?size=lg|xl, browser cards)
 *   <…>.xl-wide.q50.webp        ← banners and screenshots at screen width, 1280 (?size=xl)
 *   <…>.full.q75.webp           ← the picture at its own size (no ?size=)
 *
 * Quality 75 at the slowest effort, about 35-40% under the JPEG. The
 * full-screen xl is quality 50: at 1280 px it looks the same as 75 and weighs a
 * quarter less (a screenshot 95 KB as JPEG, 57 KB at 75, 42 KB at 50). The
 * console client links libwebp and every browser decodes WebP, so the bytes do
 * not depend on Accept and nothing varies on it.
 *
 * An older server wrote JPEG and WebP variants next to the originals;
 * removeOldVariants() clears those at start by their exact names.
 *
 * The client app's sizes (sm and md) are drawn ahead of time by prewarmIcons,
 * so a list never waits for a resize.
 *
 * Art kept in a game's folder (meta/game-meta.js) is WebP already, and its
 * variants are drawn elsewhere (`overrideThumbs`, under thumbs/games/), named
 * after the picture's stamp: nothing is ever written into the admin's folders,
 * and a new picture gets new variants without a stat.
 */
import fs from "fs";
import path from "path";
import { mkdir, readdir, readFile, rename, rm, writeFile, stat as statAsync } from "fs/promises";
import sharp from "sharp";
import debug from "../debug.js";
import { iconCacheDir } from "../helpers/envs.js";
import { dlcBaseTitleId } from "./filename-parser.js";
import * as activity from "../tasks/activity.js";
import { activityText } from "./meta-messages.js";

// libvips operation cache lives in C-land — bumping it pays for itself the
// first time a hot icon's WebP variant is regenerated, since the source
// JPEG's decode state stays warm. Defaults are 50 MB / 100 file slots.
// No files kept open by path: a picture replaced by hand under the same name would be read stale (meta/art-sidecar.js).
sharp.cache({ memory: 256, files: 0 });

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
// No ?size=: the picture at its own size.
const FULL_SUFFIX = "full";
export const IMMUTABLE = "public, max-age=31536000, immutable";
export const UNVERSIONED = "public, max-age=300";
const inFlightVariant = new Map(); // variant-generation coalescing
// Encodes at once: a burst (a library opened on several consoles after a deploy) would
// otherwise fill libuv's thread pool and hold up file reads and downloads behind it.
export const MAX_ENCODES = 4;
let encoding = 0;
const waitingEncodes = [];

async function encodeSlot(fn) {
  if (encoding >= MAX_ENCODES) await new Promise((resolve) => waitingEncodes.push(resolve));
  encoding++;
  try {
    return await fn();
  } finally {
    encoding--;
    waitingEncodes.shift()?.();
  }
}

// Once we've confirmed a file is on disk, skip the syscall on subsequent
// requests. A grid of 24 cards triggers 24+ image hits; on a warm cache
// every one of those was paying for an `fs.existsSync` round-trip per
// request. Membership-only set — entries are never removed during the
// process lifetime (we never delete from the cache at runtime), so the
// only stale shape is "user deleted the file behind our back", which is
// not a supported live mutation.
const knownExists = new Set();

// What is in data/icons, read once at start: a request asks it for every game's
// icon, the many not read yet included, and never stats the disk for it. Only
// this server writes there, and each write goes through forget().
const readIconDir = () => {
  try {
    return fs.readdirSync(iconCacheDir);
  } catch {
    return [];
  }
};
const iconIndex = new Set(readIconDir());
const inIconDir = (p) => typeof p === "string" && path.dirname(p) === iconCacheDir;

function existsCached(p) {
  if (inIconDir(p)) return iconIndex.has(path.basename(p));
  if (knownExists.has(p)) return true;
  if (fs.existsSync(p)) {
    knownExists.add(p);
    return true;
  }
  return false;
}

/** Whether a cached original is on disk: from memory for data/icons, else remembered once seen. */
export const hasCached = (p) => existsCached(p);

export function placeholder(res) {
  // 404, NOT a 200 with a 1×1 transparent PNG. The console client
  // caches pictures by URL: a 200 + valid PNG looks
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
    // A language's own art (idx is the language): the game file's icon_<Language>.dat
    case "icon-lang":   return path.join(iconCacheDir, `${titleId}.icon.${idx}.jpg`);
    case "banner-lang": return path.join(iconCacheDir, `${titleId}.banner.${idx}.jpg`);
    default:           throw new Error(`unknown image kind: ${kind}`);
  }
}

/** A variant's filename beside `at`: foo.jpg → foo.thumb.q75.webp. */
function variantPath(at, suffix, ext) {
  const dir = path.dirname(at);
  const base = path.basename(at).replace(/\.[^.]+$/, "");
  return path.join(dir, `${base}.${suffix}.${ext}`);
}

/** Where a cached original's variants are named from: data/icons/X.jpg → data/thumbs/icons/X.jpg. */
function thumbBaseOf(source) {
  const dir = path.dirname(source);
  return path.join(path.dirname(dir), "thumbs", path.basename(dir), path.basename(source));
}

/** The names an older server gave the variants it wrote next to an original. */
const OLD_SUFFIXES = [...new Set([...Object.values(SUFFIXES), ...Object.values(WIDE_SUFFIXES)])];
const OLD_EXTS = ["jpg", "webp", WEBP_EXT, XL_WEBP_EXT];

/** Those old variant paths of one original: custom-art's move out of custom-art/ removes them with it. */
export function thumbVariantPaths(originalPath) {
  return OLD_SUFFIXES.flatMap((s) => OLD_EXTS.map((ext) => variantPath(originalPath, s, ext)));
}

// <titleId>[.banner|.screen.<n>|.icon.<lang>|.banner.<lang>].<old suffix>.<old ext>: exactly what
// variantPath made next to a cachePathFor original, and nothing an original is ever called.
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const OLD_VARIANT_RE = new RegExp(
  `^[0-9A-F]{16}(?:\\.banner|\\.screen\\.\\d+|\\.icon\\.[a-z]{2}|\\.banner\\.[a-z]{2})?` +
  `\\.(?:${OLD_SUFFIXES.map(escape).join("|")})\\.(?:${OLD_EXTS.map(escape).join("|")})$`,
);

/**
 * Removes the variants an older server wrote next to the originals in `dir`
 * (JPEG and WebP, matched by their exact names); the originals stay. Returns
 * how many went. Run at start: once they are gone a pass finds nothing.
 */
export async function removeOldVariants(dir = iconCacheDir) {
  let names;
  try {
    names = await readdir(dir);
  } catch (err) {
    if (err.code === "ENOENT") return 0;
    throw err;
  }
  let removed = 0;
  for (const name of names) {
    if (!OLD_VARIANT_RE.test(name)) continue;
    await rm(path.join(dir, name), { force: true });
    knownExists.delete(path.join(dir, name));
    removed++;
  }
  if (removed) debug.log("image cache: removed %d old variants next to the originals", removed);
  return removed;
}

/**
 * Forgets and removes the WebP variants of a cached original rewritten under
 * the same name (a game file's icon read again), so the next request draws
 * them from the new bytes.
 */
export function dropVariants(cachePath) {
  forget(cachePath);
  const at = thumbBaseOf(cachePath);
  for (const suffix of [...OLD_SUFFIXES, FULL_SUFFIX]) {
    for (const ext of [WEBP_EXT, XL_WEBP_EXT]) {
      const file = variantPath(at, suffix, ext);
      forget(file);
      fs.rmSync(file, { force: true });
    }
  }
}

/** Forget any memoized existence / in-flight state for a path. Call after
 *  writing or deleting a file behind the cache's back (custom-art mutations)
 *  so the next request re-checks the filesystem instead of trusting a stale
 *  positive from `knownExists`. */
export function forget(filePath) {
  if (inIconDir(filePath)) {
    if (fs.existsSync(filePath)) iconIndex.add(path.basename(filePath));
    else iconIndex.delete(path.basename(filePath));
  }
  knownExists.delete(filePath);
  inFlightVariant.delete(filePath);
}

async function ensureVariant(originalPath, variant) {
  if (existsCached(variant.path)) return variant.path;
  const key = variant.path;
  let pending = inFlightVariant.get(key);
  if (!pending) {
    pending = encodeSlot(async () => {
      const tmp = `${variant.path}.tmp.${process.pid}`;
      await mkdir(path.dirname(variant.path), { recursive: true });
      // Read as bytes: an uploaded picture is rewritten under the same name, and libvips would
      // answer a path it decoded before from its cache.
      let pipeline = sharp(await readFile(originalPath), { failOn: "none" });
      if (variant.resize && variant.wide) {
        pipeline = pipeline.resize({ width: variant.resize, withoutEnlargement: true });
      } else if (variant.resize) {
        pipeline = pipeline.resize(variant.resize, variant.resize, { fit: "cover", position: "center" });
      }
      pipeline = pipeline.webp(variant.webp ?? WEBP_OPTIONS);
      const t0 = Date.now();
      await pipeline.toFile(tmp);
      await rename(tmp, variant.path);
      knownExists.add(variant.path);
      const sz = (await statAsync(variant.path)).size;
      debug.cache("image cache: variant %s (%d bytes, %dms)", path.basename(variant.path), sz, Date.now() - t0);
    }).finally(() => inFlightVariant.delete(key));
    inFlightVariant.set(key, pending);
  }
  await pending;
  return variant.path;
}

function variantSuffix(size, wide) {
  return wide ? WIDE_SUFFIXES[size] : SUFFIXES[size];
}

/**
 * Serve a cached image, always as WebP. `?size=sm` (160 px), `?size=md` (256 px)
 * and `?size=lg|xl` (512 px) return a smaller square icon; banners and
 * screenshots (`wide`) come at 256, 512, 512 and 1280 px wide, keeping their
 * aspect ratio instead of being cropped to a square. Without a size the picture
 * comes at its own size. `overrideThumbs` (custom-art.serveOptions) is where an
 * override's variants go (a WebP override without a size is sent as it is);
 * `overrideGone` is called when the override is no longer there.
 */
export async function serveImage(req, res, opts) {
  const { cachePath, overridePath, overrideThumbs, overrideGone, wide = false, current = false } = opts;
  const size = Object.hasOwn(SIZES, req.query?.size) ? req.query.size : null;

  // Operator-supplied art wins outright over the game file's. When present
  // we serve it (and derive thumbs from it). It sits in a folder the admin may rename or delete by
  // hand, yet it is sent without a look first (a request reads no more of the
  // disk than what it sends): one found gone, at the send or the resize, falls
  // back to the usual art and `overrideGone` has the game read again.
  const fromOverride = Boolean(overridePath);
  const source = overridePath || cachePath;
  const gone = () => {
    forget(overridePath);
    overrideGone?.();
    return serveImage(req, res, { ...opts, overridePath: null });
  };
  const send = (file) => (fromOverride ? sendOr(res, file, gone) : res.sendFile(file));
  if (!fromOverride && !existsCached(cachePath)) return placeholder(res);

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

  const sourceIsWebp = source.endsWith(".webp");
  if (size === null && sourceIsWebp) {
    res.type("image/webp");
    return send(source);
  }

  try {
    const thumbs = fromOverride && overrideThumbs;
    const at = thumbs || thumbBaseOf(source);
    const variant = size === null
      ? { path: variantPath(at, FULL_SUFFIX, WEBP_EXT), resize: null, wide }
      : size === "xl"
        ? { path: variantPath(at, variantSuffix(size, wide), XL_WEBP_EXT), resize: (wide ? WIDE_SIZES : SIZES)[size], wide, webp: XL_WEBP_OPTIONS }
        : { path: variantPath(at, variantSuffix(size, wide), WEBP_EXT), resize: (wide ? WIDE_SIZES : SIZES)[size], wide };
    await ensureVariant(source, variant);
    res.type("image/webp");
    if (!fromOverride) return res.sendFile(variant.path);
    // A small copy found gone (thumbs/ pruned or cleared by hand) is made again, once; the
    // picture itself counts as gone only when that fails too.
    return sendOr(res, variant.path, opts.thumbAgain ? gone : () => serveImage(req, res, { ...opts, thumbAgain: true }));
  } catch (err) {
    if (fromOverride && err.code === "ENOENT") return gone();
    debug.error("image cache: variant failed for %s: %s", source, err.message);
    // Worst case: a picture sharp cannot read goes out as it is, still better than nothing.
    res.type(sourceIsWebp ? "image/webp" : "image/jpeg");
    return send(source);
  }
}

/** res.sendFile(file), and `gone()` in its place when the file is not there; nothing was sent then. */
function sendOr(res, file, gone) {
  res.sendFile(file, (err) => {
    if (!err || res.headersSent) return;
    if (err.code === "ENOENT" || err.code === "ENOTDIR") {
      forget(file);
      Promise.resolve().then(gone).catch((e) => debug.error("image cache: %s", e.message));
      return;
    }
    // What express does without a callback: the error's own status.
    debug.cache("image cache: sending %s: %s", path.basename(file), err.message);
    res.status(err.status ?? err.statusCode ?? 500).end();
  });
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
 * Draws ahead of time the two WebP card sizes the client app asks for first,
 * for every icon of the library already on disk. Other sizes are drawn on
 * demand; icons drawn before are skipped, so reruns are no-ops.
 */
export async function prewarmIcons(baseIds, { concurrency = 8 } = {}) {
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
      if (job?.stopped) break;
      const tid = queue[cursor++];
      job?.step(cursor);
      const cp = cachePathFor(tid, "icon");
      // The client app's cards (sm and md).
      const at = thumbBaseOf(cp);
      const variants = [
        { path: variantPath(at, SUFFIXES.sm, WEBP_EXT), resize: SIZES.sm },
        { path: variantPath(at, SUFFIXES.md, WEBP_EXT), resize: SIZES.md },
      ];
      const missing = existsCached(cp) ? variants.filter((v) => !existsCached(v.path)) : [];
      if (!missing.length) { skipped++; continue; }
      job ??= activity.begin("prewarm", { title: activityText("act.prewarm"), total: queue.length });

      try {
        // So the first paint of a list never waits for sharp.
        for (const v of missing) {
          await ensureVariant(cp, v);
          thumbs++;
        }
        done++;
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
  // A pass that made nothing new leaves no trace.
  if (done + thumbs) job?.done(activityText(failed ? "act.prewarmFailed" : "act.prewarmDone", { n: done, failed }));
  else job?.discard();
  debug.log(
    "image cache: prewarm done — %d new, %d thumbs, %d skipped, %d failed (%dms)",
    done, thumbs, skipped, failed, Date.now() - t0
  );
  return { done, skipped, failed, thumbs };
}
