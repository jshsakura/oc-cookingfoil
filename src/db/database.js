/**
 * The server's two SQLite files, both on the data disk (SSD):
 *
 *   cookingfoil.db         the index, used like a cache (below)
 *   security/security.db   accounts, console logins, tokens, settings and the
 *                          sealed secrets; the server's own state, 0600
 *
 * The index holds what a scan of the library folders found (saves, hand-placed
 * homebrew) and the content hashes of their files, so a restart answers at once
 * and a change found by the folder watch rewrites one row instead of a whole
 * listing. The folders stay the truth: the index can be deleted and rebuilt by
 * scanning them again, and a file is still checked on disk when it is
 * downloaded. The security database cannot: back it up with the data folder.
 *
 * node:sqlite (built into Node 22.13+), WAL, one connection per file.
 */
import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import { dataDir } from "../helpers/envs.js";

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
      fs.closeSync(fs.openSync(file, "a", 0o600));
      fs.chmodSync(file, 0o600);
    }
  }
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;");
  const done = db.prepare("PRAGMA user_version").get().user_version;
  for (let i = done; i < migrations.length; i++) {
    transaction(db, () => {
      db.exec(migrations[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
    });
  }
  return db;
}

/** Runs `fn` in one transaction: all of it lands, or none. */
export function transaction(db, fn) {
  db.exec("BEGIN");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

let shared = null;
/** The server's own index, ${COOK_DATA_DIR}/cookingfoil.db. */
export const appDb = () => (shared ??= openDatabase(path.join(dataDir, DB_FILE)));

let security = null;
/** The server's own state, ${COOK_DATA_DIR}/security/security.db. */
export const securityDb = () =>
  (security ??= openDatabase(path.join(dataDir, SECURITY_DB_FILE), { migrations: SECURITY_MIGRATIONS, private: true }));
