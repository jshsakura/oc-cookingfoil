/**
 * Persistent security state — failures, lockouts, and a bounded audit log.
 *
 * Kept in the security database (db/database.js): the approved consoles, the
 * approval queue, failures, lockouts and per-user access a row each, the audit
 * log and the refusals as append-only logs. Writes are debounced so a burst of
 * auth failures doesn't thrash the disk, and a write touches only the rows that
 * changed and the log lines added since the last one. State survives container
 * restarts so attackers can't just bounce us to reset their failure count.
 */
import debug from "../debug.js";
import { envBool } from "../helpers/env-read.js";
import { alert } from "../helpers/alerts.js";
import { deviceCode } from "./pairing-link.js";
import { eventLog, recordStore } from "../db/security-stores.js";
import { securityDb, transaction } from "../db/database.js";

const FLUSH_DEBOUNCE_MS = 500;
// Steady traffic keeps pushing the debounce back; a change waits at most this long.
const FLUSH_MAX_WAIT_MS = 5000;
const AUDIT_MAX = 1000;
// Bound the pending-device map so a flood of pair/requests from random device
// keys can't balloon the state. Oldest-seen entries are evicted first.
const PENDING_MAX = 200;
// Denials are the operator's debugging trail — keep enough to see a pattern,
// few enough that a scanner can't grow the state without bound.
const DENIALS_MAX = 300;

const state = {
  failures: new Map(), // ip → { count, firstAt, lastAt, lastUser }
  lockouts: new Map(), // ip → { lockedAt, until, reason }
  access: new Map(),   // user → { firstAt, lastAt, count, lastIp, ips:{ip:lastAt} }
  // Consoles keep only what approval needs: no IP, no last-seen time, no client version.
  devices: new Map(),  // deviceKey → { label, addedAt, addedBy, accessKeyHash }
  pending: new Map(),  // deviceKey → { firstSeenAt, lastSeenAt, message? } (when it asked, to order and trim the queue; its note)
  // SHA-256 of the pairSecret a console sent with its request. Kept apart from
  // `pending` because approval drops the pending row, and the secret must
  // outlive it until the console takes its key.
  pairSecrets: new Map(), // deviceKey → sha256 hex
  audit: [],
  denials: [],         // newest-last ring of refusals (see security/deny.js)
  denialCounts: {},    // reason → total ever, so the dashboard can show trends
};

// The map of `state` each kind of record mirrors.
const KINDS = { failures: "failure", lockouts: "lockout", access: "access", devices: "device", pending: "pending-device", pairSecrets: "pair-secret" };

let tables = null;
const db = () => {
  if (tables) return tables;
  const rows = Object.fromEntries(Object.entries(KINDS).map(([field, kind]) => [field, recordStore(kind)]));
  return (tables = {
    rows,
    denialCounts: recordStore("denial-count"),
    audit: eventLog("audit", { max: AUDIT_MAX }),
    denials: eventLog("denials", { max: DENIALS_MAX }),
  });
};

// Log lines added (and whether the refusals were cleared) since the last write.
let unsaved = { audit: 0, denials: 0, denialsCleared: false };

let flushTimer = null;
let firstUnflushedAt = null;
// Writes wait until load() read the tables: an empty state written over them would delete every row.
let loaded = false;

/** The last `n` entries of `list` (none for 0). Pure. */
const tail = (list, n) => (n > 0 ? list.slice(-Math.min(n, list.length)) : []);

function write() {
  if (!loaded) return;
  const t = db();
  transaction(securityDb(), () => {
    for (const field of Object.keys(KINDS)) t.rows[field].sync(state[field]);
    t.denialCounts.sync(Object.entries(state.denialCounts));
    if (unsaved.denialsCleared) t.denials.clear();
    t.audit.append(tail(state.audit, unsaved.audit));
    t.denials.append(tail(state.denials, unsaved.denials));
  });
  unsaved = { audit: 0, denials: 0, denialsCleared: false };
}

// One synchronous transaction, so two flushes never overlap.
async function flush() {
  try {
    write();
  } catch (err) {
    // The transaction rolled back: what each table holds is read again before the next write.
    if (tables) for (const store of [...Object.values(tables.rows), tables.denialCounts]) store.forget();
    debug.error("security: state flush failed: %s", err.message);
  }
}

function scheduleFlush() {
  if (flushTimer) clearTimeout(flushTimer);
  firstUnflushedAt ??= Date.now();
  const wait = Math.max(0, Math.min(FLUSH_DEBOUNCE_MS, firstUnflushedAt + FLUSH_MAX_WAIT_MS - Date.now()));
  flushTimer = setTimeout(() => {
    flushTimer = null;
    firstUnflushedAt = null;
    flush().catch(() => {});
  }, wait);
  if (flushTimer.unref) flushTimer.unref();
}

