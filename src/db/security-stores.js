/**
 * What the security modules keep in security/security.db (db/database.js):
 *
 *   recordStore   one kind of record (accounts, console logins, tokens), a row each
 *   settingsStore the admin's saved settings, a row each
 *   packLedger    the RetroArch pack files the server placed itself
 *   secret*       values the server reads back, only ever sealed (secret-box.js)
 */
import { securityDb, transaction } from "./database.js";
import { isSealed, open, seal } from "../security/secret-box.js";

/** The records of one `kind`. */
export function recordStore(kind, { db = securityDb() } = {}) {
  const upsert = db.prepare("INSERT OR REPLACE INTO records (kind, id, data) VALUES (?, ?, ?)");
  const drop = db.prepare("DELETE FROM records WHERE kind = ? AND id = ?");
  const read = () => new Map(db.prepare("SELECT id, data FROM records WHERE kind = ?").all(kind).map((r) => [r.id, r.data]));
  // What the table holds, as last read or written: sync() writes only what differs from it.
  let written = null;
  return {
    /** Every record as [id, record]. */
    load() {
      const rows = read();
      // Every row is parsed before any is trusted: a row that does not parse stops here, not halfway.
      const out = [...rows].map(([id, data]) => [id, JSON.parse(data)]);
      written = rows;
      return out;
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

/** The admin's saved settings: { load() → { key: value }, save(values) }. */
export function settingsStore({ db = securityDb() } = {}) {
  const upsert = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
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
 * The RetroArch pack files the server placed, kept per pack folder: `forRoot(root)` gives
 * { all() → Map rel → { sha256, source, lockVersion }, put(rows) in one transaction, drop(rel) }.
 * A file without a row in that folder's ledger is the operator's, whatever other folders hold.
 */
export function packLedger({ db = securityDb() } = {}) {
  const upsert = db.prepare("INSERT OR REPLACE INTO retro_pack_ledger (root, rel, sha256, source, lock_version, crc32, built) VALUES (?, ?, ?, ?, ?, ?, ?)");
  return {
    forRoot: (root) => ({
      /** rel → { sha256, source, lockVersion, crc32, built } (crc32 and built null when not known). */
      all: () => new Map(db.prepare("SELECT rel, sha256, source, lock_version, crc32, built FROM retro_pack_ledger WHERE root = ?").all(root).map((r) => [r.rel, { sha256: r.sha256, source: r.source, lockVersion: r.lock_version, crc32: r.crc32 ?? null, built: r.built ?? null }])),
      put(rows) {
        transaction(db, () => { for (const r of rows) upsert.run(root, r.rel, r.sha256, r.source, r.lockVersion, r.crc32 ?? null, r.built ?? null); });
      },
      drop: (rel) => db.prepare("DELETE FROM retro_pack_ledger WHERE root = ? AND rel = ?").run(root, rel),
    }),
  };
}

/**
 * The plain bytes of secret `name`, or null when there is none. A secret sealed
 * with another key throws (SecretKeyError), never reads as missing.
 */
export function readSecret(name, { db = securityDb() } = {}) {
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
