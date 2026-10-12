/**
 * Accounts that sign in with Google. Joining is by approval: the first sign-in
 * leaves the account "pending" until the admin approves it from /admin. The
 * owner's own address (COOK_ADMIN_EMAIL) is approved, as an admin, on its first
 * sign-in. Other accounts are regular users until the admin makes them admins.
 *
 * Only what is needed to tell accounts apart is kept: Google's account id
 * (`sub`) and the verified email. Stored in ${COOK_DATA_DIR}/security/google-accounts.json.
 */
import fs from "fs";
import path from "path";
import { adminEmail, dataDir } from "../helpers/envs.js";

const DIR = path.join(dataDir, "security");
const FILE = path.join(DIR, "google-accounts.json");
const MAX_ACCOUNTS = 1000;
export const STATUSES = ["pending", "approved", "disabled"];
export const ROLES = ["admin", "user"];

const accounts = new Map(); // sub → { sub, email, status, createdAt, approvedAt?, lastAt }

function load() {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf8"));
    for (const a of Object.values(parsed.accounts ?? {})) {
      if (a?.sub && STATUSES.includes(a.status)) accounts.set(a.sub, a);
    }
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
}

function persist() {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, accounts: Object.fromEntries(accounts) }, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
}

/** Replace one account on disk and in memory together. */
function put(record) {
  const before = accounts.get(record.sub);
  accounts.set(record.sub, record);
  try {
    persist();
  } catch (err) {
    if (before) accounts.set(record.sub, before);
    else accounts.delete(record.sub);
    throw err;
  }
  return record;
}

const isOwner = (email) => Boolean(adminEmail) && email.toLowerCase() === adminEmail.toLowerCase();

/**
 * Record a verified Google sign-in. A new account waits for approval unless it
 * is the owner's. Returns the account, or null when the server is full.
 */
export function signIn({ sub, email }, now = Date.now()) {
  const known = accounts.get(sub);
  if (known) return put({ ...known, email, lastAt: now });
  if (accounts.size >= MAX_ACCOUNTS) return null;
  const owner = isOwner(email);
  return put({ sub, email, status: owner ? "approved" : "pending", role: owner ? "admin" : "user", createdAt: now, ...(owner ? { approvedAt: now } : {}), lastAt: now });
}

export function get(sub) {
  const a = accounts.get(sub);
  return a ? { ...a } : null;
}

export function isApproved(sub) {
  return accounts.get(sub)?.status === "approved";
}

/** An approved account the admin made an admin: it may open /admin. */
export function isAdmin(sub) {
  const a = accounts.get(sub);
  return a?.status === "approved" && a.role === "admin";
}

export function setRole(sub, role) {
  const a = accounts.get(sub);
  if (!a || !ROLES.includes(role)) return false;
  put({ ...a, role });
  return true;
}

/** Every account, waiting ones first, then by email. */
export function list() {
  const rank = { pending: 0, approved: 1, disabled: 2 };
  return [...accounts.values()].map((a) => ({ ...a, role: a.role === "admin" ? "admin" : "user" })).sort((a, b) => rank[a.status] - rank[b.status] || a.email.localeCompare(b.email));
}

export function pendingCount() {
  let n = 0;
  for (const a of accounts.values()) if (a.status === "pending") n++;
  return n;
}

/** @returns {boolean} whether the account exists */
export function setStatus(sub, status, now = Date.now()) {
  const a = accounts.get(sub);
  if (!a || !STATUSES.includes(status)) return false;
  put({ ...a, status, ...(status === "approved" ? { approvedAt: now } : {}) });
  return true;
}

export function remove(sub) {
  const a = accounts.get(sub);
  if (!a) return false;
  accounts.delete(sub);
  try {
    persist();
  } catch (err) {
    accounts.set(sub, a);
    throw err;
  }
  return true;
}

load();