// Earlier versions also kept each console's IP, last-seen time and client
// version; dropping them here clears them from disk at the next save.
const deviceRecord = ({ label = "", addedAt = null, addedBy = null, accessKeyHash = null } = {}) =>
  ({ label, addedAt, addedBy, accessKeyHash });
const pendingRecord = ({ firstSeenAt = null, lastSeenAt = null, message = null } = {}) =>
  ({ firstSeenAt, lastSeenAt, ...(typeof message === "string" && message ? { message: message.slice(0, 100) } : {}) });
const isSecretHash = (v) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);

/** Reads the state from the tables. Throws when it cannot: the server must not start without it. */
export async function load() {
  const t = db();
  const rows = (field, map = (v) => v) => new Map(t.rows[field].load().map(([k, v]) => [k, map(v)]));
  state.failures = rows("failures");
  state.lockouts = rows("lockouts");
  state.access = rows("access");
  state.devices = rows("devices", deviceRecord);
  state.pending = rows("pending", pendingRecord);
  state.pairSecrets = new Map([...rows("pairSecrets")].filter(([, v]) => isSecretHash(v)));
  state.audit = t.audit.load();
  state.denials = t.denials.load();
  state.denialCounts = Object.fromEntries(t.denialCounts.load());
  unsaved = { audit: 0, denials: 0, denialsCleared: false };
  loaded = true;
  debug.log(
    "security: state loaded (%d failure tracker(s), %d lockout(s))",
    state.failures.size,
    state.lockouts.size
  );

  // One-shot reset switch: COOK_RESET_LOCKOUTS=true clears all lockouts on
  // boot. Useful if the admin loses access. Failure counters also clear so
  // a previously-locked IP gets a clean slate.
  if (envBool("COOK_RESET_LOCKOUTS", false)) {
    const lockCount = state.lockouts.size;
    state.failures.clear();
    state.lockouts.clear();
    appendAudit({ kind: "reset", at: Date.now(), note: `cleared ${lockCount} lockouts` });
    debug.log("security: COOK_RESET_LOCKOUTS=true → cleared all lockouts");
    await flush();
  }
}

export function appendAudit(entry) {
  state.audit.push(entry);
  unsaved.audit++;
  if (state.audit.length > AUDIT_MAX) {
    state.audit.splice(0, state.audit.length - AUDIT_MAX);
  }
  scheduleFlush();
}

// ── Denials (the operator's "why was this refused?" trail) ─────────────────
// Written exclusively through security/deny.js so every refusal in the app
// lands here in one shape.

export function recordDenial(entry) {
  state.denials.push(entry);
  unsaved.denials++;
  if (state.denials.length > DENIALS_MAX) {
    state.denials.splice(0, state.denials.length - DENIALS_MAX);
  }
  const reason = entry?.reason ?? "unknown";
  state.denialCounts = {
    ...state.denialCounts,
    [reason]: (state.denialCounts[reason] ?? 0) + 1,
  };
  scheduleFlush();
}

/** Newest-first denials, optionally limited. `sinceMs` filters by age. */
export function denialsSnapshot({ limit = 100, sinceMs = null } = {}) {
  const cutoff = sinceMs ? Date.now() - sinceMs : null;
  const rows = state.denials.filter((d) => cutoff === null || (d.at ?? 0) >= cutoff);
  return {
    recent: rows.slice(-limit).reverse(),
    total: state.denials.length,
    counts: { ...state.denialCounts },
  };
}

export function clearDenials() {
  state.denials = [];
  unsaved = { ...unsaved, denials: 0, denialsCleared: true };
  scheduleFlush();
}

export function getFailure(ip) {
  return state.failures.get(ip) ?? null;
}

export function setFailure(ip, data) {
  state.failures.set(ip, data);
  scheduleFlush();
}

export function clearFailure(ip) {
  if (state.failures.delete(ip)) scheduleFlush();
}

export function isLocked(ip) {
  const entry = state.lockouts.get(ip);
  if (!entry) return false;
  if (entry.until !== null && entry.until !== undefined && Date.now() >= entry.until) {
    state.lockouts.delete(ip);
    scheduleFlush();
    return false;
  }
  return true;
}

/** Milliseconds left on the address's lockout: 0 when not locked, null when it has no end. */
export function lockRemainingMs(ip) {
  if (!isLocked(ip)) return 0;
  const until = state.lockouts.get(ip)?.until;
  return until === null || until === undefined ? null : Math.max(0, until - Date.now());
}

