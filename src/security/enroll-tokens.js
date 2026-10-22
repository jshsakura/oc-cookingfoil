/**
 * Enrollment tokens: what a downloaded CookingFoil client carries instead of a
 * password. A signed-in user downloads the client from the web page with one
 * baked into its config; a console spends it (POST /api/pair/enroll) for its
 * own access key, approved under that user.
 *
 *   token   cfe_<32 random bytes, base64url>   shown once, inside the download
 *   id      8 hex characters                   what lists show; names nothing secret
 *
 * A token works within TTL_MS of its download (counted from issue, even for a
 * record an older build saved with a longer expiry). With automatic approval
 * (`multi`) it enrolls every console that brings it, while the account has
 * enrolled fewer than ENROLL_MAX_PER_HOUR different consoles through
 * downloads in the last TTL_MS, counted across all its downloads; a fresh
 * download does not reset that count. The count is kept in its own ledger
 * (owner → [{ deviceKey, at }]) that only age trims, never the history's
 * MAX_KEPT, so issuing many downloads cannot push enrollments out of it. With manual
 * approval it works once: a second console is refused (used) and waits for
 * approval. A console that spent a token may spend it again within its hour
 * (respend: a console sometimes repeats its enroll seconds later), and that
 * does not count again. A record an older build saved with a `devices` list
 * loads as used. A new download ends the account's earlier tokens, used or
 * not; the consoles they enrolled stay approved and stay counted.
 *
 * Only the token's SHA-256 is kept, in the security database (0600), so the
 * file alone enrolls nothing. Spent and lapsed ones stay as history for
 * HISTORY_MS, the file at most MAX_KEPT. A console refused for any reason
 * waits for approval like one that has only the server address.
 */
import crypto from "crypto";
import { recordStore } from "../db/security-stores.js";

export const TTL_MS = 60 * 60 * 1000;
export const HISTORY_MS = 30 * 24 * 60 * 60 * 1000;
export const PREFIX = "cfe_";
/** Consoles one account may enroll through its downloads in any rolling TTL_MS. */
export const ENROLL_MAX_PER_HOUR = 5;
const TOKEN_RE = /^cfe_[A-Za-z0-9_-]{43}$/;
const MAX_KEPT = 500;

let saved = null; // sha256(token) → { id, owner, createdAt, expiresAt, usedAt?, deviceKey?, enrolled?: [{ deviceKey, at }], revokedAt? }

const hash = (token) => crypto.createHash("sha256").update(token).digest("hex");

let store = null;
const records = () =>
  (store ??= recordStore("enroll-token"));

const read = () => Object.fromEntries(records().load());

const all = () => (saved ??= read());

function persist() {
  records().sync(Object.entries(saved));
}

let ledgerStore = null;
let ledger = null; // owner → [{ deviceKey, at }] for the last TTL_MS
const ledgerRows = () => (ledgerStore ??= recordStore("enroll-ledger"));
const ledgerAll = () => (ledger ??= Object.fromEntries(ledgerRows().load()));

/** Note that `owner`'s download enrolled `deviceKey` at `now`, dropping entries older than TTL_MS. */
function noteEnrolled(owner, deviceKey, now) {
  const next = {};
  for (const [o, list] of Object.entries(ledgerAll())) {
    const kept = Array.isArray(list) ? list.filter((e) => now - e.at < TTL_MS) : [];
    if (kept.length) next[o] = kept;
  }
  next[owner] = [...(next[owner] ?? []), { deviceKey, at: now }];
  ledger = next;
  ledgerRows().sync(Object.entries(ledger));
}

/** When a record lapses: its stored expiry, but never later than TTL_MS after issue. */
const expiryOf = (r) => Math.min(r.expiresAt, r.createdAt + TTL_MS);

/** "waiting" | "used" | "expired" | "revoked" for a record at `now`. Pure. */
export function stateOf(r, now = Date.now()) {
  if (r.usedAt) return "used";
  if (r.revokedAt) return "revoked";
  return now >= expiryOf(r) ? "expired" : "waiting";
}

/** Why a record enrolls no new console: "revoked", "expired", "used" (spent, single-use), or null while it still may. Pure. */
function refusalOf(r, now, multi) {
  if (r.revokedAt) return "revoked";
  if (now >= expiryOf(r)) return "expired";
  if (r.usedAt && (!multi || r.devices)) return "used";
  return null;
}

/** The consoles a record enrolled, with when: [{ deviceKey, at }]. */
const enrolledBy = (r) => r.enrolled ?? (r.usedAt && r.deviceKey ? [{ deviceKey: r.deviceKey, at: r.usedAt }] : []);

/** The different consoles `owner` enrolled through downloads in the TTL_MS before `now`: the ledger, plus records an older build left. */
function enrolledLastHour(owner, now) {
  const keys = new Set();
  const list = ledgerAll()[owner];
  for (const e of Array.isArray(list) ? list : []) if (now - e.at < TTL_MS) keys.add(e.deviceKey);
  for (const r of Object.values(all())) {
    if (r.owner !== owner) continue;
    for (const e of enrolledBy(r)) if (now - e.at < TTL_MS) keys.add(e.deviceKey);
  }
  return keys;
}

