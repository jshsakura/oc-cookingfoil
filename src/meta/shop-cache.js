/**
 * In-memory shop response cache with filesystem-driven invalidation and a
 * persistent on-disk warm-restart layer.
 *
 * Before: every catalog request re-scanned the games folder
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
 *     /games.json on the FIRST request before any rebuild happens. The
 *     fresh rebuild then runs in the background and atomically replaces
 *     the warm-loaded snapshot.
 *   - chokidar drives invalidation: any add/change/unlink under the games
 *     folder (or a change to custom_entries.jsonc) schedules a debounced
 *     rebuild. The old cache stays serveable until the new one is ready —
 *     no stale-window where /games.json blocks behind a fresh scan.
 *   - Concurrent requests share a single in-flight build promise, so a
 *     1k-file copy that touches the watcher a thousand times still yields
 *     exactly one rebuild.
 */
import chokidar from "chokidar";
import path from "path";
import zlib from "zlib";
import crypto from "crypto";
import { emitPluginEvent } from "../plugins/emit.js";
import { promisify } from "util";
import {
  scanLibrary,
  composeResponse,
  composeSections,
  readOneFile,
  rebuildFileItem,
  loadCustoms,
  isGameFile,
} from "../create-index-content.js";
import * as titledbStore from "./titledb-store.js";
import { prewarmIcons, baseTitleIdOf } from "./image-cache.js";
import * as contentMeta from "./content-meta.js";
import * as featured from "./featured.js";
import * as diskCache from "./shop-cache-disk.js";
import * as nacpExtractor from "./nacp-extractor.js";
import { romsDirPath, customEntriesPath, dataDir } from "../helpers/envs.js";
import { rewriteArtworkOrigin, rewriteDownloadOrigin } from "../helpers/origin.js";
import * as downloadLinks from "../security/download-links.js";
import debug from "../debug.js";
import * as activity from "../tasks/activity.js";
import { isIncoming } from "./library-organize.js";
import { activityText } from "./meta-messages.js";

const gzipAsync = promisify(zlib.gzip);
const brotliAsync = promisify(zlib.brotliCompress);

const REBUILD_DEBOUNCE_MS = 800;
// Background news (a name read from a file, a price, a check verdict) comes in bursts: one rebuild
// and one write of the kept copy per this long at most. A change someone made still goes at once.
const BACKGROUND_COOLDOWN_MS = 15_000;
let lastBuiltAt = 0;
// Sweet spot for multi-MB JSON: similar size to gzip-6, similar wall-clock
// when run in parallel with gzip on libuv's thread pool. Levels >= 6 are
// slower than the debounce window for very large libraries.
const BROTLI_QUALITY = 4;

const SHOP_CACHE_DIR = path.join(dataDir, "shop-cache");

// Per-origin re-encode cache. The base buffers below hold host-relative
// artwork URLs; serving the console client needs ABSOLUTE ones (see helpers/origin.js).
// We derive an absolute-URL variant per distinct request origin and memoize
// its identity/gzip/brotli/etag, so the expensive compression only runs once
// per origin instead of per request. Realistic deployments see 1–2 origins;
// the cap only guards against a flood of spoofed Host headers. Lists on the
// direct address (security/download-links.js) are one more variant per origin,
// kept apart (DIRECT_MEMO_MAX) so they never push the plain ones out. Cleared on every
// rebuild so variants never outlive the base snapshot they derive from.
const ORIGIN_MEMO_MAX = 16;
const DIRECT_MEMO_MAX = 16;
const newMemo = () => ({ plain: new Map(), direct: new Map() }); // key -> { identity, gzip, brotli, etag }
const originMemo = newMemo();

// Sections view (/api/library/sections), built lazily from the
// same filesMap and memoized per origin exactly like the shop response.
// Invalidated on every rebuild (alongside originMemo) so it never serves a
// stale catalog.
let sectionsIdentity = null; // Buffer: relative-URL sections JSON
let sectionsNoOriginVariant = null; // compressed relative variant (falsy origin)
const sectionsOriginMemo = newMemo();

function clearMemo(memo) {
  memo.plain.clear();
  memo.direct.clear();
}

