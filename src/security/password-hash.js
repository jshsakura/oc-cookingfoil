/**
 * scrypt password hashes shared by shop accounts and per-device logins.
 * Request-path checks use matchesAsync, which never blocks the event loop and
 * caps how many hashes run at once.
 */
import crypto from "crypto";
import { promisify } from "util";

const SCRYPT_KEYLEN = 32;
const MAX_CONCURRENT_HASHES = 4;
const scryptAsync = promisify(crypto.scrypt);

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

/** Checked against when a name is unknown, so it takes as long as a real one. */
export const DECOY_HASH = hashPassword(crypto.randomBytes(16).toString("hex"));

function splitHash(stored) {
  const [scheme, salt, key] = String(stored).split("$");
  if (scheme !== "scrypt" || !salt || !key) return null;
  return { salt: Buffer.from(salt, "base64"), key: Buffer.from(key, "base64") };
}

export function matches(stored, password) {
  const parts = splitHash(stored);
  if (!parts) return false;
  const actual = crypto.scryptSync(password, parts.salt, parts.key.length);
  return crypto.timingSafeEqual(actual, parts.key);
}

let hashing = 0;
const waiting = [];
async function withHashSlot(fn) {
  if (hashing >= MAX_CONCURRENT_HASHES) await new Promise((resolve) => waiting.push(resolve));
  hashing++;
  try {
    return await fn();
  } finally {
    hashing--;
    waiting.shift()?.();
  }
}

export async function matchesAsync(stored, password) {
  const parts = splitHash(stored);
  if (!parts) return false;
  const actual = await withHashSlot(() => scryptAsync(password, parts.salt, parts.key.length));
  return crypto.timingSafeEqual(actual, parts.key);
}
