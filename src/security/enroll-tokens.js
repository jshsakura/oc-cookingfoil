/**
 * Enrollment tokens: what a downloaded CookingFoil client carries instead of a
 * password. A signed-in user downloads the client from the web page with one
 * baked into its config; the console spends it once (POST /api/pair/enroll)
 * for its own access key, approved under that user.
 *
 *   token   cfe_<32 random bytes, base64url>   shown once, inside the download
 *   id      8 hex characters                   what lists show; names nothing secret
 *
 * A token works once, within TTL_MS of its download, in every approval mode:
 * a second console holding the same download is refused (used) and waits for
 * approval like a console that has only the server address. The console that
 * spent it may spend it again within the same hour (respend), since a console
 * sometimes repeats its enroll seconds later. The hour counts from issue even
 * for a record saved with a longer expiry by an older build. A record saved
 * with a `devices` list by an older build loads as used. Only the token's
 * SHA-256 is kept, in the security database (0600), so the file
 * alone enrolls nothing. Spent and lapsed ones stay as history for
 * HISTORY_MS; an account holds one unspent token at most (a new download
 * withdraws the account's earlier unspent ones), and the file at most MAX_KEPT.
 * A lapsed or withdrawn token is refused as a used one is, and the console
 * waits for approval the same way, so a short life costs nothing.
 */
import crypto from "crypto";
import { recordStore } from "../db/security-stores.js";

export const TTL_MS = 60 * 60 * 1000;
export const HISTORY_MS = 30 * 24 * 60 * 60 * 1000;
export const PREFIX = "cfe_";
const TOKEN_RE = /^cfe_[A-Za-z0-9_-]{43}$/;
const MAX_KEPT = 500;

let saved = null; // sha256(token) → { id, owner, createdAt, expiresAt, usedAt?, deviceKey?, revokedAt? }

const hash = (token) => crypto.createHash("sha256").update(token).digest("hex");

let store = null;
const records = () =>
  (store ??= recordStore("enroll-token"));

const read = () => Object.fromEntries(records().load());

const all = () => (saved ??= read());

function persist() {
  records().sync(Object.entries(saved));
}

/** When a record lapses: its stored expiry, but never later than TTL_MS after issue. */
const expiryOf = (r) => Math.min(r.expiresAt, r.createdAt + TTL_MS);

/** "waiting" | "used" | "expired" | "revoked" for a record at `now`. Pure. */
export function stateOf(r, now = Date.now()) {
  if (r.usedAt) return "used";
  if (r.revokedAt) return "revoked";
  return now >= expiryOf(r) ? "expired" : "waiting";
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

/** A new token for `owner`: { token, id, expiresAt }. The token is never kept. */
export function issue(owner, now = Date.now()) {
  if (typeof owner !== "string" || !owner) throw new Error("no owner");
  prune(now);
  const waiting = Object.entries(saved).filter(([, r]) => r.owner === owner && stateOf(r, now) === "waiting").sort((a, b) => a[1].createdAt - b[1].createdAt);
  const next = { ...saved };
  for (const [h, r] of waiting) next[h] = { ...r, revokedAt: now };
  const token = PREFIX + crypto.randomBytes(32).toString("base64url");
  const id = crypto.randomBytes(4).toString("hex");
  const expiresAt = now + TTL_MS;
  next[hash(token)] = { id, owner, createdAt: now, expiresAt };
  saved = next;
  persist();
  return { token, id, expiresAt };
}

/**
 * Spend `token` for the console `deviceKey`: { owner, id } when it was waiting,
 * else null (unknown, spent, lapsed or withdrawn alike). `canEnroll(owner)` is asked before it is spent,
 * so a token refused for another reason still works.
 */
export function spend(token, deviceKey, { canEnroll = () => true, now = Date.now() } = {}) {
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return null;
  const h = hash(token);
  const r = all()[h];
  if (!r || stateOf(r, now) !== "waiting") return null;
  if (!canEnroll(r.owner)) return { refused: true, owner: r.owner, id: r.id };
  saved = { ...saved, [h]: { ...r, usedAt: now, deviceKey } };
  persist();
  return { owner: r.owner, id: r.id };
}

/**
 * Spend `token` again for the console that already spent it: { owner, id } when
 * `deviceKey` is the one it went to, its hour has not passed, it was not
 * withdrawn and `canEnroll(owner)` still holds; else null. Nothing is written.
 */
export function respend(token, deviceKey, { canEnroll = () => true, now = Date.now() } = {}) {
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return null;
  const r = all()[hash(token)];
  if (!r?.usedAt || r.revokedAt || r.deviceKey !== deviceKey || now >= expiryOf(r)) return null;
  return canEnroll(r.owner) ? { owner: r.owner, id: r.id } : null;
}

/**
 * What became of `token` that no longer works: { owner, id, state } for one
 * this server issued ("used", "expired", "revoked", or "waiting"), else null.
 * Spends nothing; a console that holds a spent download names its account
 * with it while it waits for approval.
 */
export function lookup(token, now = Date.now()) {
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return null;
  const r = all()[hash(token)];
  return r ? { owner: r.owner, id: r.id, state: stateOf(r, now) } : null;
}

/** Withdraw an unspent token by its id; `owner` limits it to that account's. @returns {boolean} */
export function revoke(id, { owner, now = Date.now() } = {}) {
  const found = Object.entries(all()).find(([, r]) => r.id === id && (owner === undefined || r.owner === owner) && stateOf(r, now) === "waiting");
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
}
