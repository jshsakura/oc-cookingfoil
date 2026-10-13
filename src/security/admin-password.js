/**
 * The admin password set on the admin page, kept as a scrypt hash in
 * ${COOK_DATA_DIR}/security/admin-password.json (0600). It works beside
 * COOK_ADMIN_PASSWORD: either one opens the admin page. The plain password is
 * never stored or sent back.
 */
import fs from "fs";
import path from "path";
import { dataDir } from "../helpers/envs.js";
import { hashPassword, matches as hashMatches } from "./password-hash.js";

const FILE = path.join(dataDir, "security", "admin-password.json");
export const MIN_LENGTH = 12;
export const MAX_LENGTH = 200;

let saved; // undefined until read; null when there is none

function hash() {
  if (saved !== undefined) return saved;
  try {
    saved = JSON.parse(fs.readFileSync(FILE, "utf8")).hash ?? null;
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    saved = null;
  }
  return saved;
}

export const has = () => Boolean(hash());

/** Whether `input` is the saved password (false when none is saved). */
export function matches(input) {
  const h = hash();
  return Boolean(h) && typeof input === "string" && input.length > 0 && input.length <= MAX_LENGTH && hashMatches(h, input);
}

/** Saves a new password; throws when it is too short or too long. */
export function set(password) {
  if (typeof password !== "string" || password.length < MIN_LENGTH || password.length > MAX_LENGTH) {
    throw new Error(`password must be ${MIN_LENGTH} to ${MAX_LENGTH} characters`);
  }
  fs.mkdirSync(path.dirname(FILE), { recursive: true, mode: 0o700 });
  fs.writeFileSync(`${FILE}.tmp`, JSON.stringify({ version: 1, hash: hashPassword(password), setAt: Date.now() }), { mode: 0o600 });
  fs.renameSync(`${FILE}.tmp`, FILE);
  saved = undefined;
}

export function clear() {
  fs.rmSync(FILE, { force: true });
  saved = undefined;
}

/** For tests. */
export function reset() {
  saved = undefined;
}
