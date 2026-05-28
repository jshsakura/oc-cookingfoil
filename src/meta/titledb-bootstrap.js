/**
 * Boot the titledb cache: load whatever's on disk synchronously, and — only
 * if nothing was cached yet — kick off a background fetch from blawar/titledb.
 * The server never blocks on this. While the fetch is running, the shop just
 * uses filename-derived metadata, which satisfies the no-omission invariant.
 */
import { mkdir } from "fs/promises";
import debug from "../debug.js";
import { titledbCacheDir } from "../helpers/envs.js";
import * as store from "./titledb-store.js";
import { fetchAll, getRegionsFromEnv } from "./titledb-fetcher.js";

let inFlight = null;

export async function bootstrap() {
  try {
    await mkdir(titledbCacheDir, { recursive: true });
  } catch (err) {
    debug.error("titledb bootstrap: mkdir failed: %s", err.message);
  }
  await store.load();

  if (store.size() > 0) {
    debug.log("titledb bootstrap: cache present (%d titles)", store.size());
    return;
  }

  if (process.env.COOK_TITLEDB_AUTO_FETCH === "false") {
    debug.log("titledb bootstrap: cache empty and auto-fetch disabled");
    return;
  }

  debug.log("titledb bootstrap: cache empty — fetching in background");
  inFlight = (async () => {
    try {
      const regions = getRegionsFromEnv();
      const results = await fetchAll(regions, titledbCacheDir);
      const ok = results.filter((r) => r.ok).map((r) => r.region);
      const fail = results.filter((r) => !r.ok).map((r) => r.region);
      debug.log(
        "titledb bootstrap: fetch done (ok=%s, fail=%s)",
        ok.join(",") || "-",
        fail.join(",") || "-"
      );
      await store.load();
      debug.log(
        "titledb bootstrap: store reloaded (%d titles)",
        store.size()
      );
    } catch (err) {
      debug.error("titledb bootstrap: fetch failed: %s", err.message);
    } finally {
      inFlight = null;
    }
  })();
}

/** Force a refresh — used by an admin endpoint or tests. */
export async function refresh() {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      await mkdir(titledbCacheDir, { recursive: true });
      const regions = getRegionsFromEnv();
      const results = await fetchAll(regions, titledbCacheDir);
      await store.load();
      return {
        results,
        titles: store.size(),
        regions: store.status().regions,
      };
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
