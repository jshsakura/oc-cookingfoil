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
import { dataDir } from "../helpers/envs.js";
import debug from "../debug.js";

import { DB_FILE, openDatabase, SECURITY_DB_FILE, SECURITY_MIGRATIONS } from "./schema.js";

export { DB_FILE, INDEX_MIGRATIONS, openDatabase, SECURITY_DB_FILE, SECURITY_MIGRATIONS, transaction } from "./schema.js";

// SQLite's "file is not a database" and "database disk image is malformed".
const BROKEN = new Set([11, 26]);

/**
 * Opens the index at `file`; one that is broken is deleted and made again, as
 * it only holds what the folders can tell again (the next scans fill it).
 */
export function openIndex(file) {
  let db = null;
  try {
    db = openDatabase(file);
    const { quick_check: verdict } = db.prepare("PRAGMA quick_check").get();
    if (verdict !== "ok") throw Object.assign(new Error(verdict), { errcode: 11 });
    return db;
  } catch (err) {
    if (!BROKEN.has(err.errcode)) throw err;
    try {
      db?.close();
    } catch {
      // Already unusable.
    }
    debug.error("index: %s is broken (%s); starting it again", path.basename(file), err.message);
    for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
    return openDatabase(file);
  }
}

let shared = null;
/** The server's own index, ${COOK_DATA_DIR}/cookingfoil.db. */
export const appDb = () => (shared ??= openIndex(path.join(dataDir, DB_FILE)));

let security = null;
/** The server's own state, ${COOK_DATA_DIR}/security/security.db. */
export const securityDb = () =>
  (security ??= openDatabase(path.join(dataDir, SECURITY_DB_FILE), { migrations: SECURITY_MIGRATIONS, private: true }));
