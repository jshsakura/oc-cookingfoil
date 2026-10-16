/**
 * Basic-auth accounts, managed from /admin.
 *
 * Persisted in the security database (one row an account) with scrypt hashes. On
 * the first start there are none yet, so the COOK_AUTH_USERS accounts are
 * imported with their current passwords — existing clients keep working.
 * From then on the database is the source of truth and the env is ignored.
 *
 * No accounts means no password lane, so the last account is only removed when
 * the operator explicitly asks for an open server.
 *
 * Each account is an admin (may open /admin) or a regular user. Accounts from
 * before roles existed count as admins, since any of them could reach /admin then.
 * The last enabled admin can't be disabled, demoted or removed.
 *
 * scrypt is deliberately slow, and basic auth re-checks on every request
 * (each icon, each download chunk). Successful checks are therefore cached by
 * a digest of the credentials; any change to an account clears the cache.
 * Request-path checks use verifyAsync so a wrong password never blocks the
 * event loop, and unknown names pay the same cost as known ones.
 */
import crypto from "crypto";
import debug from "../debug.js";
import { getUsersFromEnv } from "../authUsersParser.js";
import { hashPassword, DECOY_HASH, matches, matchesAsync } from "./password-hash.js";
import { done, markDone, recordStore } from "../db/security-stores.js";

const NAME_RE = /^[A-Za-z0-9._-]{1,32}$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;
const GENERATED_BYTES = 18; // 24 base64url characters
const VERIFIED_MAX = 1000;

/**
 * What the server writes as a console's `addedBy` for approvals no account made
 * (the admin page, COOK_DEVICE_AUTO_APPROVE=all, Telegram). No account may take
 * one of these names, or it would own those consoles.
 */
export const SYSTEM_APPROVERS = new Set(["admin", "auto", "telegram"]);

const accounts = new Map(); // name → { hash, enabled, createdAt, updatedAt }
const verified = new Set(); // sha256(name \0 password) of recent successful checks

export class UserError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function digest(name, password) {
  return crypto.createHash("sha256").update(`${name}\0${password}`).digest("base64");
}

function remember(key) {
  if (verified.size >= VERIFIED_MAX) verified.clear();
  verified.add(key);
}

let store = null;
const records = () =>
  (store ??= recordStore("user"));

function persist() {
  records().sync(accounts);
  // Once there were accounts, COOK_AUTH_USERS never brings any back, even after every one is removed.
  if (accounts.size) markDone("users-seeded");
}

/** Applies a change to memory and disk together, or not at all. */
function commit(change) {
  const before = new Map(accounts);
  verified.clear();
  change();
  try {
    persist();
  } catch (err) {
    accounts.clear();
    for (const [name, record] of before) accounts.set(name, record);
    throw err;
  }
}

function load() {
  const kept = records().load();
  for (const [name, record] of kept) accounts.set(name, record);
  if (kept.length) markDone("users-seeded");
  // Seeded from COOK_AUTH_USERS once: an admin who removes every account later does not get them back.
  if (kept.length || done("users-seeded")) return;
  const fromEnv = getUsersFromEnv() ?? {};
  const now = Date.now();
  for (const [name, password] of Object.entries(fromEnv)) {
    if (!NAME_RE.test(name)) {
      debug.error("users: skipped COOK_AUTH_USERS entry %O, names may use letters, digits, . _ -", name);
      continue;
    }
    accounts.set(name, { hash: hashPassword(password), enabled: true, createdAt: now, updatedAt: now });
  }
  if (accounts.size) {
    persist();
    markDone("users-seeded");
    debug.log("users: imported %d account(s) from COOK_AUTH_USERS", accounts.size);
  }
}

function validateName(name) {
  if (typeof name !== "string" || !NAME_RE.test(name)) {
    throw new UserError("invalid-name", "Use 1-32 letters, digits, dot, dash or underscore.");
  }
  // Per-device logins are named cf-xxxxxx; an account must never shadow one.
  if (/^cf-/i.test(name)) {
    throw new UserError("invalid-name", "Names starting with cf- are reserved for device logins.");
  }
  if (SYSTEM_APPROVERS.has(name.toLowerCase())) {
    throw new UserError("invalid-name", `"${name}" is reserved for the server's own approvals.`);
  }
}

function resolvePassword(password) {
  if (password == null || password === "") {
    return crypto.randomBytes(GENERATED_BYTES).toString("base64url");
  }
  if (typeof password !== "string" || password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
    throw new UserError("weak-password", `Passwords need ${MIN_PASSWORD}-${MAX_PASSWORD} characters.`);
  }
  return password;
}

