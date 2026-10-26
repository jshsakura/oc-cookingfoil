/**
 * Persistent security state — failures, lockouts, and a bounded audit log.
 *
 * Kept in the security database (db/database.js): the approved consoles and
 * their activity, accounts' last sign-ins, the approval queue, failures,
 * lockouts and per-user access a row each, the audit log and the refusals as
 * append-only logs. Writes are debounced so a burst of
 * auth failures doesn't thrash the disk, and a write touches only the rows that
 * changed and the log lines added since the last one. State survives container
 * restarts so attackers can't just bounce us to reset their failure count.
 */
import { emitPluginEvent } from "../plugins/emit.js";
import { translator } from "../helpers/alert-messages.js";
import debug from "../debug.js";
import { envBool } from "../helpers/env-read.js";
import { alert } from "../helpers/alerts.js";
import { deviceCode } from "./pairing-link.js";
import { dropRepair } from "./pairing-repair.js";
import { isLoopbackIp, isPrivateIp } from "./net.js";
import { doneAt, eventLog, markDone, recordStore } from "../db/security-stores.js";
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
  // Consoles keep only what approval needs; when and from where they connect is `activity`.
  devices: new Map(),  // deviceKey → { label, addedAt, addedBy, accessKeyHash, admin? }
  // Approved consoles only. Each day counts its requests, the addresses they came from (up to
  // IPS_PER_DAY, each with its count) and the requests from any further address as `other`.
  activity: new Map(), // deviceKey → { lastSeenAt, lastIp, days: { "YYYY-MM-DD": { n, ips: { ip: n }, other } } }
  // An account's last sign-in, and its sign-ins of the last LOGIN_DAYS days, LOGIN_HISTORY_MAX at most, oldest first.
  logins: new Map(),   // account (name, or "google:<sub>") → { at, method, ip, history: [{ at, method, ip }] }
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
const KINDS = { failures: "failure", lockouts: "lockout", access: "access", devices: "device", activity: "device-activity", logins: "account-login", pending: "pending-device", pairSecrets: "pair-secret" };

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
// `admin` (an admin device, see device-admin.js) is kept only while it is on.
const deviceRecord = ({ label = "", addedAt = null, addedBy = null, accessKeyHash = null, admin = false } = {}) =>
  ({ label, addedAt, addedBy, accessKeyHash, ...(admin === true ? { admin: true } : {}) });
const DOWNLOAD_STATES = new Set(["waiting", "used", "expired", "revoked"]);
const pendingDownloadRecord = (d) =>
  d && typeof d.owner === "string" && d.owner && DOWNLOAD_STATES.has(d.state)
    ? { owner: d.owner.slice(0, 200), id: String(d.id ?? "").slice(0, 16), state: d.state }
    : null;
const pendingRecord = ({ firstSeenAt = null, lastSeenAt = null, message = null, name = null, download = null } = {}) => {
  const owned = pendingDownloadRecord(download);
  return {
    firstSeenAt, lastSeenAt,
    ...(typeof message === "string" && message ? { message: message.slice(0, 100) } : {}),
    ...(typeof name === "string" && name ? { name: name.slice(0, 64) } : {}),
    ...(owned ? { download: owned } : {}),
  };
};
const isSecretHash = (v) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);

const DAY_MS = 24 * 60 * 60 * 1000;
// How long a console's daily request counts are kept, today included.
const ACTIVITY_DAYS = 90;
const DAY_RE = /^\d{4}-\d\d-\d\d$/;
// Addresses kept per console per day; requests from any more count as `other`.
const IPS_PER_DAY = 8;
const IP_MAX = 64;
const LOGIN_METHODS = ["password", "google", "console"];
const LOGIN_HISTORY_MAX = 100;
const LOGIN_DAYS = 90;

/** The server's local calendar day of `ms`, as YYYY-MM-DD. Pure. */
function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The days of `days` inside the kept window that ends at `now`. Pure. */
const keptDays = (days, now) => {
  const from = dayKey(now - (ACTIVITY_DAYS - 1) * DAY_MS);
  return Object.fromEntries(Object.entries(days).filter(([day]) => day >= from));
};

const isCount = (n) => Number.isInteger(n) && n > 0;
const ipOrNull = (ip) => (typeof ip === "string" && ip ? ip.slice(0, IP_MAX) : null);

