/**
 * A Vita's secret files (work.bin, .rif, license.db) at rest: each sealed on its own (security/secret-box.js),
 * bound to its account, platform, unit, version and path, under a name made from its path, never from what is
 * in it. Only that account's Vita consoles are given one back (routes/backups.js); everywhere else they are a
 * count.
 */
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { sealBackupSecret, openBackupSecret, SecretLostError, backupKeyId } from "../security/secret-box.js";
import * as store from "./store.js";

export { SecretLostError };

/** Where a secret belongs, as the sealing binds it. */
export const secretPlace = (accountId, platform, key, version, file) => [accountId, platform, key, String(version), file];

export const sealSecret = (plain, place) => sealBackupSecret(plain, place);

export const secretName = (file) => `${crypto.createHash("sha256").update(`secret path\0${file}`).digest("hex").slice(0, 32)}.sealed`;

/** The plain bytes of one secret of a version, or null when that version has no such secret. */
export async function readSecret(accountId, platform, key, version, file) {
  const sealed = await fsp.readFile(path.join(store.secretDir(accountId, platform, key, version), secretName(file))).catch((err) => {
    if (err.code === "ENOENT") return null;
    throw err;
  });
  return sealed ? openBackupSecret(sealed, secretPlace(accountId, platform, key, version, file)) : null;
}

// The check value of the key secrets are sealed with, kept beside the backups: the import tool stops when the
// key it was given is not the one the server seals with.
const CHECK_FILE = ".key-check";

/** Writes the check value when there is none; returns whether the key now in use matches it. */
export async function keyMatches() {
  const file = path.join(store.backupsRoot(), CHECK_FILE);
  const kept = (await fsp.readFile(file, "utf8").catch(() => "")).trim();
  if (!kept) {
    await fsp.writeFile(file, `${backupKeyId()}\n`, { mode: 0o600 });
    return true;
  }
  return kept === backupKeyId();
}
