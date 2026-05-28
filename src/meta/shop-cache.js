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
import generateIndex from "../create-index-content.js";
import { romsDirPath, customEntriesPath } from "../helpers/envs.js";
import debug from "../debug.js";

const REBUILD_DEBOUNCE_MS = 800;

let cached = null;
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
      lastBuildMs = Date.now() - start;
      buildCount += 1;
      debug.log(
        "shop cache: built in %dms (%d files, build #%d)",
        lastBuildMs,
        Array.isArray(r.files) ? r.files.length : 0,
        buildCount
      );
      return r;
    } finally {
      building = null;
    }
  })();
  return building;
}

export async function get() {
  if (cached) return cached;
  return build();
}

export function invalidate() {
  if (cached !== null) {
    debug.log("shop cache: invalidated");
    cached = null;
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