export function lock(ip, { reason, ttlMs }) {
  state.lockouts.set(ip, {
    lockedAt: Date.now(),
    until: ttlMs && ttlMs > 0 ? Date.now() + ttlMs : null,
    reason,
  });
  appendAudit({ kind: "lockout", ip, reason, at: Date.now(), ttlMs: ttlMs ?? null });
  scheduleFlush();
}

export function unlock(ip) {
  const removed = state.lockouts.delete(ip);
  state.failures.delete(ip);
  if (removed) {
    appendAudit({ kind: "unlock", ip, at: Date.now() });
    scheduleFlush();
  }
  return removed;
}

export function snapshot() {
  return {
    failures: Array.from(state.failures.entries()).map(([ip, v]) => ({ ip, ...v })),
    lockouts: Array.from(state.lockouts.entries()).map(([ip, v]) => ({ ip, ...v })),
    audit: state.audit.slice(-100),
  };
}

// ── Per-user access tracking (for the /admin dashboard) ─────────────────────
// Every successful authenticated request bumps the user's counters. Cheap
// in-memory mutation; persistence rides the same debounced flush as the rest.
export function recordAccess(user, ip) {
  if (!user) return;
  const now = Date.now();
  const prev = state.access.get(user) ?? { firstAt: now, lastAt: now, count: 0, ips: {} };
  prev.lastAt = now;
  prev.count += 1;
  prev.lastIp = ip;
  prev.ips = prev.ips ?? {};
  if (ip) prev.ips[ip] = now;
  state.access.set(user, prev);
  scheduleFlush();
}

export function accessSnapshot() {
  return Array.from(state.access.entries())
    .map(([user, v]) => ({
      user,
      firstAt: v.firstAt,
      lastAt: v.lastAt,
      count: v.count,
      lastIp: v.lastIp ?? null,
      ips: Object.entries(v.ips ?? {})
        .map(([ip, lastAt]) => ({ ip, lastAt }))
        .sort((a, b) => b.lastAt - a.lastAt),
    }))
    .sort((a, b) => b.lastAt - a.lastAt);
}

// ── Device pairing (CyberFoil) ──────────────────────────────────────────────
// `devices` holds APPROVED devices keyed by deviceKey (UID = SHA-256 of the
// console eMMC CID). Each stores only the ACCESS-KEY HASH, never the plaintext.
// `pending` holds device keys that knocked but aren't approved yet — surfaced
// in the admin dashboard so the operator can approve them.

export function isDeviceApproved(deviceKey) {
  return state.devices.has(deviceKey);
}

export function getDeviceAccessKeyHash(deviceKey) {
  return state.devices.get(deviceKey)?.accessKeyHash ?? null;
}

export function approveDevice(deviceKey, { label, addedBy, accessKeyHash }) {
  const now = Date.now();
  const prev = state.devices.get(deviceKey);
  state.devices.set(deviceKey, {
    label: label ?? prev?.label ?? "",
    addedAt: prev?.addedAt ?? now,
    addedBy: addedBy ?? prev?.addedBy ?? null,
    accessKeyHash,
  });
  state.pending.delete(deviceKey);
  appendAudit({ kind: "device-approve", deviceKey, label: label ?? null, addedBy: addedBy ?? null, at: now });
  scheduleFlush();
}

export function revokeDevice(deviceKey) {
  lastSeen.delete(deviceKey);
  const removed = state.devices.delete(deviceKey);
  // Dismissing a request that was never approved must stick across a restart too.
  const dismissed = state.pending.delete(deviceKey);
  const hadSecret = state.pairSecrets.delete(deviceKey);
  if (removed) appendAudit({ kind: "device-revoke", deviceKey, at: Date.now() });
  if (removed || dismissed || hadSecret) scheduleFlush();
  return removed;
}

/** Who approved a console ("admin", an account name, "auto"), or null. */
export function deviceAddedBy(deviceKey) {
  return state.devices.get(deviceKey)?.addedBy ?? null;
}

/**
 * The same console under a new device key (a client that now makes its key
 * from the console): its approval, name and access key move from `from` to
 * `to`, and `from` is gone. When `to` was approved meanwhile, its own record
 * stays and only takes the old name if it has none of its own.
 * @returns {boolean} whether there was anything to move
 */
export function rebindDevice(from, to) {
  const rec = state.devices.get(from);
  if (!rec || from === to) return false;
  const into = state.devices.get(to);
  const unnamed = !into?.label || into.label === "자동 등록";
  state.devices.set(to, into ? { ...into, label: unnamed ? rec.label : into.label } : rec);
  state.devices.delete(from);
  state.pending.delete(from);
  state.pending.delete(to);
  state.pairSecrets.delete(from);
  if (lastSeen.has(from)) lastSeen.set(to, Math.max(lastSeen.get(from), lastSeen.get(to) ?? 0));
  lastSeen.delete(from);
  appendAudit({ kind: "device-rebind", deviceKey: to, from, at: Date.now() });
  scheduleFlush();
  return true;
}

