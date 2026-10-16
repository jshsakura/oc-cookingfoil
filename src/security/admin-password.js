/**
 * The admin password set on the admin page, kept as a scrypt hash in
 * the security database (db/database.js). It works beside
 * COOK_ADMIN_PASSWORD: either one opens the admin page. The plain password is
 * never stored or sent back.
 */
import path from "path";
import { dataDir } from "../helpers/envs.js";
import { hashPassword, matches as hashMatches } from "./password-hash.js";
import { recordStore } from "../db/security-stores.js";

const FILE = path.join(dataDir, "security", "admin-password.json");
export const MIN_LENGTH = 12;
export const MAX_LENGTH = 200;

let saved; // undefined until read; null when there is none

let store = null;
const records = () => (store ??= recordStore("admin-password", { legacy: { file: FILE, entries: (json) => (json?.hash ? [["admin", json]] : []) } }));

function hash() {
  if (saved !== undefined) return saved;
  saved = records().load()[0]?.[1]?.hash ?? null;
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
  records().sync([["admin", { hash: hashPassword(password), setAt: Date.now() }]]);
  saved = undefined;
}

export function clear() {
  records().sync([]);
  saved = undefined;
}

/** For tests. */
export function reset() {
  saved = undefined;
}
