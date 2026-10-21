/**
 * Accounts that sign in with Google. Joining is by approval: the first sign-in
 * leaves the account "pending" until the admin approves it from /admin. The
 * owner's own address (COOK_ADMIN_EMAIL) is approved, as an admin, on its first
 * sign-in. Other accounts are regular users until the admin makes them admins.
 *
 * Only what is needed to tell accounts apart is kept: Google's account id
 * (`sub`) and the verified email. Stored in the security database (db/database.js).
 */
import { adminEmail } from "../helpers/envs.js";
import { recordStore } from "../db/security-stores.js";
import { alert } from "../helpers/alerts.js";

const MAX_ACCOUNTS = 1000;
export const STATUSES = ["pending", "approved", "disabled"];
export const ROLES = ["admin", "user"];

const accounts = new Map(); // sub → { sub, email, status, createdAt, approvedAt?, lastAt }

let store = null;
const records = () =>
  (store ??= recordStore("google-account"));

function load() {
  for (const [, a] of records().load()) {
    if (a?.sub && STATUSES.includes(a.status)) accounts.set(a.sub, a);
  }
}

function persist() {
  records().sync(accounts);
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

/**
 * An address shortened for an alert: enough for the admin to tell who it is,
 * without the whole address leaving for Telegram. "guest@example.org" -> "gu***@example.org". Pure.
 */
export function maskEmail(email) {
  const [local, domain] = String(email ?? "").split("@");
  if (!domain) return "알 수 없음";
  return `${local.slice(0, Math.min(2, Math.max(1, local.length - 1)))}***@${domain}`;
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
  if (!owner) alert("account", (t) => t("account", { email: maskEmail(email) }), { subject: sub, now, approval: { kind: "account", ref: sub } });
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