/** `ips` with at most IPS_PER_DAY addresses, the busiest kept; the rest fold into `other`. Pure. */
function cappedDay(n, ips, other) {
  const ranked = Object.entries(ips).sort(([, a], [, b]) => b - a);
  const folded = ranked.slice(IPS_PER_DAY).reduce((sum, [, c]) => sum + c, 0);
  return { n, ips: Object.fromEntries(ranked.slice(0, IPS_PER_DAY)), other: other + folded };
}

/** A stored day: a count from before addresses were kept by day, or { n, ips, other }; null when invalid. Pure. */
function dayRecord(v) {
  if (isCount(v)) return { n: v, ips: {}, other: 0 };
  if (!v || !isCount(v.n)) return null;
  const ips = Object.entries(v.ips ?? {}).filter(([ip, c]) => ip && ip.length <= IP_MAX && isCount(c));
  return cappedDay(v.n, Object.fromEntries(ips), isCount(v.other) ? v.other : 0);
}

/** `day` with one more request, from `ip` when it is known. Pure. */
function countRequest(day = { n: 0, ips: {}, other: 0 }, ip) {
  const n = day.n + 1;
  if (!ip) return { ...day, n };
  if (ip in day.ips) return { ...day, n, ips: { ...day.ips, [ip]: day.ips[ip] + 1 } };
  if (Object.keys(day.ips).length < IPS_PER_DAY) return { ...day, n, ips: { ...day.ips, [ip]: 1 } };
  return { ...day, n, other: day.other + 1 };
}

// An address is kept as long as the history is: one last seen longer ago is dropped with it.
const fresh = (at, now) => Number.isFinite(at) && at > now - ACTIVITY_DAYS * DAY_MS;

const activityRecord = ({ lastSeenAt = null, lastIp = null, days = {} } = {}, now = Date.now()) => ({
  lastSeenAt: Number.isFinite(lastSeenAt) ? lastSeenAt : null,
  lastIp: fresh(lastSeenAt, now) ? ipOrNull(lastIp) : null,
  days: keptDays(Object.fromEntries(Object.entries(days ?? {})
    .filter(([day]) => DAY_RE.test(day)).map(([day, v]) => [day, dayRecord(v)]).filter(([, v]) => v)), now),
});

/** One console's activity under two keys, as one (device-key rebind). Pure. */
function mergeActivity(a, b) {
  if (!a || !b) return a ?? b ?? null;
  const days = { ...a.days };
  for (const [day, d] of Object.entries(b.days)) {
    const into = days[day];
    if (!into) { days[day] = d; continue; }
    const ips = { ...into.ips };
    for (const [ip, c] of Object.entries(d.ips)) ips[ip] = (ips[ip] ?? 0) + c;
    days[day] = cappedDay(into.n + d.n, ips, into.other + d.other);
  }
  const [newer, older] = (a.lastSeenAt ?? 0) >= (b.lastSeenAt ?? 0) ? [a, b] : [b, a];
  return { lastSeenAt: newer.lastSeenAt, lastIp: newer.lastIp ?? older.lastIp, days };
}

const loginEntry = ({ at = null, method = null, ip = null } = {}) =>
  Number.isFinite(at) && LOGIN_METHODS.includes(method) ? { at, method, ip: ipOrNull(ip) } : null;

/** The sign-ins of `history` inside the kept window that ends at `now`, LOGIN_HISTORY_MAX at most. Pure. */
const keptLogins = (history, now) => history.filter((e) => e.at > now - LOGIN_DAYS * DAY_MS).slice(-LOGIN_HISTORY_MAX);

/** A stored sign-in record; one from before the history was kept starts its history with its last sign-in. Pure. */
function loginRecord(v = {}, now = Date.now()) {
  const last = loginEntry(v ?? {});
  if (!last) return null;
  const history = Array.isArray(v.history) ? v.history.map((e) => loginEntry(e ?? {})).filter(Boolean) : [last];
  return { ...last, ip: fresh(last.at, now) ? last.ip : null, history: keptLogins(history, now) };
}

