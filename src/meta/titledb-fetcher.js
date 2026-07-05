/**
 * Download community titledb region files (blawar/titledb) to local cache.
 *
 * Atomic write: stream to .tmp, rename on success. Skips 404 regions silently
 * (not every region/lang pair exists upstream). All failures are non-fatal —
 * the merger just works with whatever files arrived (FINDINGS §7).
 */
import { mkdir, rename, unlink, writeFile } from "fs/promises";
import path from "path";
import debug from "../debug.js";
import { slimPathFor, writeSlimFromRawPath } from "./titledb-slim.js";

const BASE_URL = "https://raw.githubusercontent.com/blawar/titledb/master";

export const DEFAULT_REGIONS = ["KR.ko", "US.en", "JP.ja", "EU.en", "HK.zh"];

export function getRegionsFromEnv() {
  const raw = process.env.COOK_TITLEDB_REGIONS;
  if (!raw) return DEFAULT_REGIONS;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function regionUrl(region) {
  return `${BASE_URL}/${region}.json`;
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

export async function fetchRegion(region, destDir) {
  const url = regionUrl(region);
  const finalPath = path.join(destDir, `${region}.json`);
  const tmpPath = `${finalPath}.tmp`;

  debug.log("titledb: GET %s", url);
  let res;
  try {
    res = await fetch(url, { redirect: "follow" });
  } catch (err) {
    debug.error("titledb: network error fetching %s: %s", region, err.message);
    return { region, ok: false, error: err.message };
  }

  if (res.status === 404) {
    debug.log("titledb: %s not available (404) — skipping", region);
    await writeTombstone(destDir, region);
    return { region, ok: false, status: 404 };
  }
  if (!res.ok) {
    debug.error("titledb: %s returned HTTP %d", region, res.status);
    return { region, ok: false, status: res.status };
  }

  const sizeHeader = res.headers.get("content-length");
  if (sizeHeader) {
    debug.log("titledb: %s size %d bytes", region, sizeHeader);
  }

  try {
    const buf = Buffer.from(await res.arrayBuffer());
    await mkdir(destDir, { recursive: true });
    await writeFile(tmpPath, buf);
    await rename(tmpPath, finalPath);
    // Region is back — drop any stale absent-marker from a prior 404.
    await clearTombstone(destDir, region);
    debug.log("titledb: %s saved (%d bytes)", region, buf.length);
    // Emit slim sibling so the next boot skips the multi-second raw parse.
    // Non-fatal: if it fails the store falls back to the raw file.
    try {
      const slimPath = slimPathFor(finalPath);
      const slim = await writeSlimFromRawPath(finalPath, slimPath);
      debug.log("titledb: %s slim written (%d entries)", region, slim.count);
    } catch (slimErr) {
      debug.error("titledb: slim write failed for %s: %s", region, slimErr.message);
    }
    return { region, ok: true, bytes: buf.length, path: finalPath };
  } catch (err) {
    // best-effort cleanup of the .tmp file
    try { await unlink(tmpPath); } catch (_) {}
    debug.error("titledb: write error for %s: %s", region, err.message);
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
