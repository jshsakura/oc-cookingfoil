/**
 * What the scans keep in the index (see database.js):
 *
 *   catalogStore   the items a scan of one folder found, one row each, with
 *                  when the folder was last read in full
 *   hashStore      content hashes of files, remembered by (size, mtime, inode)
 *
 * Both take over a JSON file an earlier version kept (`legacyFile`) once, on
 * first use; the file itself is left where it is.
 */
import fs from "fs";
import path from "path";
import debug from "../debug.js";
import { transaction } from "./database.js";

/** The JSON in `file`, or null when there is none or it does not parse. */
function readLegacy(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") debug.error("index: %s not taken over: %s", path.basename(file), err.message);
    return null;
  }
}

/** Calls `take(json)` with `file`'s content the first time this index sees `source`. */
function importOnce(db, source, file, take) {
  if (!file || db.prepare("SELECT 1 FROM imports WHERE source = ?").get(source)) return;
  const json = readLegacy(file);
  transaction(db, () => {
    if (json) take(json);
    db.prepare("INSERT INTO imports (source, at) VALUES (?, ?)").run(source, Date.now());
  });
  if (json) debug.log("index: took over %s", path.basename(file));
}

/**
 * The items of catalog `name`. `legacyFile` is a { at, <field>: [...] } listing
 * from before (`legacyField` names the array).
 */
export function catalogStore(db, name, { idOf = (item) => item.id, legacyFile = null, legacyField = "entries" } = {}) {
  const insert = db.prepare("INSERT OR REPLACE INTO catalog_items (catalog, id, data) VALUES (?, ?, ?)");
  const remove = db.prepare("DELETE FROM catalog_items WHERE catalog = ? AND id = ?");
  const clear = db.prepare("DELETE FROM catalog_items WHERE catalog = ?");
  const setScan = db.prepare("INSERT OR REPLACE INTO catalog_scans (catalog, scanned_at) VALUES (?, ?)");
  const fill = (items, at) => {
    clear.run(name);
    for (const item of items) insert.run(name, String(idOf(item)), JSON.stringify(item));
    setScan.run(name, at);
  };
  importOnce(db, `catalog:${name}`, legacyFile, (json) => {
    if (Array.isArray(json?.[legacyField]) && Number.isFinite(json.at)) fill(json[legacyField], json.at);
  });
  return {
    /** { at, items } from the last full scan (with the single changes since), or null before one. */
    load() {
      const scan = db.prepare("SELECT scanned_at FROM catalog_scans WHERE catalog = ?").get(name);
      if (!scan) return null;
      const items = db.prepare("SELECT data FROM catalog_items WHERE catalog = ?").all(name).map((r) => JSON.parse(r.data));
      return { at: scan.scanned_at, items };
    },
    /** A full scan's result, in place of everything before it. */
    replace(items, at) {
      transaction(db, () => fill(items, at));
    },
    /** One item read again. */
    put(item) {
      insert.run(name, String(idOf(item)), JSON.stringify(item));
    },
    /** Items gone (by id). */
    remove(...ids) {
      transaction(db, () => { for (const id of ids) remove.run(name, String(id)); });
    },
  };
}

/**
 * File hashes under `scope`, kept in memory and written through. `legacyFile`
 * is a { "<abs path>": { key, hash } } map from before.
 */
export function hashStore(db, scope, { legacyFile = null } = {}) {
  const upsert = db.prepare("INSERT OR REPLACE INTO file_hashes (scope, path, key, hash) VALUES (?, ?, ?, ?)");
  const drop = db.prepare("DELETE FROM file_hashes WHERE scope = ? AND path = ?");
  importOnce(db, `hashes:${scope}`, legacyFile, (json) => {
    for (const [p, v] of Object.entries(json ?? {})) if (v?.key && v?.hash) upsert.run(scope, p, String(v.key), String(v.hash));
  });
  let map = null;
  const known = () => (map ??= new Map(db.prepare("SELECT path, key, hash FROM file_hashes WHERE scope = ?").all(scope).map((r) => [r.path, { key: r.key, hash: r.hash }])));
  return {
    /** { key, hash } remembered for `file`, or undefined. */
    get: (file) => known().get(file),
    set(file, { key, hash }) {
      known().set(file, { key, hash });
      upsert.run(scope, file, key, hash);
    },
    /** Forgets every file not in `seen` (a Set of paths). */
    prune(seen) {
      const gone = [...known().keys()].filter((p) => !seen.has(p));
      if (!gone.length) return;
      transaction(db, () => { for (const p of gone) { known().delete(p); drop.run(scope, p); } });
    },
    get size() {
      return known().size;
    },
  };
}
