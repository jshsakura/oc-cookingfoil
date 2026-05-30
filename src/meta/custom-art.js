/**
 * Operator-supplied title artwork (icon / banner / screenshot) that OVERRIDES
 * both the titledb CDN proxy and NACP extraction.
 *
 * Why a separate dir + in-memory index:
 *   - The prewarm and extraction passes write into iconCacheDir; keeping
 *     overrides in their own dir means those passes can never clobber them.
 *   - The image routes need a zero-syscall "does an override exist?" check on
 *     the hot path (a 24-card grid = dozens of icon hits). The index is a
 *     plain in-memory map, seeded once at boot and updated on every put/remove.
 *
 * Layout under customArtDir:
 *   <BASE>.icon.jpg
 *   <BASE>.banner.jpg
 *   <BASE>.screen.<n>.jpg
 *
 * Uploads are re-encoded through sharp (resize cap + mozjpeg + metadata strip)
 * so we store a sane, optimized JPEG regardless of what was uploaded — and so a
 * malformed/huge image is rejected at the boundary rather than served as-is.
 */
import fs from "fs/promises";
import path from "path";
import sharp from "sharp";

import { customArtDir } from "../helpers/envs.js";
import { forget, thumbVariantPaths } from "./image-cache.js";
import debug from "../debug.js";

export const KINDS = ["icon", "banner", "screenshot"];
export const MAX_SCREENSHOTS = 8;

// Per-kind optimization. Icons render in square slots; banners/screenshots are
// wide. `inside` + no-enlargement keeps aspect and never upscales a small
// source. mozjpeg shaves ~10–15% at the same visual quality.
const ENCODE = {
  icon:       { width: 1024, height: 1024, quality: 88 },
  banner:     { width: 1280, height: 720,  quality: 85 },
  screenshot: { width: 1280, height: 720,  quality: 85 },
};

const TITLE_ID_RE = /^[0-9A-F]{16}$/;
// <BASE>.icon.jpg | <BASE>.banner.jpg | <BASE>.screen.<n>.jpg
const FILE_RE = /^([0-9A-F]{16})\.(icon|banner|screen\.(\d+))\.jpg$/;

// base -> { icon: bool, banner: bool, screens: Set<number> }
const index = new Map();

function blank() {
  return { icon: false, banner: false, screens: new Set() };
}
function entryFor(base, create = false) {
  let e = index.get(base);
  if (!e && create) {
    e = blank();
    index.set(base, e);
  }
  return e;
}

export function normalizeBase(raw) {
  if (typeof raw !== "string") return null;
  const hex = raw.toUpperCase().replace(/[^0-9A-F]/g, "");
  return TITLE_ID_RE.test(hex) ? hex : null;
}

function fileName(base, kind, idx) {
  if (kind === "screenshot") return `${base}.screen.${idx}.jpg`;
  return `${base}.${kind}.jpg`;
}

export function pathFor(base, kind, idx) {
  return path.join(customArtDir, fileName(base, kind, idx));
}

/** Hot-path check: is there an override on disk for this slot? (Set lookup.) */
export function hasOverride(base, kind, idx) {
  const e = index.get(base);
  if (!e) return false;
  if (kind === "icon") return e.icon;
  if (kind === "banner") return e.banner;
  if (kind === "screenshot") return e.screens.has(Number(idx));
  return false;
}

/** What custom art exists for a title — used by the dashboard + the response. */
export function list(base) {
  const e = index.get(base);
  if (!e) return { icon: false, banner: false, screens: [] };
  return {
    icon: e.icon,
    banner: e.banner,
    screens: [...e.screens].sort((a, b) => a - b),
  };
}

function setSlot(base, kind, idx, present) {
  const e = entryFor(base, present);
  if (!e) return;
  if (kind === "icon") e.icon = present;
  else if (kind === "banner") e.banner = present;
  else if (kind === "screenshot") {
    if (present) e.screens.add(Number(idx));
    else e.screens.delete(Number(idx));
  }
  if (!e.icon && !e.banner && e.screens.size === 0) index.delete(base);
}

/** Lowest free screenshot index, or null when the cap is reached. */
export function nextScreenshotIdx(base) {
  const e = index.get(base);
  const used = e ? e.screens : new Set();
  for (let i = 0; i < MAX_SCREENSHOTS; i++) {
    if (!used.has(i)) return i;
  }
  return null;
}

/** Seed the index from disk. Safe to call once at boot. */
export async function init() {
  try {
    await fs.mkdir(customArtDir, { recursive: true });
  } catch (err) {
    debug.error("custom-art: mkdir failed: %s", err.message);
  }
  let entries;
  try {
    entries = await fs.readdir(customArtDir);
  } catch {
    return;
  }
  index.clear();
  let n = 0;
  for (const name of entries) {
    const m = FILE_RE.exec(name);
    if (!m) continue; // ignores thumb variants + anything unexpected
    const base = m[1];
    if (m[2] === "icon") setSlot(base, "icon", null, true);
    else if (m[2] === "banner") setSlot(base, "banner", null, true);
    else setSlot(base, "screenshot", Number(m[3]), true);
    n++;
  }
  debug.log("custom-art: indexed %d override(s)", n);
}

async function optimize(kind, inputBuffer) {
  const cfg = ENCODE[kind] ?? ENCODE.icon;
  // `failOn: "error"` rejects truncated/garbage uploads instead of producing a
  // half image. rotate() bakes EXIF orientation before we strip metadata.
  return sharp(inputBuffer, { failOn: "error" })
    .rotate()
    .resize(cfg.width, cfg.height, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: cfg.quality, mozjpeg: true })
    .toBuffer();
}

/**
 * Validate + optimize + store an uploaded image for a slot. Throws on a bad
 * image (caller maps to 400). Invalidates the cache's memoized state for the
 * file and its thumbnails so the next request reflects the new bytes.
 */
export async function put(base, kind, idx, inputBuffer) {
  const optimized = await optimize(kind, inputBuffer);
  await fs.mkdir(customArtDir, { recursive: true });
  const dest = pathFor(base, kind, idx);
  const tmp = `${dest}.tmp.${process.pid}`;
  await fs.writeFile(tmp, optimized);
  await fs.rename(tmp, dest);
  setSlot(base, kind, idx, true);
  // Drop the stale original + thumbnails from the cache's existence memo.
  forget(dest);
  for (const v of thumbVariantPaths(dest)) {
    forget(v);
    fs.rm(v, { force: true }).catch(() => {});
  }
  debug.log("custom-art: stored %s (%d bytes)", path.basename(dest), optimized.length);
  return { path: dest, bytes: optimized.length };
}

/** Remove a slot's override (and its thumbnails). No-op when absent. */
export async function remove(base, kind, idx) {
  const dest = pathFor(base, kind, idx);
  await fs.rm(dest, { force: true });
  forget(dest);
  for (const v of thumbVariantPaths(dest)) {
    forget(v);
    await fs.rm(v, { force: true }).catch(() => {});
  }
  setSlot(base, kind, idx, false);
  debug.log("custom-art: removed %s", path.basename(dest));
}
