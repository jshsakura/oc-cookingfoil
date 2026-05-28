/**
 * On-disk image cache + lazy upstream fetcher.
 *
 * Used by the /api/shop/icon, /banner, /screenshot routes. The Switch
 * client (Tinfoil/CyberFoil) requests these on demand; we serve the
 * locally-cached file when present, and otherwise pull once from
 * Nintendo's eShop CDN (via the URL we got from titledb) and write
 * the bytes to disk so every subsequent request is fast.
 *
 * Concurrent requests for the same image share a single in-flight
 * fetch promise — a packed Switch home screen hitting 30 covers at
 * once produces at most 30 upstream fetches, not 30 × N.
 */
import fs from "fs";
import path from "path";
import { mkdir, rename, writeFile } from "fs/promises";
import debug from "../debug.js";
import { iconCacheDir } from "../helpers/envs.js";

const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64"
);

const inFlight = new Map();

export function placeholder(res) {
  res.set("Cache-Control", "no-store");
  res.type("image/png").status(200).send(TRANSPARENT_PNG);
}

/** Where the cached image lives on disk, keyed by titleId + kind (+ idx). */
export function cachePathFor(titleId, kind, idx) {
  switch (kind) {
    case "icon":       return path.join(iconCacheDir, `${titleId}.jpg`);
    case "banner":     return path.join(iconCacheDir, `${titleId}.banner.jpg`);
    case "screenshot": return path.join(iconCacheDir, `${titleId}.screen.${idx}.jpg`);
    default:           throw new Error(`unknown image kind: ${kind}`);
  }
}

async function fetchAndStore(url, cachePath) {
  const start = Date.now();
  const upstream = await fetch(url, { redirect: "follow" });
  if (!upstream.ok) {
    throw new Error(`upstream HTTP ${upstream.status}`);
  }
  const buf = Buffer.from(await upstream.arrayBuffer());
  await mkdir(path.dirname(cachePath), { recursive: true });
  const tmp = `${cachePath}.tmp.${process.pid}`;
  await writeFile(tmp, buf);
  await rename(tmp, cachePath);
  debug.log(
    "image cache: stored %s (%d bytes, %dms)",
    path.basename(cachePath),
    buf.length,
    Date.now() - start
  );
  return {
    buf,
    contentType: upstream.headers.get("content-type") ?? "image/jpeg",
  };
}

/**
 * Serve a cached image, fetching once on miss.
 *   - `cachePath`: where to find/store it on disk
 *   - `upstreamUrl`: where to fetch it from (titledb-supplied)
 *
 * If the cache hits, sendFile (no buffering — fastest path).
 * If the cache misses and there's no upstream URL → 1×1 placeholder.
 */
export async function serveImage(res, { cachePath, upstreamUrl }) {
  // Strong long-lived cache for HTTP clients too — these images don't change
  // for a given titleId.
  res.set("Cache-Control", "public, max-age=86400, immutable");

  if (fs.existsSync(cachePath)) {
    res.type("image/jpeg");
    return res.sendFile(cachePath);
  }
  if (!upstreamUrl) {
    return placeholder(res);
  }

  let pending = inFlight.get(cachePath);
  if (!pending) {
    pending = fetchAndStore(upstreamUrl, cachePath).finally(() =>
      inFlight.delete(cachePath)
    );
    inFlight.set(cachePath, pending);
  }

  try {
    const { buf, contentType } = await pending;
    res.type(contentType);
    return res.send(buf);
  } catch (err) {
    debug.error("image cache: fetch %s failed: %s", upstreamUrl, err.message);
    return placeholder(res);
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