function requireAccount(name) {
  const record = accounts.get(name);
  if (!record) throw new UserError("not-found", "No such user.");
  return record;
}

/** Whether this account exists and may sign in (owners of device logins are checked against it). */
export function isActive(name) {
  return accounts.get(name)?.enabled === true;
}

/**
 * A short fingerprint of the account's password, sealed into its web session:
 * a new password (or a disabled account) ends every session signed in with the old one.
 */
export function sessionStamp(name) {
  const record = accounts.get(name);
  if (!record?.enabled) return null;
  return crypto.createHash("sha256").update(String(record.hash)).digest("base64url").slice(0, 16);
}

export function hasUsers() {
  return accounts.size > 0;
}

export const ROLES = ["admin", "user"];
const roleOf = (record) => (record?.role === "user" ? "user" : "admin");

export function list() {
  return Array.from(accounts, ([name, r]) => ({
    name, enabled: r.enabled, role: roleOf(r), createdAt: r.createdAt, updatedAt: r.updatedAt,
  }));
}

/** Whether this account may open /admin (and is enabled). */
export function isAdmin(name) {
  const record = accounts.get(name);
  return Boolean(record?.enabled) && roleOf(record) === "admin";
}

/**
 * Refuse a change that would leave no enabled admin. Removing the very last
 * account is the exception: that opens the server, so nobody is locked out.
 */
function keepAnAdmin(name, after, { removing = false } = {}) {
  if (removing && accounts.size === 1) return;
  const others = [...accounts].some(([n, r]) => n !== name && r.enabled && roleOf(r) === "admin");
  if (!others && !(after.enabled && roleOf(after) === "admin")) {
    throw new UserError("last-admin", "At least one enabled admin account must remain.");
  }
}

export function setRole(name, role) {
  if (!ROLES.includes(role)) throw new UserError("invalid-role", "Role is admin or user.");
  const record = requireAccount(name);
  const next = { ...record, role, updatedAt: Date.now() };
  keepAnAdmin(name, next);
  commit(() => accounts.set(name, next));
}

/** Synchronous check for rare paths (websocket upgrade). */
export function verify(name, password) {
  const record = accounts.get(name);
  if (!record || !record.enabled || typeof password !== "string") return false;
  const key = digest(name, password);
  if (verified.has(key)) return true;
  if (!matches(record.hash, password)) return false;
  remember(key);
  return true;
}

/** Request-path check: never blocks the event loop, same cost for unknown names. */
export async function verifyAsync(name, password) {
  if (typeof name !== "string" || typeof password !== "string") return false;
  const record = accounts.get(name);
  const key = digest(name, password);
  if (record?.enabled && verified.has(key)) return true;
  const ok = await matchesAsync(record?.hash ?? DECOY_HASH, password);
  // Re-read: the account may have changed while the hash was computing.
  const current = accounts.get(name);
  if (!ok || !current?.enabled || current.hash !== record?.hash) return false;
  remember(key);
  return true;
}

/** Returns the password so the admin can hand it over once; it is not stored. */
export function add(name, password, role = "user") {
  validateName(name);
  if (accounts.has(name)) throw new UserError("exists", "That user already exists.");
  if (!ROLES.includes(role)) throw new UserError("invalid-role", "Role is admin or user.");
  const plain = resolvePassword(password);
  const now = Date.now();
  // The first account runs the server, whatever was asked.
  const effective = accounts.size === 0 ? "admin" : role;
  commit(() => accounts.set(name, { hash: hashPassword(plain), enabled: true, role: effective, createdAt: now, updatedAt: now }));
  return { name, password: plain, role: effective };
}

export function setPassword(name, password) {
  const record = requireAccount(name);
  const plain = resolvePassword(password);
  commit(() => accounts.set(name, { ...record, hash: hashPassword(plain), updatedAt: Date.now() }));
  return { name, password: plain };
}

export function setEnabled(name, enabled) {
  const record = requireAccount(name);
  const next = { ...record, enabled: Boolean(enabled), updatedAt: Date.now() };
  keepAnAdmin(name, next);
  commit(() => accounts.set(name, next));
}

/** Removing the last account turns the password lane off, so it must be asked for. */
export function remove(name, { allowEmpty = false } = {}) {
  requireAccount(name);
  if (accounts.size === 1 && !allowEmpty) {
    throw new UserError("last-user", "Removing the last account lets anyone connect without a password.");
  }
  keepAnAdmin(name, { enabled: false }, { removing: true });
  commit(() => accounts.delete(name));
}

load();