/** The memoized variant for `origin` and `link`, made by `make()` the first time. */
async function memoized(memo, origin, link, make) {
  const map = link ? memo.direct : memo.plain;
  const key = memoKey(origin, link);
  let variant = map.get(key);
  if (!variant) {
    variant = await make();
    map.set(key, variant);
    if (map.size > (link ? DIRECT_MEMO_MAX : ORIGIN_MEMO_MAX)) map.delete(map.keys().next().value);
  }
  return variant;
}

let cached = null;           // raw shop object (for in-process consumers)
let serializedJson = null;   // Buffer: pre-stringified body for /games.json
let serializedGzip = null;   // Buffer: gzip variant for Accept-Encoding: gzip
let serializedBrotli = null; // Buffer: brotli variant for Accept-Encoding: br
let serializedEtag = null;   // Strong ETag — shared across all encodings
let building = null;
let lastBuildMs = 0;
let lastMode = null;
let lastFullScan = null; // { at, ms, files } of the last read of the whole games folder
let buildCount = 0;
let watcher = null;
let debounceTimer = null;
let debounceDueAt = 0;

// ── Build-event subscribers ─────────────────────────────────────────────
// The realtime ws layer wants to push a "shop-updated" message every time
// the response changes. We expose a tiny pub/sub instead of pulling in
// EventEmitter, so the cache stays a leaf module with no node:events tax.
const subscribers = new Set();

