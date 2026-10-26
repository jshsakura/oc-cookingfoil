/**
 * Download community titledb region files (blawar/titledb) to local cache.
 *
 * Atomic write: stream to .tmp, check it is a region file, rename on success. Skips 404 regions silently
 * (not every region/lang pair exists upstream). All failures are non-fatal —
 * the merger just works with whatever files arrived (FINDINGS §7).
 */
import { mkdir, readFile, rename, unlink, writeFile } from "fs/promises";
import path from "path";
import debug from "../debug.js";
import { titledbRegions, titledbSource } from "../helpers/envs.js";
import { downloadToFile, tmpPathFor } from "./titledb-download.js";
import { atomicWrite, slimFromJson, slimPathFor } from "./titledb-slim.js";

export const DEFAULT_SOURCE = "https://raw.githubusercontent.com/blawar/titledb/master";

// The library's four languages first, then every other region that still adds
// games of its own (measured 2026-10: 112 base titles, Europe-only releases
// mostly). Regions merge in language-priority order and a field keeps its
// first value, so the extra regions only fill gaps; they never replace a name
// the library's languages already have. titledb names its European English file
// GB.en; EU.en does not exist upstream.
export const DEFAULT_REGIONS = [
  "KR.ko", "US.en", "JP.ja", "GB.en", "HK.zh", "CN.zh",
  "AU.en", "NZ.en", "CA.en", "ZA.en", "DE.de", "FR.fr", "ES.es", "IT.it", "RU.ru", "BR.pt", "NL.nl",
];
const RENAMED = { "EU.en": "GB.en" };

/** The regions set on the admin page, else COOK_TITLEDB_REGIONS, else the defaults. */
export function getRegionsFromEnv() {
  const raw = titledbRegions.length ? titledbRegions.join(",") : process.env.COOK_TITLEDB_REGIONS;
  if (!raw) return DEFAULT_REGIONS;
  const regions = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((r) => RENAMED[r] ?? r);
  return [...new Set(regions)];
}

/** The address set on the admin page (a fork or mirror), else blawar/titledb. */
export const titledbBase = () => titledbSource || DEFAULT_SOURCE;

function regionUrl(region) {
  return `${titledbBase()}/${region}.json`;
}

// A region that returns 404 upstream (not every region/lang pair exists in
// blawar/titledb) is marked absent with a `<region>.404` tombstone so the
// boot-time back-fill (which only fetches "missing" regions) doesn't re-request
// it on every restart. The scheduled full refresh still re-attempts it, so a
// region that later appears upstream is picked up.
function tombstonePath(destDir, region) {
  return path.join(destDir, `${region}.404`);
}

async function writeTombstone(destDir, region) {
  try {
    await mkdir(destDir, { recursive: true });
    await writeFile(tombstonePath(destDir, region), "");
  } catch (err) {
    debug.error("titledb: tombstone write failed for %s: %s", region, err.message);
  }
}

async function clearTombstone(destDir, region) {
  try {
    await unlink(tombstonePath(destDir, region));
  } catch (_) {
    // ENOENT is the normal case — no tombstone to clear.
  }
}

// A mirror can answer 200 with the wrong file (an error page, another JSON).
// Saving that would replace a region's names with nothing, so a download is
// kept only when it holds games and doesn't shrink the region to under half.
export const MIN_ENTRIES = 10;

async function previousCount(slimPath) {
  try {
    const slim = JSON.parse(await readFile(slimPath, "utf-8"));
    return Object.keys(slim).filter((k) => k !== "_schemaVersion").length;
  } catch {
    return 0;
  }
}

/** Why a downloaded region must not replace the cached one, or null when it may. */
export function rejectReason(count, before) {
  if (count < MIN_ENTRIES) return `only ${count} games`;
  if (count * 2 < before) return `${count} games, down from ${before}`;
  return null;
}

export async function fetchRegion(region, destDir) {
  const url = regionUrl(region);
  const finalPath = path.join(destDir, `${region}.json`);
  // Unique, so a back-fill and a full refresh fetching the same region never share one.
  const tmpPath = tmpPathFor(finalPath);
  const slimPath = slimPathFor(finalPath);

  debug.log("titledb: GET %s", url);
  let got;
  try {
    got = await downloadToFile(url, tmpPath);
  } catch (err) {
    debug.error("titledb: download of %s failed: %s", region, err.message);
    return { region, ok: false, error: err.message };
  }

  if (got.status === 404) {
    debug.log("titledb: %s not available (404) — skipping", region);
    await writeTombstone(destDir, region);
    return { region, ok: false, status: 404 };
  }
  if (got.bytes === undefined) {
    debug.error("titledb: %s returned HTTP %d", region, got.status);
    return { region, ok: false, status: got.status };
  }

  try {
    const { slim, count } = slimFromJson(JSON.parse(await readFile(tmpPath, "utf-8")));
    const reason = rejectReason(count, await previousCount(slimPath));
    if (reason) throw new Error(`refused, ${reason}`);
    await rename(tmpPath, finalPath);
    // Region is back — drop any stale absent-marker from a prior 404.
    await clearTombstone(destDir, region);
    debug.log("titledb: %s saved (%d bytes)", region, got.bytes);
    // Emit slim sibling so the next boot skips the multi-second raw parse.
    // Non-fatal: if it fails the store falls back to the raw file.
    try {
      await atomicWrite(slimPath, slim);
      debug.log("titledb: %s slim written (%d entries)", region, count);
    } catch (slimErr) {
      debug.error("titledb: slim write failed for %s: %s", region, slimErr.message);
    }
    return { region, ok: true, bytes: got.bytes, path: finalPath };
  } catch (err) {
    // The cached file stays as it was; only the download is thrown away.
    try { await unlink(tmpPath); } catch (_) {}
    debug.error("titledb: %s not saved: %s", region, err.message);
    return { region, ok: false, error: err.message };
  }
}

export async function fetchAll(regions, destDir) {
  // Sequential download keeps memory bounded for large region files
  // (titles.US.en.json is ~200 MB).
  const results = [];
  for (const region of regions) {
    results.push(await fetchRegion(region, destDir));
  }
  return results;
}
