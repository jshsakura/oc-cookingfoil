/**
 * In-memory shop response cache with filesystem-driven invalidation and a
 * persistent on-disk warm-restart layer.
 *
 * Before: every GET /shop.json or /shop.tfl re-scanned the games folder
 * with fast-glob, stat'd each file, reloaded custom_entries.jsonc, and
 * rebuilt the merged titledb output. For a multi-thousand-game library
 * that's seconds per request — and concurrent requests pile up.
 *
 * After:
 *   - The response body is built once and pre-serialized to identity /
 *     gzip / brotli Buffers + a strong ETag. Every request becomes a
 *     header check and a Buffer write.
 *   - The whole state (Buffers + ETag) is persisted to disk after each
 *     build, so a container restart can hydrate from disk and serve
 *     /shop.json on the FIRST request before any rebuild happens. The
 *     fresh rebuild then runs in the background and atomically replaces
 *     the warm-loaded snapshot.
 *   - chokidar drives invalidation: any add/change/unlink under the games
 *     folder (or a change to custom_entries.jsonc) schedules a debounced
 *     rebuild. The old cache stays serveable until the new one is ready —
 *     no stale-window where /shop.json blocks behind a fresh scan.
 *   - Concurrent requests share a single in-flight build promise, so a
 *     1k-file copy that touches the watcher a thousand times still yields
 *     exactly one rebuild.
 */
import chokidar from "chokidar";
import path from "path";
import zlib from "zlib";
import crypto from "crypto";
import { promisify } from "util";
import {
  scanLibrary,
  composeResponse,
  readOneFile,
  loadCustoms,
  isGameFile,
} from "../create-index-content.js";
import * as titledbStore from "./titledb-store.js";
import { prewarmIcons, baseTitleIdOf } from "./image-cache.js";
import * as diskCache from "./shop-cache-disk.js";
import { romsDirPath, customEntriesPath, dataDir } from "../helpers/envs.js";
import debug from "../debug.js";

const gzipAsync = promisify(zlib.gzip);
const brotliAsync = promisify(zlib.brotliCompress);

const REBUILD_DEBOUNCE_MS = 800;
// Sweet spot for multi-MB JSON: similar size to gzip-6, similar wall-clock
// when run in parallel with gzip on libuv's thread pool. Levels >= 6 are
// slower than the debounce window for very large libraries.
const BROTLI_QUALITY = 4;

const SHOP_CACHE_DIR = path.join(dataDir, "shop-cache");

let cached = null;           // raw shop object (for in-process consumers)
let serializedJson = null;   // Buffer: pre-stringified body for /shop.json
let serializedGzip = null;   // Buffer: gzip variant for Accept-Encoding: gzip
let serializedBrotli = null; // Buffer: brotli variant for Accept-Encoding: br
let serializedEtag = null;   // Strong ETag — shared across all encodings
let building = null;
let lastBuildMs = 0;
let buildCount = 0;
let watcher = null;
let debounceTimer = null;

// ── Incremental rebuild state ───────────────────────────────────────────
// `filesMap` and `customs` are the primitive library state. composeResponse()
// rebuilds the output from these — cheap (~10–30 ms even for 5k entries).
// chokidar events queue into pendingFileDeltas / pendingCustomsReload and
// the next build pass applies them. The cold/first build does a full scan
// and seeds filesMap.
let filesMap = null;                        // Map<relPath, fileItem> | null
let customs = [];                           // last loaded custom_entries
const pendingFileDeltas = new Map();        // relPath -> "upsert" | "remove"
let pendingCustomsReload = false;
let needsFullRescan = false;                // dir-level event fallback

async function applyPendingDeltas() {
  let upserts = 0, removes = 0;
  for (const [relPath, op] of pendingFileDeltas) {
    if (op === "remove") {
      if (filesMap.delete(relPath)) removes++;
      continue;
    }
    // upsert: re-stat + re-parse. If the file disappeared between the
    // chokidar event and us, treat as removal.
    const item = await readOneFile(relPath);
    if (item) {
      filesMap.set(relPath, item);
      upserts++;
    } else if (filesMap.delete(relPath)) {
      removes++;
    }
  }
  pendingFileDeltas.clear();
  return { upserts, removes };
}