export function onUpdate(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

const CHANGED_LIST_MAX = 100;

/** libraryChanged for plugins: which game files appeared or went since the last build (not on the first one). */
function tellLibraryChanged(before, now) {
  const added = [];
  let addedCount = 0;
  for (const rel of now.keys()) {
    if (before.has(rel)) continue;
    addedCount++;
    if (added.length < CHANGED_LIST_MAX) added.push(rel);
  }
  const removed = [];
  let removedCount = 0;
  for (const rel of before) {
    if (now.has(rel)) continue;
    removedCount++;
    if (removed.length < CHANGED_LIST_MAX) removed.push(rel);
  }
  if (addedCount || removedCount) emitPluginEvent("libraryChanged", { added, removed, addedCount, removedCount });
}

function notify(payload) {
  for (const fn of subscribers) {
    try { fn(payload); } catch (err) {
      debug.error("shop cache: subscriber threw: %s", err.message);
    }
  }
}

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
let needsRename = false;                    // names changed, files did not: rebuild items in memory

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
  let scanJob = null;
  building = (async () => {
    try {
      // Pick the cheapest valid path to fresh state.
      let mode;
      const listedBefore = filesMap ? new Set(filesMap.keys()) : null;
      if (!filesMap || needsFullRescan) {
        // Only a full read shows up as a job: the incremental passes run on every file change.
        scanJob = activity.begin("scan:games", { title: activityText("act.scanGames") });
        // Cleared before the read: a rescan asked while it runs builds again afterwards.
        needsFullRescan = false;
        needsRename = false;
        const r = await scanLibrary();
        filesMap = r.filesMap;
        customs = r.customs;
        // Any queued deltas were just absorbed by the full scan.
        pendingFileDeltas.clear();
        pendingCustomsReload = false;
        mode = filesMap.size === 0 && customs.length === 0 ? "full-empty" : "full";
      } else {
        const delta = await applyPendingDeltas();
        if (pendingCustomsReload) {
          customs = await loadCustoms();
          pendingCustomsReload = false;
        }
        mode = `incremental(+${delta.upserts}/-${delta.removes})`;
        if (needsRename) {
          // The path, size and mtime are already held, so new names need no trip to the disk.
          needsRename = false;
          for (const [relPath, item] of filesMap) filesMap.set(relPath, rebuildFileItem(relPath, item));
          mode += "+rename";
        }
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
      // Drop per-origin variants — they were derived from the now-replaced
      // base buffers and would serve stale artwork URLs / etags otherwise.
      clearMemo(originMemo);
      // Same for the sections view — rebuilt lazily on the next request.
      sectionsIdentity = null;
      sectionsNoOriginVariant = null;
      clearMemo(sectionsOriginMemo);

      lastBuildMs = Date.now() - start;
      buildCount += 1;
      lastBuiltAt = Date.now();
      lastMode = mode;
      if (mode.startsWith("full")) lastFullScan = { at: lastBuiltAt, ms: lastBuildMs, files: filesMap.size };
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
      scanJob?.done(activityText("act.files", { n: filesMap.size }));
      scanJob = null;

      // Push to ws subscribers so dashboards open across the network see
      // library changes within ~debounce + ~build_ms instead of having to
      // refresh manually.
      if (listedBefore) tellLibraryChanged(listedBefore, filesMap);
      notify({
        etag,
        files: filesMap.size,
        customs: customs.length,
        bytes: { identity: json.length, gzip: gzipBuf?.length ?? 0, brotli: brBuf?.length ?? 0 },
        mode,
        buildMs: lastBuildMs,
      });

      return r;
    } catch (err) {
      scanJob?.fail(err);
      scanJob = null;
      throw err;
    } finally {
      building = null;
      // Asked for while this build ran (a rescan, new names, file events): build() handed those
      // callers this build, which may have read the folder before their change, so build again.
      if (needsFullRescan || needsRename || pendingFileDeltas.size || pendingCustomsReload) scheduleRebuild("changes during the last build");
    }
  })();
  return building;
}

// Draw the card sizes of every icon in the current shop response ahead of time.
let prewarmInFlight = null;
function schedulePrewarm(shop) {
  if (prewarmInFlight) return;
  if (!Array.isArray(shop?.files) || shop.files.length === 0) return;
  const baseIds = new Set();
  for (const f of shop.files) {
    if (f.baseTitleId) baseIds.add(f.baseTitleId);
    else if (f.titleId) baseIds.add(baseTitleIdOf(f.titleId));
  }
  if (baseIds.size === 0) return;
  prewarmInFlight = prewarmIcons(baseIds)
    .catch((err) => debug.error("shop cache: prewarm error %s", err.message))
    .finally(() => { prewarmInFlight = null; });
}

export async function get() {
  if (cached) return cached;
  return build();
}

/**
 * Every scanned game file: { rel, name, size, kind, titleId, baseTitleId, version, mtime } ([] before
 * the first build); `name` is the display name, `version` the file's version or null, mtime in epoch seconds or null.
 */
export function files() {
  if (!filesMap) return [];
  return [...filesMap].map(([rel, i]) => ({ rel, name: i.name, size: i.size, kind: i.kind ?? null, titleId: i.titleId ?? null, baseTitleId: i.baseTitleId ?? null, version: i.version ?? null, mtime: i.mtime ?? null }));
}

/**
 * Files this process changed itself ([{ rel, op: "upsert" | "remove" }]):
 * queued like the watcher's events, so several land in one incremental
 * rebuild. The watcher may report the same paths again; that costs nothing.
 */
export function noteFileChanges(changes) {
  for (const { rel, op } of changes) {
    if (!isGameFile(rel)) continue;
    pendingFileDeltas.set(rel, op === "remove" ? "remove" : "upsert");
  }
  if (filesMap) scheduleRebuild(`${changes.length} file change(s)`);
}

/**
 * Relative paths (under the games dir) of every scanned game file whose base
 * titleId matches. Used by the extras route to locate a title's folder(s).
 * Returns [] before the first build (cache cold) — callers should await get()
 * first to guarantee filesMap is populated.
 */
export function relPathsForBase(baseTitleId) {
  if (!filesMap || !baseTitleId) return [];
  const out = [];
  for (const [rel, item] of filesMap) {
    if (item.baseTitleId === baseTitleId) out.push(rel);
  }
  return out;
}

/**
 * Return the pre-serialized body for /games.json. Picks the
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

// Compress an identity Buffer into the { identity, gzip, brotli, etag } variant
// shape shared by the shop response and the sections view. gzip + brotli run in
// parallel on libuv's thread pool; a failed codec yields null and the caller
// falls back to a lighter encoding.
async function compressVariant(identity) {
  const etag = `"${crypto.createHash("sha1").update(identity).digest("base64url")}"`;
  const [gzip, brotli] = await Promise.all([
    gzipAsync(identity, { level: 6 }).catch((err) => {
      debug.error("shop cache: gzip failed: %s", err.message);
      return null;
    }),
    brotliAsync(identity, {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY },
    }).catch((err) => {
      debug.error("shop cache: brotli failed: %s", err.message);
      return null;
    }),
  ]);
  return { identity, gzip, brotli, etag };
}

// Pick the smallest variant the caller advertised — br > gzip > identity.
function pickVariant(variant, acceptedEncodings) {
  const enc = Array.isArray(acceptedEncodings) ? acceptedEncodings : [];
  if (enc.includes("br") && variant.brotli) {
    return { body: variant.brotli, contentEncoding: "br", etag: variant.etag };
  }
  if (enc.includes("gzip") && variant.gzip) {
    return { body: variant.gzip, contentEncoding: "gzip", etag: variant.etag };
  }
  return { body: variant.identity, contentEncoding: null, etag: variant.etag };
}

// Derive the absolute-URL variant for a single origin and compress it. The
// rewrite reads serializedJson synchronously up front, so a concurrent
// rebuild swapping the base buffers can't desync this variant's body/etag.
// File URLs are anchored at the origin; with `link` (a client that asked for
// the direct address) they are on the direct address instead (security/download-links.js).
function rewriteDownloads(json, origin, link) {
  return rewriteDownloadOrigin(downloadLinks.withShopDirect(json, link), origin);
}

// The memo key: one variant per origin, and one more per direct address. The
// body never carries anything per console, so every console shares it.
const memoKey = (origin, link) => (link ? `${origin}|${link.base}` : origin);

async function encodeForOrigin(origin, link) {
  // Both artwork (`/api/library/...`) and file-download (`../foo.nsp`) URLs are made
  // ABSOLUTE against this origin. The console client handles them two
  // different ways and BOTH need an absolute URL:
  //   - icons: passed straight to curl (downloadImageWithAuth) — a host-relative
  //     URL has no host to resolve, so it silently fails.
  //   - downloads: passed through BuildFullUrl(baseUrl, urlPath), which only
  //     leaves "http(s)://…" untouched. A "../foo.nsp" becomes
  //     "baseUrl/../foo.nsp" (broken) — so the legacy relative form makes
  //     "tap a title → nothing happens". An absolute URL is returned verbatim.
  let rewritten = rewriteArtworkOrigin(serializedJson.toString("utf-8"), origin);
  rewritten = rewriteDownloads(rewritten, origin, link);
  return compressVariant(Buffer.from(rewritten));
}

/**
 * Like getEncoded(), but rewrites the shop response's artwork URLs to be
 * ABSOLUTE against `origin` (scheme://host) so the console client can fetch
 * icons by curling the URL verbatim. A falsy origin falls back to the
 * host-relative payload (getEncoded) — correct for same-origin browser fetches
 * and any caller that can't determine a host. `link` (download-links.js
 * forRequest) puts the file URLs on the direct address.
 */
export async function getEncodedForOrigin(acceptedEncodings, origin, link = null) {
  if (!origin && !link) return getEncoded(acceptedEncodings);
  if (!cached) await build();

  const variant = await memoized(originMemo, origin, link, () => encodeForOrigin(origin, link));
  return pickVariant(variant, acceptedEncodings);
}

// Lazily serialize the sections view from the current warmed state. Cached
// until the next rebuild clears it, so the expensive composeSections + stringify
// happens at most once per library change instead of once per request.
function ensureSectionsIdentity() {
  if (!sectionsIdentity) {
    sectionsIdentity = Buffer.from(JSON.stringify(composeSections(filesMap, customs)));
  }
  return sectionsIdentity;
}

async function encodeSectionsForOrigin(origin, link) {
  let rewritten = rewriteArtworkOrigin(sectionsIdentity.toString("utf-8"), origin);
  rewritten = rewriteDownloads(rewritten, origin, link);
  return compressVariant(Buffer.from(rewritten));
}

/**
 * Pre-serialized, per-origin-memoized, compressed sections payload
 * (/api/library/sections). Mirrors getEncodedForOrigin: the body is
 * built once per rebuild and reused across requests (br/gzip/identity + ETag),
 * instead of recomputing ~1 MB of JSON on every hit. Forces a build when
 * filesMap is null so it's safe on the warm-restart path. `link` as in
 * getEncodedForOrigin.
 */
export async function getSectionsEncodedForOrigin(acceptedEncodings, origin, link = null) {
  if (!filesMap) await build();
  ensureSectionsIdentity();

  if (!origin && !link) {
    if (!sectionsNoOriginVariant) {
      sectionsNoOriginVariant = await compressVariant(sectionsIdentity);
    }
    return pickVariant(sectionsNoOriginVariant, acceptedEncodings);
  }

  const variant = await memoized(sectionsOriginMemo, origin, link, () => encodeSectionsForOrigin(origin, link));
  return pickVariant(variant, acceptedEncodings);
}

/**
 * Mark the cache as stale and schedule a debounced rebuild — WITHOUT
 * clearing the current snapshot. Consumers keep getting the previous
 * response until the new one is ready, then see it atomically replaced.
 * This is what makes warm restart and titledb-late-load paths smooth:
 * no request ever has to wait through a fresh scan just because something
 * changed in the background.
 *
 * Pass `{ rename: true }` when the change invalidates the per-file items
 * THEMSELVES rather than the library contents — titledb finishing its load
 * is the case that matters. Each `filesMap` entry bakes in its display name
 * at scan time, so a plain rebuild takes the incremental path, finds
 * `+0/-0` files changed, and re-composes the very same stale names. On a
 * small/fast library the cold scan beats titledb's ~1s load every time, and
 * the catalog then serves filename-derived names until some file happens to
 * change. `rename` rebuilds the items against the loaded store from what is
 * already held (path, size, mtime), without reading the games folder again.
 * `rescan` reads every file again: only for changes on disk a watch may miss.
 *
 * (The sections view never had this bug: composeSections re-derives each
 * item from its path on every build, so it always saw fresh titledb. That
 * asymmetry is exactly how this was caught: the sections showed "데드 셀"
 * while the file list still had "Dead Cells".)
 */
export function invalidate({ rescan = false, rename = false, background = false } = {}) {
  if (rescan) needsFullRescan = true;
  if (rename) needsRename = true;
  scheduleRebuild(rescan ? "invalidate+rescan" : rename ? "invalidate+rename" : "invalidate", { background });
}

function scheduleRebuild(reason, { background = false } = {}) {
  const delay = background ? Math.max(REBUILD_DEBOUNCE_MS, lastBuiltAt + BACKGROUND_COOLDOWN_MS - Date.now()) : REBUILD_DEBOUNCE_MS;
  // A rebuild already due sooner covers this one.
  if (debounceTimer && background && debounceDueAt <= Date.now() + delay) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceDueAt = Date.now() + delay;
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    debug.log("shop cache: rebuilding after %s", reason);
    build().catch((err) =>
      debug.error("shop cache: rebuild failed: %s", err.message)
    );
  }, delay);
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
  // Extractor → shop-cache: when the NACP worker finishes a record we
  // schedule a rebuild so the new name/publisher/version surfaces in
  // /games.json + propagates to ws subscribers without the user having
  // to touch a file.
  nacpExtractor.onExtracted(({ baseTitleId }) => {
    scheduleRebuild(`nacp-extracted ${baseTitleId}`, { background: true });
  });
  // Install facts (size, firmware, update display versions) arrive in batches
  // from a background read; load what earlier runs found before the first build.
  await contentMeta.load();
  contentMeta.onExtracted(() => scheduleRebuild("content-meta", { background: true }));
  featured.onChange(() => scheduleRebuild("featured"));

  // Warm-start path: if the previous run persisted state to disk, hydrate
  // it now so the first /games.json request after restart is served from
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
    // The drop box (meta/library-organize.js) is sorted into the library; its files are not listed.
    ignored: (filePath) => ignoredUnder(romsDirPath, filePath) || isIncoming(path.relative(romsDirPath, filePath)),
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

