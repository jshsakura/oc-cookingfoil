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
