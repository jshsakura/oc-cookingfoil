/**
 * Disk-backed fallback metadata store, used when blawar/titledb has no
 * entry for a titleId. The shape of each record mirrors the merged
 * titledb fields the rest of the system already understands, so
 * `composeResponse` can fold it in with the same code path.
 *
 * Persistence:
 *   $COOK_DATA_DIR/extracted-meta/<UPPER_TITLE_ID>.json
 *
 * Each file holds a single object:
 *   {
 *     id: "0100..F000",
 *     name: "...",
 *     publisher: "...",
 *     version: "1.0.3",
 *     numberOfPlayers: 4,
 *     iconPath: "/abs/path/to/icon.png",   // optional — image-cache uses it
 *     source: "nro" | "nacp" | "fan",       // who put this here
 *     extractedAt: "2026-05-29T00:00:00Z",
 *   }
 *
 * The store is built once at boot (load directory listing into memory)
 * and is incrementally updated as extractors finish. Reads are an O(1)
 * Map lookup; the disk is only re-read when explicitly asked to.
 */
import fs from "fs/promises";
import path from "path";
import debug from "../debug.js";
import { extractedMetaDir } from "../helpers/envs.js";

const FILE_RE = /^([0-9A-F]{16})\.json$/;

const memory = new Map(); // titleId(upper) → record
let loaded = false;

function normTid(raw) {
  if (typeof raw !== "string") return null;
  const hex = raw.toUpperCase().replace(/[^0-9A-F]/g, "");
  return hex.length === 16 ? hex : null;
}

export async function load() {
  try {
    await fs.mkdir(extractedMetaDir, { recursive: true });
  } catch (err) {
    debug.error("extracted-meta: mkdir failed: %s", err.message);
    loaded = true;
    return;
  }
  let entries;
  try {
    entries = await fs.readdir(extractedMetaDir);
  } catch (err) {
    debug.error("extracted-meta: readdir failed: %s", err.message);
    loaded = true;
    return;
  }
  let count = 0;
  for (const name of entries) {
    const m = name.match(FILE_RE);
    if (!m) continue;
    try {
      const text = await fs.readFile(path.join(extractedMetaDir, name), "utf-8");
      const obj = JSON.parse(text);
      const tid = normTid(obj.id) ?? m[1];
      memory.set(tid, obj);
      count++;
    } catch (err) {
      debug.error("extracted-meta: parse %s: %s", name, err.message);
    }
  }
  loaded = true;
  debug.log("extracted-meta: loaded %d records", count);
}

export function get(titleId) {
  const tid = normTid(titleId);
  if (!tid) return null;
  return memory.get(tid) ?? null;
}

export function size() {
  return memory.size;
}

export function isLoaded() {
  return loaded;
}

/**
 * Persist (and memoize) a record for a titleId. Idempotent — passing the
 * same content twice is a no-op write. Returns the canonicalized record
 * that's now in memory.
 */
export async function put(record) {
  if (!record) throw new Error("put: record required");
  const tid = normTid(record.id);
  if (!tid) throw new Error("put: invalid titleId");
  const out = { ...record, id: tid };
  if (!out.extractedAt) out.extractedAt = new Date().toISOString();
  memory.set(tid, out);
  try {
    await fs.mkdir(extractedMetaDir, { recursive: true });
    const fp = path.join(extractedMetaDir, `${tid}.json`);
    const tmp = `${fp}.tmp.${process.pid}`;
    await fs.writeFile(tmp, JSON.stringify(out, null, 2));
    await fs.rename(tmp, fp);
  } catch (err) {
    debug.error("extracted-meta: persist failed for %s: %s", tid, err.message);
  }
  return out;
}

export function entries() {
  return Array.from(memory.entries());
}
