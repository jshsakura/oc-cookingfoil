/**
 * Secrets at rest: every file under ${COOK_DATA_DIR}/security/ that holds a
 * value the server must read back (signing keys, the admin TOTP secret, the
 * Google and IGDB client secrets) is sealed with AES-256-GCM under a key that
 * lives outside the data folder, in COOK_SECRET_KEY (32 bytes, base64 or hex).
 * A copy or backup of the data folder alone gives none of them away.
 *
 *   cfsec:v1:<base64(iv[12] || tag[16] || ciphertext)>
 *
 * The key is required: without it the server does not start (assertKey, at
 * boot). A file still in plain text from before is read once, sealed in place
 * and never written in the clear again. A sealed file that does not open (the
 * wrong key) is an error, never treated as missing, so nothing is regenerated
 * over it.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import debug from "../debug.js";

const PREFIX = "cfsec:v1:";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class SecretKeyError extends Error {}

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
  if (!parsed) throw new SecretKeyError("COOK_SECRET_KEY 가 없거나 32바이트 키가 아닙니다. `openssl rand -base64 32` 로 만든 값을 넣습니다.");
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
    throw new SecretKeyError("암호화된 비밀값을 열지 못했습니다. COOK_SECRET_KEY 가 이 데이터를 만든 키와 다릅니다.");
  }
}

/** Writes `plain` sealed to `file` (0600, tmp + rename). */
export function writeSealed(file, plain) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, seal(plain) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/**
 * The plain bytes of `file`, or null when it does not exist. A file from
 * before sealing is read as it is and sealed in place at once.
 */
export function readSealed(file) {
  let text;
  try {
    text = fs.readFileSync(file);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
  const line = text.toString("utf8").trim();
  if (isSealed(line)) return open(line);
  writeSealed(file, text);
  debug.log("secrets: sealed %s", path.basename(file));
  return text;
}

/** readSealed for a JSON file: the parsed value, or null when missing. */
export function readSealedJson(file) {
  const buf = readSealed(file);
  return buf ? JSON.parse(buf.toString("utf8")) : null;
}

/** writeSealed for a JSON value. */
export function writeSealedJson(file, value) {
  writeSealed(file, JSON.stringify(value));
}
