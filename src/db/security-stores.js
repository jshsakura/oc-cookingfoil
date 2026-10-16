/**
 * What the security modules keep in security/security.db (db/database.js):
 *
 *   recordStore   one kind of record (accounts, console logins, tokens), a row each
 *   settingsStore the admin's saved settings, a row each
 *   secret*       values the server reads back, only ever sealed (secret-box.js)
 *
 * Each takes over the JSON file an earlier version kept, once, on first use;
 * the file is left where it is. A file that is there but does not read stops
 * the server rather than starting it with nothing (no accounts would leave it
 * open, no revocations would let a revoked console back in).
 */
import fs from "fs";
import path from "path";
import debug from "../debug.js";
import { securityDb, transaction } from "./database.js";
import { isSealed, open, readSealed, seal } from "../security/secret-box.js";

/** The parsed JSON in `file`, null when there is none. Throws when it is there but does not parse. */
function readLegacy(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${file} cannot be read (${err.message}); fix or restore it before starting`);
  }
}

/**
 * Runs `take()` the first time `db` sees `source`, in the same transaction as
 * noting it; `take` returns the name of what it took over, or null.
 */
export function takeOverOnce(source, take, { db = securityDb() } = {}) {
  importOnce(db, source, take);
}

/** The parsed JSON in `file`, or null when there is none or it does not read (logged). */
export function readLegacyLenient(file) {
  try {
    return readLegacy(file);
  } catch (err) {
    debug.error("security: %s", err.message);
    return null;
  }
}

function importOnce(db, source, take) {
  if (db.prepare("SELECT 1 FROM imports WHERE source = ?").get(source)) return;
  transaction(db, () => {
    const took = take();
    db.prepare("INSERT INTO imports (source, at) VALUES (?, ?)").run(source, Date.now());
    if (took) debug.log("security: took over %s", took);
  });
}

/**
 * The records of one `kind`. `legacy` is { file, entries(json) → [[id, record]],
 * lenient? } for the file an earlier version kept; `lenient` skips a file that
 * does not read (for records that only lapse, such as one-time links).
 */
export function recordStore(kind, { db = securityDb(), legacy = null } = {}) {
  const upsert = db.prepare("INSERT OR REPLACE INTO records (kind, id, data) VALUES (?, ?, ?)");
  const drop = db.prepare("DELETE FROM records WHERE kind = ? AND id = ?");
  if (legacy) {
    importOnce(db, `records:${kind}`, () => {
      let json;
      try {
        json = readLegacy(legacy.file);
      } catch (err) {
        if (!legacy.lenient) throw err;
        debug.error("security: %s", err.message);
        return null;
      }
      if (!json) return null;
      for (const [id, record] of legacy.entries(json)) upsert.run(kind, String(id), JSON.stringify(record));
      return path.basename(legacy.file);
    });
  }
  const read = () => new Map(db.prepare("SELECT id, data FROM records WHERE kind = ?").all(kind).map((r) => [r.id, r.data]));
  // What the table holds, as last read or written: sync() writes only what differs from it.
  let written = null;
  return {
    /** Every record as [id, record]. */
    load() {
      written = read();
      return [...written].map(([id, data]) => [id, JSON.parse(data)]);
    },
    /** Makes the table hold exactly `entries` ([id, record] pairs), in one transaction. Throws when it cannot. */
    sync(entries) {
      const next = new Map([...entries].map(([id, record]) => [String(id), JSON.stringify(record)]));
      written ??= read();
      transaction(db, () => {
        for (const id of written.keys()) if (!next.has(id)) drop.run(kind, id);
        for (const [id, data] of next) if (written.get(id) !== data) upsert.run(kind, id, data);
      });
      written = next;
    },
    /** After a failed write around a sync(): read the table again before the next one. */
    forget() {
      written = null;
    },
  };
}

/** The admin's saved settings: { load() → { key: value }, save(values) }. `legacyFile` is { settings: {...} }. */
export function settingsStore({ db = securityDb(), legacyFile = null } = {}) {
  const upsert = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
  if (legacyFile) {
    importOnce(db, "settings", () => {
      let json;
      try {
        json = readLegacy(legacyFile);
      } catch (err) {
        // Settings fall back to the compose values, as a broken file always did.
        debug.error("settings: %s", err.message);
        return null;
      }
      if (!json) return null;
      for (const [k, v] of Object.entries(json.settings ?? {})) upsert.run(k, JSON.stringify(v));
      return path.basename(legacyFile);
    });
  }
  return {
    load: () => Object.fromEntries(db.prepare("SELECT key, value FROM settings").all().map((r) => [r.key, JSON.parse(r.value)])),
    /** Makes the table hold exactly `values`. */
    save(values) {
      transaction(db, () => {
        db.prepare("DELETE FROM settings").run();
        for (const [k, v] of Object.entries(values)) upsert.run(k, JSON.stringify(v));
      });
    },
  };
}

/**
 * The plain bytes of secret `name`, or null when there is none. `legacyFile` is
 * the file an earlier version kept it in (sealed or not); it is taken over once.
 * A secret sealed with another key throws (SecretKeyError), never reads as missing.
 */
export function readSecret(name, { db = securityDb(), legacyFile = null } = {}) {
  if (legacyFile) {
    importOnce(db, `secret:${name}`, () => {
      if (!fs.existsSync(legacyFile)) return null;
      const plain = readSealed(legacyFile);
      if (plain === null) return null;
      db.prepare("INSERT OR REPLACE INTO secrets (name, sealed) VALUES (?, ?)").run(name, seal(plain));
      return path.basename(legacyFile);
    });
  }
  const row = db.prepare("SELECT sealed FROM secrets WHERE name = ?").get(name);
  if (!row) return null;
  if (!isSealed(row.sealed)) throw new Error(`secret ${name} is not sealed`);
  return open(row.sealed);
}

/** Seals `plain` (Buffer or string) and keeps it as secret `name`. */
export function writeSecret(name, plain, { db = securityDb() } = {}) {
  db.prepare("INSERT OR REPLACE INTO secrets (name, sealed) VALUES (?, ?)").run(name, seal(plain));
}

/** Forgets secret `name`. */
export function deleteSecret(name, { db = securityDb() } = {}) {
  db.prepare("DELETE FROM secrets WHERE name = ?").run(name);
}

/** readSecret for a JSON value. */
export function readSecretJson(name, opts) {
  const buf = readSecret(name, opts);
  return buf ? JSON.parse(buf.toString("utf8")) : null;
}

/** writeSecret for a JSON value. */
export function writeSecretJson(name, value, opts) {
  writeSecret(name, JSON.stringify(value), opts);
}

/** Whether `step` (a one-time step such as seeding accounts from the environment) was done. */
export const done = (step, { db = securityDb() } = {}) => Boolean(db.prepare("SELECT 1 FROM imports WHERE source = ?").get(`done:${step}`));

/** Notes `step` as done. */
export function markDone(step, { db = securityDb() } = {}) {
  db.prepare("INSERT OR IGNORE INTO imports (source, at) VALUES (?, ?)").run(`done:${step}`, Date.now());
}

/**
 * An append-only log called `name`, kept to its last `max` entries.
 */
export function eventLog(name, { max, db = securityDb() }) {
  const insert = db.prepare("INSERT INTO events (log, data) VALUES (?, ?)");
  const trim = db.prepare("DELETE FROM events WHERE log = ? AND seq <= (SELECT seq FROM events WHERE log = ? ORDER BY seq DESC LIMIT 1 OFFSET ?)");
  return {
    /** The kept entries, oldest first. */
    load: () => db.prepare("SELECT data FROM (SELECT seq, data FROM events WHERE log = ? ORDER BY seq DESC LIMIT ?) ORDER BY seq").all(name, max).map((r) => JSON.parse(r.data)),
    /** Adds `entries` (oldest first) and drops what falls past `max`. */
    append(entries) {
      if (!entries.length) return;
      transaction(db, () => {
        for (const e of entries) insert.run(name, JSON.stringify(e));
        trim.run(name, name, max);
      });
    },
    clear() {
      db.prepare("DELETE FROM events WHERE log = ?").run(name);
    },
  };
}
