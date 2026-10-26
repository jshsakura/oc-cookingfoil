/**
 * The schema of both SQLite files and how a file is opened and brought up to
 * date. Nothing here reads the server's settings, so a test can make a file
 * before the server starts.
 */
import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";

export const DB_FILE = "cookingfoil.db";
export const SECURITY_DB_FILE = path.join("security", "security.db");

// Each step runs once, in order; user_version counts the steps done.
export const INDEX_MIGRATIONS = [
  `CREATE TABLE catalog_items (
     catalog TEXT NOT NULL,
     id TEXT NOT NULL,
     data TEXT NOT NULL,
     PRIMARY KEY (catalog, id)
   ) WITHOUT ROWID;
   CREATE TABLE catalog_scans (
     catalog TEXT PRIMARY KEY,
     scanned_at INTEGER NOT NULL
   );
   CREATE TABLE file_hashes (
     scope TEXT NOT NULL,
     path TEXT NOT NULL,
     key TEXT NOT NULL,
     hash TEXT NOT NULL,
     PRIMARY KEY (scope, path)
   ) WITHOUT ROWID;
   CREATE TABLE imports (
     source TEXT PRIMARY KEY,
     at INTEGER NOT NULL
   );`,
  // Content hashes of retro ROM files (retro/rom-index.js), by absolute path, with the fileKey they were read at.
  // data is JSON: { crc32, sha1?, sha256?, bare?, entry?, skip? }. Retro games only, never the Switch library.
  `CREATE TABLE retro_rom_hashes (
     path TEXT PRIMARY KEY,
     key TEXT NOT NULL,
     data TEXT NOT NULL
   ) WITHOUT ROWID;`,
];

// One row per record (an account, a console login, a token), JSON as the module
// keeps it; settings one row each; secrets only ever sealed (security/secret-box.js).
export const SECURITY_MIGRATIONS = [
  `CREATE TABLE records (
     kind TEXT NOT NULL,
     id TEXT NOT NULL,
     data TEXT NOT NULL,
     PRIMARY KEY (kind, id)
   ) WITHOUT ROWID;
   CREATE TABLE settings (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   );
   CREATE TABLE secrets (
     name TEXT PRIMARY KEY,
     sealed TEXT NOT NULL CHECK (sealed LIKE 'cfsec:v1:%')
   );
   CREATE TABLE imports (
     source TEXT PRIMARY KEY,
     at INTEGER NOT NULL
   );`,
  // Append-only logs kept to a length (the audit log, refusals), oldest dropped first.
  `CREATE TABLE events (
     seq INTEGER PRIMARY KEY AUTOINCREMENT,
     log TEXT NOT NULL,
     data TEXT NOT NULL
   );
   CREATE INDEX events_log ON events (log, seq);`,
  // LIKE ignores case; the prefix is compared exactly.
  `CREATE TABLE secrets_sealed (
     name TEXT PRIMARY KEY,
     sealed TEXT NOT NULL CHECK (substr(sealed, 1, 9) = 'cfsec:v1:')
   );
   INSERT INTO secrets_sealed (name, sealed) SELECT name, sealed FROM secrets;
   DROP TABLE secrets;
   ALTER TABLE secrets_sealed RENAME TO secrets;`,
  // Which files of the RetroArch pack the server placed itself (retro/pack-ledger.js). Kept here, not in the
  // index, because the index is thrown away when broken and a lost ledger would turn every file into the operator's.
  // A row belongs to one pack folder (root), so a file in another folder is never taken for the server's.
  `CREATE TABLE retro_pack_ledger (
     root TEXT NOT NULL,
     rel TEXT NOT NULL,
     sha256 TEXT NOT NULL,
     source TEXT NOT NULL,
     lock_version TEXT NOT NULL,
     PRIMARY KEY (root, rel)
   ) WITHOUT ROWID;`,
  // Each pack file's CRC-32 (what the libretro nightly index lists) and, for a file from a nightly build,
  // its build date. source is bundle, adopted (an official build found in place), extra or nightly.
  `ALTER TABLE retro_pack_ledger ADD COLUMN crc32 TEXT;
   ALTER TABLE retro_pack_ledger ADD COLUMN built TEXT;`,
  // Plugins (src/plugins/): what the operator switched on and how each one has behaved. Here, not in the index,
  // because the index is thrown away when broken and a lost row would switch every plugin back to its default.
  // fail_streak counts start failures across restarts, hook_streak consecutive hook failures; a plugin that is
  // cooling off skips hooks until cooldown_until, and cooldown_step says how long the next pause is.
  // variant_keys is a JSON list of the query keys its variants use, kept so a request still naming one after the
  // plugin went away is refused instead of getting the original file.
  `CREATE TABLE plugins (
     id TEXT PRIMARY KEY,
     enabled INTEGER NOT NULL DEFAULT 0,
     fail_streak INTEGER NOT NULL DEFAULT 0,
     hook_streak INTEGER NOT NULL DEFAULT 0,
     cooldown_step INTEGER NOT NULL DEFAULT 0,
     cooldown_until INTEGER,
     disabled_reason TEXT,
     disabled_at INTEGER,
     last_error TEXT,
     last_error_at INTEGER,
     version_seen TEXT,
     variant_keys TEXT NOT NULL DEFAULT '[]',
     updated_at INTEGER NOT NULL
   ) WITHOUT ROWID;`,
];

/**
 * Opens (and brings up to date) the database at `file`; ":memory:" for tests.
 * `private` keeps the file and its journal readable by the server's account only.
 */
export function openDatabase(file, { migrations = INDEX_MIGRATIONS, private: own = false } = {}) {
  if (file !== ":memory:") {
    fs.mkdirSync(path.dirname(file), { recursive: true, ...(own ? { mode: 0o700 } : {}) });
    // SQLite gives the -wal and -shm files the mode of the database file.
    if (own) {
      fs.chmodSync(path.dirname(file), 0o700);
      fs.closeSync(fs.openSync(file, "a", 0o600));
      fs.chmodSync(file, 0o600);
    }
  }
  const db = new DatabaseSync(file);
  // The wait first: another process opening the same file holds it for a moment.
  db.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
  const version = () => db.prepare("PRAGMA user_version").get().user_version;
  if (version() < migrations.length) {
    // Holds the write lock while it reads the version again, so two processes never run a step twice.
    db.exec("BEGIN IMMEDIATE");
    try {
      for (let i = version(); i < migrations.length; i++) {
        db.exec(migrations[i]);
        db.exec(`PRAGMA user_version = ${i + 1}`);
      }
      db.exec("COMMIT");
    } catch (err) {
      rollback(db);
      throw err;
    }
  }
  return db;
}

const depth = new WeakMap(); // db → how many transaction() calls are open on it

/**
 * Runs `fn` in one transaction: all of it lands, or none. Inside another, it
 * joins that one: then only the outermost call decides, and a caller that
 * catches an inner failure commits what the inner part wrote.
 */
export function transaction(db, fn) {
  if (depth.get(db)) {
    depth.set(db, depth.get(db) + 1);
    try {
      return fn();
    } finally {
      depth.set(db, depth.get(db) - 1);
    }
  }
  depth.set(db, 1);
  try {
    return outermost(db, fn);
  } finally {
    depth.delete(db);
  }
}

function outermost(db, fn) {
  db.exec("BEGIN");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (err) {
    rollback(db);
    throw err;
  }
}

/** Rolls back what is open; SQLite has already done it after a full disk or an I/O error. */
function rollback(db) {
  try {
    db.exec("ROLLBACK");
  } catch {
    // Nothing was open any more: the error that led here is the one to report.
  }
}
