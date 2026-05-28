/**
 * In-memory shop response cache with filesystem-driven invalidation.
 *
 * Before: every GET /shop.json or /shop.tfl re-scanned the games folder
 * with fast-glob, stat'd each file, reloaded custom_entries.jsonc, and
 * rebuilt the merged titledb output. For a multi-thousand-game library
 * that's seconds per request — and concurrent requests pile up.
 *
 * After: we build the response once at boot and then keep it warm via
 * chokidar. Any add/change/unlink under the games folder (or a change to
 * custom_entries.jsonc) invalidates the cache and schedules a debounced
 * rebuild. Concurrent requests share a single in-flight build promise,
 * so a 1k-file copy that touches the watcher a thousand times still
 * yields exactly one rebuild.
 */
import chokidar from "chokidar";
import path from "path";
import zlib from "zlib";
import crypto from "crypto";
import { promisify } from "util";
import generateIndex from "../create-index-content.js";
import * as titledbStore from "./titledb-store.js";
import { prewarmIcons, baseTitleIdOf } from "./image-cache.js";
import { romsDirPath, customEntriesPath } from "../helpers/envs.js";
import debug from "../debug.js";

const gzipAsync = promisify(zlib.gzip);

const REBUILD_DEBOUNCE_MS = 800;

let cached = null;           // raw shop object (for in-process consumers)
let serializedJson = null;   // Buffer: pre-stringified body for /shop.json
let serializedGzip = null;   // Buffer: gzipped variant for Accept-Encoding: gzip
let serializedEtag = null;   // Strong ETag — same for both encodings (semantic equivalence)
let building = null;
let lastBuildMs = 0;
let buildCount = 0;
let watcher = null;
let debounceTimer = null;

async function build() {
  if (building) return building;
  const start = Date.now();
  building = (async () => {
    try {
      const r = await generateIndex();
      cached = r;
      // Pre-serialize the body once per build so every /shop.json hit just
      // writes a Buffer to the socket — no JSON.stringify per request, no
      // per-request gzip pass. For a 5k-title library the body is ~2-10 MB
      // and stringify alone is ~10-30 ms; multiply by every Switch device
      // on the LAN and the savings stack up.
      serializedJson = Buffer.from(JSON.stringify(r));
      // Strong ETag derived from the identity bytes. Same content → same
      // ETag across the gzip variant (RFC 9110 §8.8.3 allows this when the
      // representation is semantically equivalent).
      serializedEtag = `"${crypto.createHash("sha1").update(serializedJson).digest("base64url")}"`;
      try {
        serializedGzip = await gzipAsync(serializedJson, { level: 6 });
      } catch (err) {
        // Best-effort — if gzip fails for any reason we fall back to identity.
        serializedGzip = null;
        debug.error("shop cache: gzip failed: %s", err.message);
      }
      lastBuildMs = Date.now() - start;
      buildCount += 1;
      debug.log(
        "shop cache: built in %dms (%d files, raw=%d B, gzip=%s B, build #%d)",
        lastBuildMs,
        Array.isArray(r.files) ? r.files.length : 0,
        serializedJson.length,
        serializedGzip ? serializedGzip.length : "—",
        buildCount
      );
      schedulePrewarm(r);
      return r;
    } finally {
      building = null;
    }
  })();
  return building;
}

// Kick off a background icon prefetch for every title in the current
// shop response. No-op when titledb has nothing yet (the bootstrap will
// trigger a rebuild after it loads, which re-schedules).
let prewarmInFlight = null;
function schedulePrewarm(shop) {
  if (prewarmInFlight) return;
  if (!Array.isArray(shop?.files) || shop.files.length === 0) return;
  if (titledbStore.size() === 0) return;
  const baseIds = new Set();
  for (const f of shop.files) {
    if (f.baseTitleId) baseIds.add(f.baseTitleId);
    else if (f.titleId) baseIds.add(baseTitleIdOf(f.titleId));
  }
  if (baseIds.size === 0) return;
  const getUpstream = (tid) => titledbStore.get(tid)?.iconUrl;
  prewarmInFlight = prewarmIcons(getUpstream, baseIds)
    .catch((err) => debug.error("shop cache: prewarm error %s", err.message))
    .finally(() => { prewarmInFlight = null; });
}

export async function get() {
  if (cached) return cached;
  return build();
}

/**
 * Return the pre-serialized body for /shop.json (or /shop.tfl). Selects gzip
 * when the caller advertises it; falls back to identity for everyone else
 * (Switch clients usually don't send Accept-Encoding).
 */
export async function getEncoded(acceptedEncodings) {
  if (!cached) await build();
  const wantsGzip = Array.isArray(acceptedEncodings)
    ? acceptedEncodings.includes("gzip")
    : false;
  if (wantsGzip && serializedGzip) {
    return { body: serializedGzip, contentEncoding: "gzip", etag: serializedEtag };
  }
  return { body: serializedJson, contentEncoding: null, etag: serializedEtag };
}

export function invalidate() {
  if (cached !== null) {
    debug.log("shop cache: invalidated");
    cached = null;
    serializedJson = null;
    serializedGzip = null;
    serializedEtag = null;
  }
}

function scheduleRebuild(reason) {
  invalidate();
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    debug.log("shop cache: rebuilding after %s", reason);
    build().catch((err) =>
      debug.error("shop cache: rebuild failed: %s", err.message)
    );
  }, REBUILD_DEBOUNCE_MS);
  // Don't block process exit just to debounce a rebuild.
  if (debounceTimer.unref) debounceTimer.unref();
}

export async function init() {
  // Build proactively so the first request doesn't pay the full scan cost.
  await build();

  if (watcher) {
    try { await watcher.close(); } catch {}
    watcher = null;
  }

  watcher = chokidar.watch([romsDirPath, customEntriesPath], {
    persistent: true,
    ignoreInitial: true,
    // Big files getting rsync'd: wait until they stop growing before firing.
    awaitWriteFinish: { stabilityThreshold: 800, pollInterval: 200 },
    // Ignore dotfiles by BASENAME only. Using a regex against the full path
    // catches directories whose names happen to start with a dot (the
    // watch root itself, in dev), which would silently mute every change.
    ignored: (filePath) => path.basename(filePath).startsWith("."),
  });

  watcher
    .on("add",    (p) => scheduleRebuild(`add ${path.basename(p)}`))
    .on("unlink", (p) => scheduleRebuild(`unlink ${path.basename(p)}`))
    .on("change", (p) => scheduleRebuild(`change ${path.basename(p)}`))
    .on("addDir", (p) => scheduleRebuild(`addDir ${path.basename(p)}`))
    .on("unlinkDir", (p) => scheduleRebuild(`unlinkDir ${path.basename(p)}`))
    .on("error", (err) => debug.error("shop cache: watch error: %s", err.message));

  // Don't keep the event loop alive for the watcher alone — Node should
  // exit cleanly on SIGTERM. chokidar v4 doesn't expose .unref directly,
  // but FSWatcher instances unref on close; we close in stop().
}

export async function stop() {
  if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
  if (watcher) { try { await watcher.close(); } catch {} watcher = null; }
}

export function stats() {
  return {
    cached: cached !== null,
    lastBuildMs,
    buildCount,
    files: cached?.files?.length ?? 0,
    titledbSize: cached?.titledb ? Object.keys(cached.titledb).length : 0,
  };
}
