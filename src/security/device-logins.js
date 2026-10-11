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
 * ${COOK_DATA_DIR}/security/device-logins.json.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { dataDir } from "../helpers/envs.js";
import { hashPassword, matchesAsync } from "./password-hash.js";
import * as users from "./users.js";
import debug from "../debug.js";

const DIR = path.join(dataDir, "security");
const FILE = path.join(DIR, "device-logins.json");
export const NAME_PREFIX = "cf-";
// Easy to read off a phone and type on the Switch keyboard: no 0/o, 1/l/i.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const NAME_CHARS = 6;
const PASSWORD_CHARS = 12; // 31^12, about 2^59
const NAME_RE = new RegExp(`^${NAME_PREFIX}[${ALPHABET}]{${NAME_CHARS}}$`);
const MAX_LOGINS = 500;
const SEEN_FLUSH_MS = 5000;
const VERIFIED_MAX = 500;

const logins = new Map(); // name → { hash, owner, label, createdAt, deviceKey, lastSeenAt, lastIp, lastVersion }
const verified = new Set();
let flushTimer = null;

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

function persist() {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, logins: Object.fromEntries(logins) }, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
  fs.chmodSync(FILE, 0o600);
}

function flushSoon() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    try {
      persist();
    } catch (err) {
      debug.error("device-logins: could not save last-seen: %s", err.message);
    }
  }, SEEN_FLUSH_MS);
  flushTimer.unref?.();
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
  if (!fs.existsSync(FILE)) return;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch (err) {
    // Fail closed rather than silently dropping everyone's revocations.
    throw new Error(`device-logins: cannot read ${FILE} (${err.message}); fix or restore it before starting`);
  }
  for (const [name, record] of Object.entries(parsed?.logins ?? {})) logins.set(name, record);
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

function publicRow(name, r) {
  return {
    name,
    owner: r.owner,
    label: r.label ?? "",
    createdAt: r.createdAt ?? null,
    deviceKey: r.deviceKey ?? null,
    lastSeenAt: r.lastSeenAt ?? null,
    lastIp: r.lastIp ?? null,
    lastVersion: r.lastVersion ?? null,
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
    lastSeenAt: null,
    lastIp: null,
    lastVersion: null,
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
export function claim(name, deviceKey) {
  const record = logins.get(name);
  if (!record || !deviceKey) return "ok";
  if (!record.deviceKey) {
    commit(() => logins.set(name, { ...record, deviceKey }));
    return "ok";
  }
  return record.deviceKey === deviceKey ? "ok" : "other-console";
}

export function recordSeen(name, { ip, version } = {}) {
  const record = logins.get(name);
  if (!record) return;
  record.lastSeenAt = Date.now();
  if (ip) record.lastIp = ip;
  if (version) record.lastVersion = version;
  flushSoon();
}

load();