/** Reads the state from the tables. Throws when it cannot: the server must not start without it. */
export async function load() {
  const t = db();
  const rows = (field, map = (v) => v) => new Map(t.rows[field].load().map(([k, v]) => [k, map(v)]));
  state.failures = rows("failures");
  state.lockouts = rows("lockouts");
  state.access = rows("access");
  state.devices = rows("devices", deviceRecord);
  // A console no longer approved leaves no activity behind.
  state.activity = new Map([...rows("activity", (v) => activityRecord(v))].filter(([k]) => state.devices.has(k)));
  state.logins = new Map([...rows("logins", loginRecord)].filter(([, v]) => v));
  pruneTimer ??= setInterval(() => pruneAccessHistory(), DAY_MS);
  pruneTimer.unref?.();
  if (doneAt("device-activity") === null) markDone("device-activity");
  activitySince = doneAt("device-activity");
  state.pending = rows("pending", pendingRecord);
  // A secret stays only with its console's request or approval; one a refused request left is dropped.
  state.pairSecrets = new Map([...rows("pairSecrets")].filter(([k, v]) => isSecretHash(v) && (state.pending.has(k) || state.devices.has(k))));
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

/** Audit entries at or after `since` (ms), oldest first. */
export function auditSince(since) {
  return state.audit.filter((e) => (e.at ?? 0) >= since);
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

// ── Device pairing ──────────────────────────────────────────────────────────
// `devices` holds APPROVED devices keyed by deviceKey (UID = SHA-256 of the
// console eMMC CID). Each stores only the ACCESS-KEY HASH, never the plaintext.
// `pending` holds device keys that knocked but aren't approved yet — surfaced
// in the admin dashboard so the operator can approve them.

export function isDeviceApproved(deviceKey) {
  return state.devices.has(deviceKey);
}

/** How many approved consoles `owner` approved (their addedBy). */
export function countDevicesAddedBy(owner) {
  let n = 0;
  for (const d of state.devices.values()) if (d.addedBy === owner) n++;
  return n;
}

export function getDeviceAccessKeyHash(deviceKey) {
  return state.devices.get(deviceKey)?.accessKeyHash ?? null;
}

export function approveDevice(deviceKey, { label, addedBy, accessKeyHash, admin }) {
  const now = Date.now();
  const prev = state.devices.get(deviceKey);
  // A new key for the same console keeps it an admin device unless `admin` says otherwise.
  state.devices.set(deviceKey, deviceRecord({
    label: label ?? prev?.label ?? "",
    addedAt: prev?.addedAt ?? now,
    addedBy: addedBy ?? prev?.addedBy ?? null,
    accessKeyHash,
    admin: admin ?? prev?.admin,
  }));
  dropPending(deviceKey);
  appendAudit({ kind: "device-approve", deviceKey, label: label ?? null, addedBy: addedBy ?? null, at: now });
  scheduleFlush();
  emitPluginEvent("deviceApproved", { isNew: !prev, admin: state.devices.get(deviceKey)?.admin === true }, { deviceKey });
}

export function revokeDevice(deviceKey) {
  state.activity.delete(deviceKey);
  activityWrittenAt.delete(deviceKey);
  const removed = state.devices.delete(deviceKey);
  // Dismissing a request that was never approved must stick across a restart too.
  const dismissed = dropPending(deviceKey);
  const hadSecret = state.pairSecrets.delete(deviceKey);
  dropRepair(deviceKey);
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
 * stays and only takes the old name if it has none of its own (and keeps its
 * own admin-device flag: the flag moves only with a record that moves whole).
 * @returns {boolean} whether there was anything to move
 */
export function rebindDevice(from, to) {
  const rec = state.devices.get(from);
  if (!rec || from === to) return false;
  const into = state.devices.get(to);
  const unnamed = !into?.label || into.label === "자동 등록";
  state.devices.set(to, into ? { ...into, label: unnamed ? rec.label : into.label } : rec);
  state.devices.delete(from);
  dropPending(from);
  dropPending(to);
  state.pairSecrets.delete(from);
  const activity = mergeActivity(state.activity.get(from), state.activity.get(to));
  state.activity.delete(from);
  activityWrittenAt.delete(from);
  if (activity) state.activity.set(to, activity);
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

/** The download a waiting console holds, { owner, id, state }, or null: who it came from though its token no longer works. */
export function pendingDownload(deviceKey) {
  return state.pending.get(deviceKey)?.download ?? null;
}

/** The name the console goes by (its own system nickname), or null. */
export function pendingName(deviceKey) {
  return state.pending.get(deviceKey)?.name ?? null;
}

/** Drop a console from the approval queue without approving it. */
export function dismissPending(deviceKey) {
  const dismissed = dropPending(deviceKey);
  dropRepair(deviceKey);
  if (state.pairSecrets.delete(deviceKey) || dismissed) scheduleFlush();
}

/**
 * Remember the hash of the pairSecret a console asked with. The first one
 * wins here; only replacePairSecret puts another in its place.
 * @returns {"set" | "same" | "conflict"}
 */
export function registerPairSecret(deviceKey, secretHash) {
  const prev = state.pairSecrets.get(deviceKey);
  if (prev) return prev === secretHash ? "same" : "conflict";
  state.pairSecrets.set(deviceKey, secretHash);
  scheduleFlush();
  return "set";
}

/**
 * Put `secretHash` in place of whatever secret a console holds: a waiting
 * console that asks again with a new one, or a re-paired console whose new key
 * goes to the secret that asked for it (pairing-repair.js).
 */
export function replacePairSecret(deviceKey, secretHash) {
  if (state.pairSecrets.get(deviceKey) === secretHash) return;
  state.pairSecrets.set(deviceKey, secretHash);
  scheduleFlush();
}

/** The stored pairSecret hash of a console, or null. */
export function pairSecretHash(deviceKey) {
  return state.pairSecrets.get(deviceKey) ?? null;
}

/** Forget a console's pairSecret (its key was taken). */
export function clearPairSecret(deviceKey) {
  if (state.pairSecrets.delete(deviceKey)) scheduleFlush();
}

// Where each waiting console asked from: memory only, never written to disk.
const pendingFrom = new Map();
function dropPending(deviceKey) {
  pendingFrom.delete(deviceKey);
  return state.pending.delete(deviceKey);
}

const SAME_ADDRESS_MS = 30 * 24 * 60 * 60 * 1000;
const SAME_ADDRESS_MAX = 3;
const AGENT_MAX = 80;

/** Where an address sits, for an alert line. Pure. */
export function addressPlace(ip, t = translator()) {
  const v4 = String(ip ?? "").replace(/^::ffff:/, "");
  if (isLoopbackIp(v4)) return t("place.server");
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(v4)) return t("place.tailscale");
  return t(isPrivateIp(v4) ? "place.home" : "place.outside");
}

/**
 * Who an approval request seems to come from, as alert lines: the address it
 * came from, the accounts that signed in from that address lately, and the app
 * it named itself as. A console asks before it has any account, so this is the
 * best guess the server has; the admin still checks the code on the screen.
 */
export function requesterFacts({ ip = null, agent = null } = {}, now = Date.now()) {
  const names = ip
    ? Array.from(state.access.entries())
        .filter(([, v]) => (v.ips?.[ip] ?? 0) >= now - SAME_ADDRESS_MS)
        .sort(([, a], [, b]) => b.ips[ip] - a.ips[ip])
        .map(([user]) => (user.startsWith("google:") ? "구글 계정" : user))
    : [];
  return {
    ip: ip || null,
    place: ip ? addressPlace(ip) : null,
    accounts: [...new Set(names)],
    app: String(agent ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, AGENT_MAX) || null,
  };
}

export function requesterLines(from = {}, now = Date.now(), t = translator()) {
  const { ip, accounts, app } = requesterFacts(from, now);
  const lines = [];
  if (ip) lines.push(t("requesterFrom", { ip, place: addressPlace(ip, t) }));
  if (accounts.length) lines.push(t("requesterAccounts", { names: accounts.slice(0, SAME_ADDRESS_MAX).join(", "), more: Math.max(0, accounts.length - SAME_ADDRESS_MAX) }));
  if (app) lines.push(t("requesterApp", { app }));
  return lines;
}

/** The account a download belongs to, as the admin knows it: a Google account by its address. Pure. */
export function ownerName(owner) {
  return String(owner ?? "").replace(/^google:/, "");
}

/** Which console and whose, as alert lines: the console's own name and the account its download came from. Pure. */
export function pendingLines({ name, download } = {}, t = translator()) {
  const lines = [];
  if (name) lines.push(t("deviceName", { name }));
  if (download) lines.push(t("deviceOwner", { owner: ownerName(download.owner), how: t(`download.${DOWNLOAD_STATES.has(download.state) ? download.state : "waiting"}`) }));
  return lines;
}

/**
 * A console asking for approval; only when it asked is kept, plus the note it
 * sent, if any (a later note replaces it; a request without one keeps it).
 * `quiet` records it without an alert (pending-limit.js, past its hourly cap).
 * `from` ({ ip, agent }) is the request, named in the alert (requesterLines).
 * `name` is the console's own nickname and `download` ({ owner, id, state })
 * the download its token came from though the token no longer works; both are
 * kept while it waits, so the admin sees which console it is and whose.
 */
export function recordPendingDevice(deviceKey, { message, name, download, quiet = false, from = {} } = {}) {
  const now = Date.now();
  const prev = state.pending.get(deviceKey);
  const note = message === undefined ? prev?.message ?? null : message;
  const next = pendingRecord({ firstSeenAt: prev?.firstSeenAt ?? now, lastSeenAt: now, message: note,
    name: name || prev?.name, download: download ?? prev?.download });
  state.pending.set(deviceKey, next);
  if (from.ip || from.agent) pendingFrom.set(deviceKey, { ip: from.ip ?? null, agent: from.agent ?? null });
  if (state.pending.size > PENDING_MAX) evictOldestPending();
  scheduleFlush();
  const learned = Boolean(next.download && !prev?.download) || Boolean(next.name && !prev?.name);
  if (!quiet && (!prev || learned || (message && message !== prev.message))) {
    // The code is what the console shows on its screen; the note is the console's own words.
    const message = (t) => t("device", { code: deviceCode(deviceKey), note, lines: [...pendingLines(next, t), ...requesterLines(from, now, t)].map((line) => `${line}\n`).join("") });
    alert("device", message, { subject: `${deviceKey}:${note ?? ""}`, now, approval: { kind: "device", ref: deviceKey } });
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
    dropPending(oldestKey);
    if (!state.devices.has(oldestKey)) state.pairSecrets.delete(oldestKey);
  }
}

// Activity changes in memory on every request but asks for a write at most this
// often per console; the counts in between ride along with the next write, and
// shutdown() writes the rest. A request never waits on the disk.
const ACTIVITY_WRITE_MS = 5 * 60 * 1000;
const activityWrittenAt = new Map(); // deviceKey → when its activity last asked for a write
// When the server began keeping console activity: a console approved before it
// and not seen since has no record, which is not the same as unused.
let activitySince = null;
let pruneTimer = null;

/** An approved console made a signed-in request from `ip`. */
export function touchDevice(deviceKey, ip = null, now = Date.now()) {
  if (!state.devices.has(deviceKey)) return;
  const prev = state.activity.get(deviceKey);
  const day = dayKey(now);
  const days = prev?.days ?? {};
  const from = ipOrNull(ip);
  const next = { ...(day in days ? days : keptDays(days, now)), [day]: countRequest(days[day], from) };
  state.activity.set(deviceKey, { lastSeenAt: now, lastIp: from || prev?.lastIp || null, days: next });
  if (now - (activityWrittenAt.get(deviceKey) ?? -Infinity) < ACTIVITY_WRITE_MS) return;
  activityWrittenAt.set(deviceKey, now);
  scheduleFlush();
}

/** An account signed in from `ip`: `owner` is its name, or "google:<sub>"; `method` one of LOGIN_METHODS. */
export function recordLogin(owner, method, ip = null, now = Date.now()) {
  const entry = loginEntry({ at: now, method, ip });
  if (!owner || !entry) return;
  const history = state.logins.get(owner)?.history ?? [];
  state.logins.set(owner, { ...entry, history: keptLogins([...history, entry], now) });
  scheduleFlush();
}

/** The last sign-in of an account, { at, method, ip }, or null. */
export function lastLogin(owner, now = Date.now()) {
  const v = state.logins.get(owner);
  return v ? { at: v.at, method: v.method, ip: fresh(v.at, now) ? v.ip : null } : null;
}

/**
 * Drops the days, sign-ins and addresses older than the kept window from every record, so a console
 * or account that went quiet loses them too. Runs once a day while the server is up, and at load.
 */
export function pruneAccessHistory(now = Date.now()) {
  let changed = false;
  for (const [table, record] of [[state.activity, activityRecord], [state.logins, loginRecord]]) {
    for (const [k, v] of table) {
      const next = record(v, now);
      if (JSON.stringify(next) === JSON.stringify(v)) continue;
      changed = true;
      if (next) table.set(k, next);
      else table.delete(k);
    }
  }
  if (changed) scheduleFlush();
  return changed;
}

/** An account's sign-ins of the last LOGIN_DAYS days, newest first, each { at, method, ip }. */
export function loginHistory(owner, now = Date.now()) {
  return keptLogins(state.logins.get(owner)?.history ?? [], now).toReversed();
}

/** A deleted account leaves no sign-ins behind. */
export function forgetLogins(owner) {
  if (state.logins.delete(owner)) scheduleFlush();
}

/** Drops the sign-ins of every owner `isKnown` says no longer exists (an account taken out of the settings). Returns how many. */
export function forgetLoginsBut(isKnown) {
  const gone = [...state.logins.keys()].filter((owner) => !isKnown(owner));
  for (const owner of gone) state.logins.delete(owner);
  if (gone.length) scheduleFlush();
  return gone.length;
}

/** When any console `owner` approved last connected, or null. */
export function lastActiveOf(owner) {
  let last = null;
  for (const [key, d] of state.devices) {
    const seen = d.addedBy === owner ? state.activity.get(key)?.lastSeenAt : null;
    if (seen && seen > (last ?? 0)) last = seen;
  }
  return last;
}

/** Whether an approved console is an admin device: one that may change item settings (device-admin.js). */
export function isDeviceAdmin(deviceKey) {
  return state.devices.get(deviceKey)?.admin === true;
}

/** Make an approved console an admin device or not. @returns {boolean} whether it exists */
export function setDeviceAdmin(deviceKey, on) {
  const d = state.devices.get(deviceKey);
  if (!d) return false;
  state.devices.set(deviceKey, deviceRecord({ ...d, admin: on === true }));
  appendAudit({ kind: on === true ? "device-admin-on" : "device-admin-off", deviceKey, at: Date.now() });
  scheduleFlush();
  return true;
}

/** Rename an approved console. @returns {boolean} whether it exists */
export function renameDevice(deviceKey, label) {
  const d = state.devices.get(deviceKey);
  if (!d) return false;
  state.devices.set(deviceKey, { ...d, label: String(label ?? "").slice(0, 64).trim() });
  scheduleFlush();
  return true;
}

/**
 * An approved console's activity for the admin page. `idleSince` is what its
 * idle time counts from: its last connection, else its approval when that came
 * after the server began keeping activity, else null (no record). Pure.
 */
function deviceActivity(activity, addedAt, since, now = Date.now()) {
  const days = Object.fromEntries(Object.entries(activity?.days ?? {}).map(([day, d]) => [day, d.n]));
  const recent = dayKey(now - 29 * DAY_MS);
  const lastSeenAt = activity?.lastSeenAt ?? null;
  return {
    lastSeenAt,
    lastIp: activity?.lastIp ?? null,
    days,
    activeDays30: Object.keys(days).filter((day) => day >= recent).length,
    idleSince: lastSeenAt ?? (since !== null && (addedAt ?? 0) >= since ? addedAt : null),
  };
}

/**
 * The addresses an approved console connected from, by day, newest day first:
 * [{ day, n, ips: [{ ip, n }] busiest first, other }], or null when it is not approved.
 */
export function deviceIpHistory(deviceKey, now = Date.now()) {
  if (!state.devices.has(deviceKey)) return null;
  return Object.entries(keptDays(state.activity.get(deviceKey)?.days ?? {}, now))
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([day, d]) => ({ day, n: d.n, ips: Object.entries(d.ips).map(([ip, n]) => ({ ip, n })).sort((a, b) => b.n - a.n), other: d.other }));
}

export function devicesSnapshot(now = Date.now()) {
  return {
    activitySince,
    approved: Array.from(state.devices.entries())
      .map(([deviceKey, v]) => ({ deviceKey, label: v.label ?? "", addedAt: v.addedAt ?? null, addedBy: v.addedBy ?? null, admin: v.admin === true,
        ...deviceActivity(state.activity.get(deviceKey), v.addedAt ?? null, activitySince, now) }))
      .sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0)),
    pending: Array.from(state.pending.entries())
      .map(([deviceKey, v]) => ({ deviceKey, ...(v.message ? { message: v.message } : {}), ...(v.name ? { name: v.name } : {}),
        ...(v.download ? { download: { ...v.download, owner: ownerName(v.download.owner) } } : {}), firstSeenAt: v.firstSeenAt ?? null, lastSeenAt: v.lastSeenAt ?? null,
        ...(pendingFrom.has(deviceKey) ? { from: requesterFacts(pendingFrom.get(deviceKey)) } : {}) }))
      .sort((a, b) => (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0)),
  };
}

export async function shutdown() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  firstUnflushedAt = null;
  await flush();
}
