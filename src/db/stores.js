/**
 * What the scans keep in the index (see database.js):
 *
 *   catalogStore   the items a scan of one folder found, one row each, with
 *                  when the folder was last read in full
 *   hashStore      content hashes of files, remembered by fileKey (size, mtime, ctime, inode)
 *   retroRomHashes CRC-32, SHA-1 and SHA-256 of retro ROM files, remembered the same way
 */
import { transaction } from "./database.js";

/** The items of catalog `name`. */
export function catalogStore(db, name, { idOf = (item) => item.id } = {}) {
  const insert = db.prepare("INSERT OR REPLACE INTO catalog_items (catalog, id, data) VALUES (?, ?, ?)");
  const remove = db.prepare("DELETE FROM catalog_items WHERE catalog = ? AND id = ?");
  const clear = db.prepare("DELETE FROM catalog_items WHERE catalog = ?");
  const setScan = db.prepare("INSERT OR REPLACE INTO catalog_scans (catalog, scanned_at) VALUES (?, ?)");
  const fill = (items, at) => {
    clear.run(name);
    for (const item of items) insert.run(name, String(idOf(item)), JSON.stringify(item));
    setScan.run(name, at);
  };
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

/** File hashes under `scope`, kept in memory and written through. */
export function hashStore(db, scope) {
  const upsert = db.prepare("INSERT OR REPLACE INTO file_hashes (scope, path, key, hash) VALUES (?, ?, ?, ?)");
  const drop = db.prepare("DELETE FROM file_hashes WHERE scope = ? AND path = ?");
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

/** Retro ROM content hashes by absolute path: { key, data } with data as retro/rom-index.js reads a file. */
export function retroRomHashes(db) {
  const upsert = db.prepare("INSERT OR REPLACE INTO retro_rom_hashes (path, key, data) VALUES (?, ?, ?)");
  const drop = db.prepare("DELETE FROM retro_rom_hashes WHERE path = ?");
  let map = null;
  const known = () => (map ??= new Map(db.prepare("SELECT path, key, data FROM retro_rom_hashes").all().map((r) => [r.path, { key: r.key, data: JSON.parse(r.data) }])));
  return {
    get: (file) => known().get(file),
    set(file, { key, data }) {
      known().set(file, { key, data });
      upsert.run(file, key, JSON.stringify(data));
    },
    /** Forgets every file not in `seen` (a Set of paths). */
    prune(seen) {
      const gone = [...known().keys()].filter((p) => !seen.has(p));
      if (!gone.length) return;
      transaction(db, () => { for (const p of gone) { known().delete(p); drop.run(p); } });
    },
    get size() {
      return known().size;
    },
  };
}
