/**
 * Slim per-region titledb index.
 *
 * blawar/titledb publishes one ~50–200 MB JSON file per (country, lang) pair,
 * with ~40 fields per entry that we never surface. Parsing all of those on
 * every boot blocks the event loop for seconds and peaks Node's resident
 * memory at multi-GB during the parse step.
 *
 * The slim format is the same shape (object of entries) but:
 *   - keyed by the canonical uppercase title ID (not nsuId, so writeSlim
 *     also acts as a pre-built `entry.id` index for the store)
 *   - contains only the fields we actually merge into the runtime store
 *
 * Typical size reduction is 20–50× vs raw, and parse time drops from
 * seconds to <50 ms per region. The titledb fetcher emits slim files
 * right after each raw download, and the store opportunistically emits
 * slim when it loads a raw file with no slim sibling (covers upgrade-
 * in-place users who already have raw caches on disk).
 */
import { readFile, writeFile, rename } from "fs/promises";

// Keep aligned with MERGED_FIELDS in titledb-store.js. Anything not on this
// list is discarded by the slim transform — adding a field here is the only
// thing required to start surfacing it (alongside the store's MERGED_FIELDS).
const SLIM_FIELDS = [
  "name", "publisher", "description", "releaseDate", "region", "rating",
  "rank", "size", "intro", "category", "iconUrl", "bannerUrl",
  "screenshots", "version", "nsuId", "numberOfPlayers",
];

export const SLIM_SUFFIX = ".slim.json";

export function slimPathFor(rawPath) {
  return rawPath.replace(/\.json$/, SLIM_SUFFIX);
}

function transform(json) {
  if (!json || typeof json !== "object") {
    throw new Error("raw titledb is not an object");
  }
  const slim = {};
  let count = 0;
  for (const entry of Object.values(json)) {
    if (!entry || typeof entry !== "object") continue;
    const rawId = entry.id;
    if (typeof rawId !== "string") continue;
    const id = rawId.toUpperCase();
    if (!/^[0-9A-F]{16}$/.test(id)) continue;
    const out = { id };
    for (const field of SLIM_FIELDS) {
      const v = entry[field];
      if (v === undefined || v === null || v === "") continue;
      out[field] = v;
    }
    slim[id] = out;
    count++;
  }
  return { slim, count };
}

async function atomicWrite(slimPath, slim) {
  const tmp = `${slimPath}.tmp.${process.pid}`;
  await writeFile(tmp, JSON.stringify(slim));
  await rename(tmp, slimPath);
}

/** Parse the raw region file from disk and emit its slim sibling. */
export async function writeSlimFromRawPath(rawPath, slimPath) {
  const text = await readFile(rawPath, "utf-8");
  const json = JSON.parse(text);
  const { slim, count } = transform(json);
  await atomicWrite(slimPath, slim);
  return { count };
}

/** Reuse an already-parsed raw object (callers that just JSON.parse'd). */
export async function writeSlimFromJson(json, slimPath) {
  const { slim, count } = transform(json);
  await atomicWrite(slimPath, slim);
  return { count };
}