async function build() {
  if (building) return building;
  const start = Date.now();
  building = (async () => {
    try {
      // Pick the cheapest valid path to fresh state.
      let mode;
      if (!filesMap || needsFullRescan) {
        const r = await scanLibrary();
        filesMap = r.filesMap;
        customs = r.customs;
        // Any queued deltas were just absorbed by the full scan.
        pendingFileDeltas.clear();
        pendingCustomsReload = false;
        needsFullRescan = false;
        mode = filesMap.size === 0 && customs.length === 0 ? "full-empty" : "full";
      } else {
        const delta = await applyPendingDeltas();
        if (pendingCustomsReload) {
          customs = await loadCustoms();
          pendingCustomsReload = false;
        }
        mode = `incremental(+${delta.upserts}/-${delta.removes})`;
      }

      const r = composeResponse(filesMap, customs);
      const json = Buffer.from(JSON.stringify(r));
      const etag = `"${crypto.createHash("sha1").update(json).digest("base64url")}"`;
      // gzip + brotli run in parallel on libuv's thread pool. Brotli at
      // quality 4 finishes in the same ballpark as gzip-6 (~50–150 ms on
      // a 5–10 MB body), so total wall-clock is dominated by the slower
      // of the two — not their sum.
      const [gzipBuf, brBuf] = await Promise.all([
        gzipAsync(json, { level: 6 }).catch((err) => {
          debug.error("shop cache: gzip failed: %s", err.message);
          return null;
        }),
        brotliAsync(json, {
          params: { [zlib.constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY },
        }).catch((err) => {
          debug.error("shop cache: brotli failed: %s", err.message);
          return null;
        }),
      ]);

      // Atomic replacement: consumers reading `cached` / `serializedJson`
      // during the build above kept seeing the previous snapshot; now they
      // see the new one without any null window.
      cached = r;
      serializedJson = json;
      serializedGzip = gzipBuf;
      serializedBrotli = brBuf;
      serializedEtag = etag;

      lastBuildMs = Date.now() - start;
      buildCount += 1;
      debug.log(
        "shop cache: built in %dms [%s] (%d files, raw=%d B, gzip=%s B, br=%s B, build #%d)",
        lastBuildMs,
        mode,
        Array.isArray(r.files) ? r.files.length : 0,
        json.length,
        gzipBuf ? gzipBuf.length : "—",
        brBuf ? brBuf.length : "—",
        buildCount
      );

      // Persist asynchronously — consumers already have the new state.
      // Failures don't affect this process; they just mean the next boot
      // pays full build cost instead of warm-starting.
      diskCache
        .write(SHOP_CACHE_DIR, { etag, identity: json, gzip: gzipBuf, brotli: brBuf })
        .then((n) => debug.log("shop cache: persisted to disk (%d B)", n))
        .catch((err) => debug.error("shop cache: disk persist failed: %s", err.message));

      // Prewarm icons in a separate tick so it doesn't extend the build's
      // critical-path measurement and so the consumer's `await build()`
      // resolves the moment the response Buffers are ready.
      setImmediate(() => schedulePrewarm(r));
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
 * Return the pre-serialized body for /shop.json (or /shop.tfl). Picks the
 * smallest variant the caller advertised — br > gzip > identity — and
 * falls back to identity when the client advertises none or when the
 * matching variant failed to encode at build time.
 */
export async function getEncoded(acceptedEncodings) {
  if (!cached) await build();
  const enc = Array.isArray(acceptedEncodings) ? acceptedEncodings : [];
  if (enc.includes("br") && serializedBrotli) {
    return { body: serializedBrotli, contentEncoding: "br", etag: serializedEtag };
  }
  if (enc.includes("gzip") && serializedGzip) {
    return { body: serializedGzip, contentEncoding: "gzip", etag: serializedEtag };
  }
  return { body: serializedJson, contentEncoding: null, etag: serializedEtag };
}

/**
 * Mark the cache as stale and schedule a debounced rebuild — WITHOUT
 * clearing the current snapshot. Consumers keep getting the previous
 * response until the new one is ready, then see it atomically replaced.
 * This is what makes warm restart and titledb-late-load paths smooth:
 * no request ever has to wait through a fresh scan just because something
 * changed in the background.
 */
export function invalidate() {
  scheduleRebuild("invalidate");
}

function scheduleRebuild(reason) {
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

// Map a raw chokidar file event to the right pending bucket.
//   - custom_entries.jsonc       → just reload customs (no per-file delta).
//   - game file (.nsp/.nsz/...)  → enqueue upsert/remove for that path only.
//   - anything else              → ignore (silently drop dotfile siblings etc.).
function routeFileEvent(op, absPath) {
  if (path.resolve(absPath) === path.resolve(customEntriesPath)) {
    pendingCustomsReload = true;
    scheduleRebuild(`custom_entries ${op}`);
    return;
  }
  if (!isGameFile(absPath)) return;
  const rel = path.relative(romsDirPath, absPath);
  // Coalesce same-path events in the debounce window — multiple rapid
  // writes to one file should only produce one stat+parse pass. The
  // last-write-wins op is fine because "upsert" already covers both
  // newly added files and content changes.
  pendingFileDeltas.set(rel, op);
  scheduleRebuild(`${op} ${path.basename(absPath)}`);
}

async function tryHydrateFromDisk() {
  try {
    const r = await diskCache.read(SHOP_CACHE_DIR);
    // Parse the identity body so in-process consumers (the prewarmer, the
    // landing dashboard's stats API, future admin endpoints) can read
    // `cached.files` without us having to re-stringify.
    const parsed = JSON.parse(r.identity.toString("utf-8"));
    cached = parsed;
    serializedJson = r.identity;
    serializedGzip = r.gzip;
    serializedBrotli = r.brotli;
    serializedEtag = r.etag;
    debug.log(
      "shop cache: hydrated from disk (%d files, raw=%d B, gzip=%s B, br=%s B)",
      Array.isArray(parsed.files) ? parsed.files.length : 0,
      r.identity.length,
      r.gzip ? r.gzip.length : "—",
      r.brotli ? r.brotli.length : "—"
    );
    return true;
  } catch (err) {
    debug.log("shop cache: no disk cache (%s)", err.code || err.message);
    return false;
  }
}

export async function init() {
  // Warm-start path: if the previous run persisted state to disk, hydrate
  // it now so the first /shop.json request after restart is served from
  // the snapshot — no fast-glob, no compression, no JSON.stringify. The
  // rebuild that catches up to any changes happens behind the scenes.
  const warm = await tryHydrateFromDisk();
  if (warm) {
    // Schedule a refresh in the background. The watcher's events will
    // catch concrete file changes; this guarantees we eventually publish
    // a snapshot reflecting current titledb + library state even if no
    // file changed (e.g. user just restarted the container).
    scheduleRebuild("warm restart");
  } else {
    await build();
  }

  if (watcher) {
    try { await watcher.close(); } catch {}
    watcher = null;
  }

  watcher = chokidar.watch([romsDirPath, customEntriesPath], {
    persistent: true,
    ignoreInitial: true,
    // Big files getting rsync'd: wait until they stop growing before firing.
    // 400 ms stability with 100 ms polling cuts the typical post-add latency
    // roughly in half versus the earlier 800/200 — still safely above the
    // tail of an rsync block flush.
    awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
    // Ignore dotfiles by BASENAME only. Using a regex against the full path
    // catches directories whose names happen to start with a dot (the
    // watch root itself, in dev), which would silently mute every change.
    ignored: (filePath) => path.basename(filePath).startsWith("."),
  });

  watcher
    .on("add",       (p) => routeFileEvent("upsert", p))
    .on("change",    (p) => routeFileEvent("upsert", p))
    .on("unlink",    (p) => routeFileEvent("remove", p))
    .on("addDir",    (p) => { needsFullRescan = true; scheduleRebuild(`addDir ${path.basename(p)}`); })
    .on("unlinkDir", (p) => { needsFullRescan = true; scheduleRebuild(`unlinkDir ${path.basename(p)}`); })
    .on("error",     (err) => debug.error("shop cache: watch error: %s", err.message));

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
    bytes: {
      identity: serializedJson?.length ?? 0,
      gzip: serializedGzip?.length ?? 0,
      brotli: serializedBrotli?.length ?? 0,
    },
  };
}
