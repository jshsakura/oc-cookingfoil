/**
 * Titledb lifecycle: synchronous load from disk on boot, background fetch
 * when the cache is cold, and a periodic auto-refresh on a configurable
 * interval (default 24 h). The server never blocks on any of this — until
 * a fetch lands, the shop just uses filename-derived metadata, which
 * satisfies the no-omission invariant.
 *
 * Re-scheduling is mtime-driven: on each call to `bootstrap()` we look at
 * the oldest cached region file and schedule the next refresh for the
 * remaining time until it would be `interval` old. So a container restart
 * doesn't reset the clock — if the cache is 23 h old, we refresh in 1 h.
 */
import { mkdir, readdir, stat } from "fs/promises";
import path from "path";
import debug from "../debug.js";
import { titledbCacheDir } from "../helpers/envs.js";
import * as store from "./titledb-store.js";
import * as shopCache from "./shop-cache.js";
import { fetchAll, getRegionsFromEnv } from "./titledb-fetcher.js";

// `Number` here so "0.01" (~36 s) works for tests; clamped to >= 0.
const REFRESH_HOURS = Math.max(
  0,
  Number(process.env.COOK_TITLEDB_REFRESH_INTERVAL_HOURS ?? 24)
);
const REFRESH_MS = REFRESH_HOURS * 60 * 60 * 1000;
const POST_BOOT_DELAY_MS = 60_000;  // small breathing room when refresh is due

let inFlight = null;
let refreshTimer = null;

async function doFetch(regions) {
  // Concurrent callers share the same in-flight promise — no duplicate
  // downloads when boot fetch and scheduled refresh race.
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const target = regions ?? getRegionsFromEnv();
      const results = await fetchAll(target, titledbCacheDir);
      const okCount = results.filter((r) => r.ok).length;
      debug.log(
        "titledb fetch: ok=%d/%d",
        okCount,
        results.length
      );
      if (okCount > 0) {
        await store.load();
        debug.log("titledb store reloaded (%d titles)", store.size());
        // Fresh titledb → stale shop cache. Next /shop.json rebuilds with
        // the new metadata; in-flight responses keep the old one (fine).
        shopCache.invalidate();
      }
      return results;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/**
 * Configured regions that have NO file on disk yet (neither the raw
 * `<region>.json` nor the pre-indexed `<region>.slim.json`). Pure + exported
 * so the back-fill decision is unit-testable without touching the network.
 */
export function missingRegions(configured, presentFiles) {
  const files = presentFiles instanceof Set ? presentFiles : new Set(presentFiles);
  return configured.filter(
    (r) => !files.has(`${r}.json`) && !files.has(`${r}.slim.json`)
  );
}

async function presentRegionFiles() {
  try {
    return new Set(await readdir(titledbCacheDir));
  } catch {
    return new Set();
  }
}

async function oldestCacheMtime() {
  try {
    const files = await readdir(titledbCacheDir);
    let oldest = Infinity;
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      const s = await stat(path.join(titledbCacheDir, f));
      if (s.mtimeMs < oldest) oldest = s.mtimeMs;
    }
    return oldest === Infinity ? null : oldest;
  } catch {
    return null;
  }
}

function schedule(delayMs) {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    debug.log("titledb refresh: timer fired");
    try {
      await doFetch();
    } catch (err) {
      debug.error("titledb refresh: %s", err.message);
    }
    schedule(REFRESH_MS); // recurring every interval
  }, delayMs);
  // Don't hold the event loop open just for this timer — Node should exit
  // cleanly on SIGTERM even mid-cycle.
  refreshTimer.unref();
  debug.log(
    "titledb refresh: next attempt in %d min",
    Math.max(1, Math.round(delayMs / 60_000))
  );
}

export async function bootstrap() {
  try {
    await mkdir(titledbCacheDir, { recursive: true });
  } catch (err) {
    debug.error("titledb bootstrap: mkdir failed: %s", err.message);
  }

  await store.load();
  // The shop-cache init runs concurrently and might have already built a
  // response while titledb-store was still loading from disk (race on cold
  // start). Invalidate so the next /shop.json triggers a rebuild with the
  // titledb data we just loaded — names, aliases and metadata all flow.
  shopCache.invalidate();
  const autoFetch = process.env.COOK_TITLEDB_AUTO_FETCH !== "false";
  const haveCache = store.size() > 0;
  // A partial cache is the common real-world state: an early boot (or a once-
  // narrowed COOK_TITLEDB_REGIONS) left only some regions on disk. Because
  // `haveCache` used to gate the boot fetch on "store non-empty", the missing
  // regions — notably US.en, the source of English search aliases for the
  // "한글 (English)" name decoration — were NEVER back-filled until the 24 h
  // refresh happened to run. Detect the gap and fetch ONLY the missing regions
  // (the ones already on disk, e.g. KR.ko, aren't re-pulled).
  const missing = missingRegions(getRegionsFromEnv(), await presentRegionFiles());

  const onFetchDone = (label) => () =>
    debug.log("titledb bootstrap: %s done (%d titles)", label, store.size());
  const onFetchFail = (label) => (err) =>
    debug.error("titledb bootstrap: %s failed: %s", label, err.message);

  if (haveCache && missing.length === 0) {
    debug.log("titledb bootstrap: cache present (%d titles)", store.size());
  } else if (!autoFetch) {
    debug.log(
      "titledb bootstrap: cache %s and auto-fetch disabled",
      haveCache ? `incomplete (missing ${missing.join(", ")})` : "empty"
    );
  } else if (haveCache && missing.length > 0) {
    debug.log(
      "titledb bootstrap: back-filling missing regions: %s",
      missing.join(", ")
    );
    doFetch(missing).then(onFetchDone("back-fill")).catch(onFetchFail("back-fill"));
  } else {
    debug.log("titledb bootstrap: cache empty — fetching in background");
    doFetch().then(onFetchDone("initial fetch")).catch(onFetchFail("initial fetch"));
  }

  if (!autoFetch) {
    debug.log("titledb refresh: disabled (COOK_TITLEDB_AUTO_FETCH=false)");
    return;
  }
  if (REFRESH_MS <= 0) {
    debug.log(
      "titledb refresh: disabled (COOK_TITLEDB_REFRESH_INTERVAL_HOURS=0)"
    );
    return;
  }

  // Schedule the next refresh based on how old the cache already is.
  const mtime = await oldestCacheMtime();
  let delay;
  if (mtime === null) {
    // No cache on disk (either cold start, or fetch in progress) — let the
    // initial fetch settle, then run the regular cadence from there.
    delay = REFRESH_MS;
  } else {
    const age = Date.now() - mtime;
    delay = age >= REFRESH_MS ? POST_BOOT_DELAY_MS : REFRESH_MS - age;
  }
  schedule(delay);
}

/** Force an out-of-cycle refresh — used by tests / future admin endpoint. */
export async function refresh() {
  return doFetch();
}