/**
 * Whether the watcher over `root` ignores `filePath`: anything under a dot
 * name inside the root (the trash, a trash on a disk below, a partial copy,
 * the NSZ keep folder), judged by the path's parts below the root. A watched
 * path outside the root (custom_entries.json) is judged by its own name. Pure.
 */
export function ignoredUnder(root, filePath) {
  const rel = path.relative(root, filePath);
  if (!rel) return false;
  if (rel.startsWith("..") || path.isAbsolute(rel)) return path.basename(filePath).startsWith(".");
  return rel.split(path.sep).some((p) => p.startsWith("."));
}

export async function stop() {
  if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
  if (watcher) { try { await watcher.close(); } catch {} watcher = null; }
}

export function stats() {
  return {
    cached: cached !== null,
    lastBuildMs,
    lastMode,
    buildCount,
    files: cached?.files?.length ?? 0,
    // What a rescan button needs: whether a read is waiting or running, and when the last whole one ended.
    scan: {
      state: building ? "running" : debounceTimer ? "queued" : "idle",
      fullPending: needsFullRescan,
      lastFull: lastFullScan,
    },
    bytes: {
      identity: serializedJson?.length ?? 0,
      gzip: serializedGzip?.length ?? 0,
      brotli: serializedBrotli?.length ?? 0,
    },
  };
}
