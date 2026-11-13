/**
 * Secrets at rest: every value the server must read back (signing keys, the
 * admin TOTP secret, the Google and IGDB client secrets) is sealed with
 * AES-256-GCM under a key that lives outside the data folder, in
 * COOK_SECRET_KEY (32 bytes, base64 or hex), and kept sealed in the security
 * database (db/security-stores.js). A copy or backup of the data folder alone
 * gives none of them away.
 *
 *   cfsec:v1:<base64(iv[12] || tag[16] || ciphertext)>
 *
 * The key is required: without it the server does not start (assertKey, at
 * boot). A value that does not open (the wrong key) is an error, never treated
 * as missing, so nothing is regenerated over it.
 */
import crypto from "crypto";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";

const PREFIX = "cfsec:v1:";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class SecretKeyError extends Error {
  name = "SecretKeyError";
}

/** The 32-byte key from `raw` (base64 or hex), or null when it is not one. Pure. */
export function parseKey(raw) {
  const s = String(raw ?? "").trim();
  if (/^[0-9a-f]{64}$/i.test(s)) return Buffer.from(s, "hex");
  if (/^[A-Za-z0-9+/_-]{42,44}={0,2}$/.test(s)) {
    const buf = Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    if (buf.length === 32) return buf;
  }
  return null;
}

let cachedKey = null;
function key() {
  if (cachedKey) return cachedKey;
  const parsed = parseKey(process.env.COOK_SECRET_KEY);
  if (!parsed) throw new SecretKeyError("COOK_SECRET_KEY is missing or is not a 32-byte key. Put one in .env, made with `openssl rand -base64 32`.");
  return (cachedKey = parsed);
}

/** At boot: throws SecretKeyError when the key is missing or malformed. */
export function assertKey() {
  key();
}

/** Tests change the key between cases. */
export function resetKeyForTests() {
  cachedKey = null;
  backupKeys = null;
}

export const isSealed = (text) => typeof text === "string" && text.startsWith(PREFIX);

/** `plain` (Buffer or string) sealed into one line of text. */
export function seal(plain) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(Buffer.isBuffer(plain) ? plain : Buffer.from(String(plain), "utf8")), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}

/** The plain bytes of a sealed line. Throws when it was sealed with another key or was altered. */
export function open(text) {
  if (!isSealed(text)) throw new Error("not a sealed secret");
  const raw = Buffer.from(text.slice(PREFIX.length), "base64");
  if (raw.length < IV_BYTES + TAG_BYTES) throw new Error("sealed secret is cut short");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), raw.subarray(0, IV_BYTES));
  decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  try {
    return Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
  } catch {
    throw new SecretKeyError("A sealed secret did not open: COOK_SECRET_KEY is not the key this data was made with.");
  }
}

/*
 * Console backup secrets (backups/secrets.js): a Vita's work.bin, .rif and license.db, files bound to its
 * owner's account. Each is sealed on its own with XChaCha20-Poly1305 under a key drawn from COOK_SECRET_KEY by
 * HKDF for this use only, and bound by its associated data to where it belongs (the account, platform, unit,
 * version and path), so a sealed file moved to another place does not open.
 *
 *   [format 1][key id, 4 bytes][nonce, 24 bytes][ciphertext and tag]
 *
 * The key id says which COOK_SECRET_KEY sealed it: a file sealed under another key is told apart from a damaged
 * one before anything is tried.
 */
const BACKUP_FORMAT = 1;
const BACKUP_HEAD = 1 + 4 + 24;
let backupKeys = null;

function backupKey() {
  if (backupKeys?.of === key()) return backupKeys;
  const derive = (info, n) => Buffer.from(crypto.hkdfSync("sha256", key(), Buffer.alloc(0), info, n));
  backupKeys = { of: key(), key: derive("cookingfoil console backup secrets v1", 32), id: derive("cookingfoil console backup key id v1", 4) };
  return backupKeys;
}

/** A sealed backup secret that does not open here: another COOK_SECRET_KEY made it, or it was altered. */
export class SecretLostError extends Error {
  name = "SecretLostError";
}

/** Which key seals backup secrets now, as 8 hex digits: a check value, never the key. */
export const backupKeyId = () => backupKey().id.toString("hex");

const backupAad = (id, place) => Buffer.from(JSON.stringify([BACKUP_FORMAT, id.toString("hex"), ...place]), "utf8");

/** `plain` sealed for `place` (an array of strings naming where it belongs). */
export function sealBackupSecret(plain, place) {
  const { key: k, id } = backupKey();
  const nonce = crypto.randomBytes(24);
  const sealed = xchacha20poly1305(k, nonce, backupAad(id, place)).encrypt(plain);
  return Buffer.concat([Buffer.from([BACKUP_FORMAT]), id, nonce, sealed]);
}

/** The plain bytes of a backup secret sealed for `place`. Throws SecretLostError when it does not open here. */
export function openBackupSecret(sealed, place) {
  const { key: k, id } = backupKey();
  if (sealed.length < BACKUP_HEAD + 16 || sealed[0] !== BACKUP_FORMAT || !sealed.subarray(1, 5).equals(id)) throw new SecretLostError("sealed under another key");
  try {
    return Buffer.from(xchacha20poly1305(k, sealed.subarray(5, BACKUP_HEAD), backupAad(id, place)).decrypt(sealed.subarray(BACKUP_HEAD)));
  } catch {
    throw new SecretLostError("does not open for this place");
  }
}
