/**
 * Per-device logins for clients that cannot scan a QR (CyberFoil, Tinfoil).
 *
 * A signed-in shop user (or the admin) issues one ID and password per console
 * and types them into that console. Each login:
 *   - is owned by the account that issued it, and stops working when that
 *     account is disabled or removed;
 *   - reaches the shop's content only (see device-login-scope.js), never the
 *     web pages that could issue more logins or approve consoles;
 *   - locks to the first console that uses it: CyberFoil sends its console ID
 *     (the UID header) on every request, so the same ID and password from a
 *     different console is refused;
 *   - can be revoked at any time by its owner or the admin.
 *
 * The password is shown once and only its scrypt hash is kept, in
 * the security database (db/database.js).
 */
import crypto from "crypto";
import { hashPassword, matchesAsync } from "./password-hash.js";
import * as users from "./users.js";
import { recordStore } from "../db/security-stores.js";

export const NAME_PREFIX = "cf-";
// Easy to read off a phone and type on the console keyboard: no 0/o, 1/l/i.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const NAME_CHARS = 6;
const PASSWORD_CHARS = 12; // 31^12, about 2^59
const NAME_RE = new RegExp(`^${NAME_PREFIX}[${ALPHABET}]{${NAME_CHARS}}$`);
const MAX_LOGINS = 500;
const VERIFIED_MAX = 500;

const logins = new Map(); // name → { hash, owner, label, createdAt, deviceKey } (no IP, no last-seen time)
const verified = new Set();

export class DeviceLoginError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function randomText(length) {
  const bytes = crypto.randomBytes(length * 2);
  let out = "";
  // Rejection sampling keeps every character equally likely.
  for (const byte of bytes) {
    if (byte >= 248) continue; // 248 = 8 × 31
    out += ALPHABET[byte % ALPHABET.length];
    if (out.length === length) return out;
  }
  return out + randomText(length - out.length);
}

let store = null;
const records = () => (store ??= recordStore("device-login"));

function persist() {
  records().sync(logins);
}


/** Applies a change to memory and disk together, or not at all. */
function commit(change) {
  const before = new Map(logins);
  verified.clear();
  change();
  try {
    persist();
  } catch (err) {
    logins.clear();
    for (const [name, record] of before) logins.set(name, record);
    throw err;
  }
}

function load() {
  // Earlier versions also kept each login's IP, last-seen time and client version; they are dropped here.
  let scrubbed = false;
  for (const [name, record] of records().load()) {
    const { hash, owner, label, createdAt, deviceKey } = record;
    logins.set(name, { hash, owner, label, createdAt, deviceKey: deviceKey ?? null });
    scrubbed ||= Object.keys(record).some((k) => !["hash", "owner", "label", "createdAt", "deviceKey"].includes(k));
  }
  if (scrubbed) persist();
}

/** The owner may still sign in: "admin" always, an account while it is enabled. */
function ownerActive(owner) {
  return owner === "admin" || users.isActive(owner);
}

export function isDeviceLoginName(name) {
  return typeof name === "string" && NAME_RE.test(name);
}

export function has(name) {
  return logins.has(name);
}

/** A short fingerprint of the login's password, or null: a token sealed with it ends when it changes. */
export function stamp(name) {
  const record = logins.get(name);
  return record ? crypto.createHash("sha256").update(String(record.hash)).digest("base64url").slice(0, 16) : null;
}

/** The login exists and its owner may still sign in. */
export function isActive(name) {
  const record = logins.get(name);
  return Boolean(record) && ownerActive(record.owner);
}

function publicRow(name, r) {
  return {
    name,
    owner: r.owner,
    label: r.label ?? "",
    createdAt: r.createdAt ?? null,
    deviceKey: r.deviceKey ?? null,
    active: ownerActive(r.owner),
  };
}

/** Every login, newest first; `owner` narrows it to one account's. */
export function list({ owner } = {}) {
  return Array.from(logins, ([name, r]) => publicRow(name, r))
    .filter((row) => owner === undefined || row.owner === owner)
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

/** Issue a login. Returns the password once; only its hash is kept. */
export function create({ owner, label = "" }) {
  if (typeof owner !== "string" || !owner) throw new DeviceLoginError("invalid-owner", "No owner.");
  if (logins.size >= MAX_LOGINS) throw new DeviceLoginError("too-many", "Too many device logins.");
  let name;
  do name = NAME_PREFIX + randomText(NAME_CHARS);
  while (logins.has(name) || users.isActive(name));
  const password = randomText(PASSWORD_CHARS);
  commit(() => logins.set(name, {
    hash: hashPassword(password),
    owner,
    label: String(label ?? "").slice(0, 64).trim(),
    createdAt: Date.now(),
    deviceKey: null,
  }));
  return { name, password };
}

/** Remove a login. `owner` limits it to that account's own logins. */
export function revoke(name, { owner } = {}) {
  const record = logins.get(name);
  if (!record || (owner !== undefined && record.owner !== owner)) {
    throw new DeviceLoginError("not-found", "No such device login.");
  }
  commit(() => logins.delete(name));
}

/** Request-path check: never blocks the event loop. */
export async function verifyAsync(name, password) {
  const record = logins.get(name);
  if (!record || typeof password !== "string" || !ownerActive(record.owner)) return false;
  const key = crypto.createHash("sha256").update(`${name}\0${password}`).digest("base64");
  if (verified.has(key)) return true;
  const ok = await matchesAsync(record.hash, password);
  // Re-read: the login may have been revoked while the hash was computing.
  if (!ok || logins.get(name)?.hash !== record.hash) return false;
  if (verified.size >= VERIFIED_MAX) verified.clear();
  verified.add(key);
  return true;
}

/**
 * Lock the login to the console presenting it. The first console ID seen is
 * kept; a different one afterwards is refused. A request without an ID (stock
 * Tinfoil may not send one) is let through.
 * @returns {"ok" | "other-console"}
 */
/** The device key a login is locked to, or null (no such login, or not locked yet). */
export function lockedTo(name) {
  return logins.get(name)?.deviceKey ?? null;
}

/** Move a login's console lock from `from` to `to`; only a login locked to `from` moves. @returns {boolean} */
export function reclaim(name, from, to) {
  const record = logins.get(name);
  if (!record || !from || !to || record.deviceKey !== from) return false;
  commit(() => logins.set(name, { ...record, deviceKey: to }));
  return true;
}

export function claim(name, deviceKey) {
  const record = logins.get(name);
  if (!record || !deviceKey) return "ok";
  if (!record.deviceKey) {
    commit(() => logins.set(name, { ...record, deviceKey }));
    return "ok";
  }
  return record.deviceKey === deviceKey ? "ok" : "other-console";
}


load();