/** The history is cut to HISTORY_MS and MAX_KEPT, newest first kept; waiting tokens are never cut (an account holds at most a few). */
function prune(now) {
  const entries = Object.entries(all());
  const waiting = entries.filter(([, r]) => stateOf(r, now) === "waiting");
  const past = entries
    .filter(([, r]) => stateOf(r, now) !== "waiting" && now - (r.usedAt ?? r.revokedAt ?? expiryOf(r)) < HISTORY_MS)
    .sort((a, b) => b[1].createdAt - a[1].createdAt)
    .slice(0, Math.max(0, MAX_KEPT - waiting.length));
  saved = Object.fromEntries([...waiting, ...past]);
}

/** A new token for `owner`: { token, id, expiresAt }. The token is never kept. Ends the account's earlier live ones. */
export function issue(owner, now = Date.now()) {
  if (typeof owner !== "string" || !owner) throw new Error("no owner");
  prune(now);
  const next = { ...saved };
  for (const [h, r] of Object.entries(saved)) {
    if (r.owner === owner && !r.revokedAt && now < expiryOf(r)) next[h] = { ...r, revokedAt: now };
  }
  const token = PREFIX + crypto.randomBytes(32).toString("base64url");
  const id = crypto.randomBytes(4).toString("hex");
  const expiresAt = now + TTL_MS;
  next[hash(token)] = { id, owner, createdAt: now, expiresAt };
  saved = next;
  persist();
  return { token, id, expiresAt };
}

/**
 * Spend `token` for the console `deviceKey`: { owner, id } when it enrolls it,
 * else null (unknown, spent, lapsed, ended, or already this console's: see respend).
 * Asked before anything is written: `canEnroll(owner)` false → { refused },
 * `full(owner)` true → { full } (the account holds all the consoles it may),
 * the account over ENROLL_MAX_PER_HOUR → { limit }; each with owner and id.
 * `multi` (automatic approval) lets one token enroll several consoles.
 */
export function spend(token, deviceKey, { canEnroll = () => true, full = () => false, multi = false, now = Date.now() } = {}) {
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return null;
  const h = hash(token);
  const r = all()[h];
  if (!r || refusalOf(r, now, multi)) return null;
  const taken = enrolledBy(r);
  if (taken.some((e) => e.deviceKey === deviceKey)) return null;
  const who = { owner: r.owner, id: r.id };
  if (!canEnroll(r.owner)) return { refused: true, ...who };
  if (full(r.owner)) return { full: true, ...who };
  const recent = enrolledLastHour(r.owner, now);
  // A console already counted this hour (it came back with a newer download) does not count again.
  if (!recent.has(deviceKey) && recent.size >= ENROLL_MAX_PER_HOUR) return { limit: true, ...who };
  const first = r.usedAt ? {} : { usedAt: now, deviceKey };
  saved = { ...saved, [h]: { ...r, ...first, enrolled: [...taken, { deviceKey, at: now }] } };
  persist();
  noteEnrolled(r.owner, deviceKey, now);
  return who;
}

/**
 * Spend `token` again for a console that already spent it: { owner, id } when
 * `deviceKey` is one it enrolled, its hour has not passed, it was not ended
 * and `canEnroll(owner)` still holds; { full } when the account has no room
 * for it any more; else null. Nothing is written, nothing counts again.
 */
export function respend(token, deviceKey, { canEnroll = () => true, full = () => false, now = Date.now() } = {}) {
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return null;
  const r = all()[hash(token)];
  if (!r?.usedAt || r.revokedAt || now >= expiryOf(r) || !enrolledBy(r).some((e) => e.deviceKey === deviceKey)) return null;
  if (!canEnroll(r.owner)) return null;
  return full(r.owner) ? { full: true, owner: r.owner, id: r.id } : { owner: r.owner, id: r.id };
}

/**
 * What became of `token` that no longer works: { owner, id, state, reason } for
 * one this server issued, else null. state is what lists show ("used",
 * "expired", "revoked", or "waiting"); reason is why it enrolls no new console
 * ("revoked", "expired", "used", or null while it still may). Spends nothing; a
 * console that holds a spent download names its account with it while it
 * waits for approval.
 */
export function lookup(token, now = Date.now(), { multi = false } = {}) {
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return null;
  const r = all()[hash(token)];
  return r ? { owner: r.owner, id: r.id, state: stateOf(r, now), reason: refusalOf(r, now, multi) } : null;
}

/** End a token that may still enroll, by its id; `owner` limits it to that account's. @returns {boolean} */
export function revoke(id, { owner, now = Date.now() } = {}) {
  const found = Object.entries(all()).find(([, r]) => r.id === id && (owner === undefined || r.owner === owner) && !r.revokedAt && now < expiryOf(r));
  if (!found) return false;
  saved = { ...saved, [found[0]]: { ...found[1], revokedAt: now } };
  persist();
  return true;
}

/** The tokens, newest first, with no secret in them; `owner` narrows to one account's. */
export function list({ owner, now = Date.now() } = {}) {
  return Object.values(all())
    .filter((r) => owner === undefined || r.owner === owner)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((r) => ({ id: r.id, owner: r.owner, createdAt: r.createdAt, expiresAt: expiryOf(r), state: stateOf(r, now), usedAt: r.usedAt ?? null, deviceKey: r.deviceKey ?? null }));
}

/** Tests start from an empty store. */
export function resetForTests() {
  saved = {};
  ledger = {};
}