/** Whether a console is still waiting in the approval queue. */
export function isDevicePending(deviceKey) {
  return state.pending.has(deviceKey);
}

/** The note a waiting console sent with its request, or null. */
export function pendingMessage(deviceKey) {
  return state.pending.get(deviceKey)?.message ?? null;
}

/** Drop a console from the approval queue without approving it. */
export function dismissPending(deviceKey) {
  const dismissed = state.pending.delete(deviceKey);
  if (state.pairSecrets.delete(deviceKey) || dismissed) scheduleFlush();
}

/**
 * Remember the hash of the pairSecret a console asked with. The first one
 * wins: a later request with a different secret never replaces it, so a
 * stranger who learns the device key cannot swap in their own.
 * @returns {"set" | "same" | "conflict"}
 */
export function registerPairSecret(deviceKey, secretHash) {
  const prev = state.pairSecrets.get(deviceKey);
  if (prev) return prev === secretHash ? "same" : "conflict";
  state.pairSecrets.set(deviceKey, secretHash);
  scheduleFlush();
  return "set";
}

/** The stored pairSecret hash of a console, or null. */
export function pairSecretHash(deviceKey) {
  return state.pairSecrets.get(deviceKey) ?? null;
}

/** Forget a console's pairSecret (its key was taken). */
export function clearPairSecret(deviceKey) {
  if (state.pairSecrets.delete(deviceKey)) scheduleFlush();
}

/**
 * A console asking for approval; only when it asked is kept, plus the note it
 * sent, if any (a later note replaces it; a request without one keeps it).
 * `quiet` records it without an alert (pending-limit.js, past its hourly cap).
 */
export function recordPendingDevice(deviceKey, { message, quiet = false } = {}) {
  const now = Date.now();
  const prev = state.pending.get(deviceKey);
  const note = message === undefined ? prev?.message ?? null : message;
  state.pending.set(deviceKey, { firstSeenAt: prev?.firstSeenAt ?? now, lastSeenAt: now, ...(note ? { message: note } : {}) });
  if (state.pending.size > PENDING_MAX) evictOldestPending();
  scheduleFlush();
  if (!quiet && (!prev || (message && message !== prev.message))) {
    // The code is what the console shows on its screen; the note is the console's own words.
    alert("device", `기기 코드 ${deviceCode(deviceKey)}\n${note ? `메시지: ${note}\n` : ""}콘솔 화면의 코드와 같은지 확인한 뒤 승인합니다.`, { subject: `${deviceKey}:${note ?? ""}`, now, approval: { kind: "device", ref: deviceKey } });
  }
}

function evictOldestPending() {
  let oldestKey = null;
  let oldestAt = Infinity;
  for (const [key, v] of state.pending) {
    const seen = v.lastSeenAt ?? 0;
    if (seen < oldestAt) {
      oldestAt = seen;
      oldestKey = key;
    }
  }
  if (oldestKey !== null) {
    state.pending.delete(oldestKey);
    if (!state.devices.has(oldestKey)) state.pairSecrets.delete(oldestKey);
  }
}

// When each approved console last connected: memory only (never written to
// disk, no IP), so the admin page can say who is active since the last start.
const lastSeen = new Map();
const SEEN_GRAIN_MS = 60_000;

export function touchDevice(deviceKey, now = Date.now()) {
  if (!state.devices.has(deviceKey)) return;
  if (now - (lastSeen.get(deviceKey) ?? 0) >= SEEN_GRAIN_MS) lastSeen.set(deviceKey, now);
}

/** Rename an approved console. @returns {boolean} whether it exists */
export function renameDevice(deviceKey, label) {
  const d = state.devices.get(deviceKey);
  if (!d) return false;
  state.devices.set(deviceKey, { ...d, label: String(label ?? "").slice(0, 64).trim() });
  scheduleFlush();
  return true;
}

export function devicesSnapshot() {
  return {
    approved: Array.from(state.devices.entries())
      .map(([deviceKey, v]) => ({ deviceKey, label: v.label ?? "", addedAt: v.addedAt ?? null, addedBy: v.addedBy ?? null, lastSeenAt: lastSeen.get(deviceKey) ?? null }))
      .sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0)),
    pending: Array.from(state.pending.entries())
      .map(([deviceKey, v]) => ({ deviceKey, ...(v.message ? { message: v.message } : {}), firstSeenAt: v.firstSeenAt ?? null, lastSeenAt: v.lastSeenAt ?? null }))
      .sort((a, b) => (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0)),
  };
}

export async function shutdown() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  firstUnflushedAt = null;
  await flush();
}
