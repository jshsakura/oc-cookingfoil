// Reads what a server under test kept in ${dataDir}/security/security.db.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const securityDbFile = (dataDir) => path.join(dataDir, "security", "security.db");

function query(dataDir, sql, ...args) {
  const file = securityDbFile(dataDir);
  if (!fs.existsSync(file)) return [];
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return db.prepare(sql).all(...args);
  } finally {
    db.close();
  }
}

/** The records of one kind, as { id: record }. */
export const records = (dataDir, kind) =>
  Object.fromEntries(query(dataDir, "SELECT id, data FROM records WHERE kind = ?", kind).map((r) => [r.id, JSON.parse(r.data)]));

/** The sealed text of a secret, or undefined. */
export const sealedSecret = (dataDir, name) => query(dataDir, "SELECT sealed FROM secrets WHERE name = ?", name)[0]?.sealed;

/** The saved settings, as { key: value }. */
export const savedSettings = (dataDir) => Object.fromEntries(query(dataDir, "SELECT key, value FROM settings").map((r) => [r.key, JSON.parse(r.value)]));

/** Every value in the file, as text, so a test can check a plain secret is in none of them. */
export const everything = (dataDir) =>
  ["records", "settings", "secrets"].flatMap((t) => query(dataDir, `SELECT * FROM ${t}`).map((r) => Object.values(r).join(" "))).join("\n");
