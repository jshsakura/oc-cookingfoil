/**
 * Persistent security state — failures, lockouts, and a bounded audit log.
 *
 * Persisted under ${COOK_DATA_DIR}/security/state.json with atomic writes
 * (tmp + rename). Writes are debounced so a burst of auth failures doesn't
 * thrash the disk. State survives container restarts so attackers can't
 * just bounce us to reset their failure count.
 */
import fs from "fs";
import path from "path";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import debug from "../debug.js";
import { dataDir } from "../helpers/envs.js";

const STATE_DIR = path.join(dataDir, "security");
const STATE_PATH = path.join(STATE_DIR, "state.json");
const FLUSH_DEBOUNCE_MS = 500;
const AUDIT_MAX = 1000;

const state = {
  failures: new Map(), // ip → { count, firstAt, lastAt, lastUser }
  lockouts: new Map(), // ip → { lockedAt, until, reason }
  access: new Map(),   // user → { firstAt, lastAt, count, lastIp, ips:{ip:lastAt} }
  devices: new Map(),  // deviceKey → { label, addedAt, addedBy, accessKeyHash, lastSeenAt, lastIp, lastVersion }
  pending: new Map(),  // deviceKey → { firstSeenAt, lastSeenAt, count, lastIp, lastVersion }
  audit: [],
};

let flushTimer = null;
let inFlightWrite = null;

function serialise() {
  return {
    failures: Object.fromEntries(state.failures),
    lockouts: Object.fromEntries(state.lockouts),
    access: Object.fromEntries(state.access),
    devices: Object.fromEntries(state.devices),
    pending: Object.fromEntries(state.pending),
    audit: state.audit,
    savedAt: Date.now(),
  };
}

async function flush() {
  if (inFlightWrite) {
    await inFlightWrite;
    return;
  }
  inFlightWrite = (async () => {
    try {
      await mkdir(STATE_DIR, { recursive: true });
      const tmp = `${STATE_PATH}.tmp.${process.pid}`;
      await writeFile(tmp, JSON.stringify(serialise()));
      await rename(tmp, STATE_PATH);
    } catch (err) {
      debug.error("security: state flush failed: %s", err.message);
    } finally {
      inFlightWrite = null;
    }
  })();
  await inFlightWrite;
}

function scheduleFlush() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush().catch(() => {});
  }, FLUSH_DEBOUNCE_MS);
  if (flushTimer.unref) flushTimer.unref();
}

export async function load() {
  try {
    const raw = await readFile(STATE_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    state.failures = new Map(Object.entries(parsed.failures ?? {}));
    state.lockouts = new Map(Object.entries(parsed.lockouts ?? {}));
    state.access = new Map(Object.entries(parsed.access ?? {}));
    state.devices = new Map(Object.entries(parsed.devices ?? {}));
    state.pending = new Map(Object.entries(parsed.pending ?? {}));
    state.audit = Array.isArray(parsed.audit) ? parsed.audit : [];
    debug.log(
      "security: state loaded (%d failure tracker(s), %d lockout(s))",
      state.failures.size,
      state.lockouts.size
    );
  } catch (err) {
    if (err.code !== "ENOENT") {
      debug.error("security: state load failed: %s", err.message);
    }
  }

  // One-shot reset switch: COOK_RESET_LOCKOUTS=true clears all lockouts on
  // boot. Useful if the admin loses access. Failure counters also clear so
  // a previously-locked IP gets a clean slate.
  if (process.env.COOK_RESET_LOCKOUTS === "true") {
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
  if (state.audit.length > AUDIT_MAX) {
    state.audit.splice(0, state.audit.length - AUDIT_MAX);
  }
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
    lastSeenAt: prev?.lastSeenAt ?? null,
    lastIp: prev?.lastIp ?? null,
    lastVersion: prev?.lastVersion ?? null,
  });
  state.pending.delete(deviceKey);
  appendAudit({ kind: "device-approve", deviceKey, label: label ?? null, addedBy: addedBy ?? null, at: now });
  scheduleFlush();
}

export function revokeDevice(deviceKey) {
  const removed = state.devices.delete(deviceKey);
  state.pending.delete(deviceKey);
  if (removed) {
    appendAudit({ kind: "device-revoke", deviceKey, at: Date.now() });
    scheduleFlush();
  }
  return removed;
}

export function recordDeviceSeen(deviceKey, { ip, version } = {}) {
  const d = state.devices.get(deviceKey);
  if (!d) return;
  d.lastSeenAt = Date.now();
  if (ip) d.lastIp = ip;
  if (version) d.lastVersion = version;
  scheduleFlush();
}

export function recordPendingDevice(deviceKey, { ip, version } = {}) {
  const now = Date.now();
  const prev = state.pending.get(deviceKey) ?? { firstSeenAt: now, count: 0 };
  state.pending.set(deviceKey, {
    firstSeenAt: prev.firstSeenAt,
    lastSeenAt: now,
    count: prev.count + 1,
    lastIp: ip ?? prev.lastIp ?? null,
    lastVersion: version ?? prev.lastVersion ?? null,
  });
  scheduleFlush();
}

export function devicesSnapshot() {
  const byLastSeen = (a, b) => (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0);
  return {
    approved: Array.from(state.devices.entries())
      .map(([deviceKey, v]) => ({
        deviceKey,
        label: v.label ?? "",
        addedAt: v.addedAt ?? null,
        addedBy: v.addedBy ?? null,
        lastSeenAt: v.lastSeenAt ?? null,
        lastIp: v.lastIp ?? null,
        lastVersion: v.lastVersion ?? null,
      }))
      .sort(byLastSeen),
    pending: Array.from(state.pending.entries())
      .map(([deviceKey, v]) => ({ deviceKey, ...v }))
      .sort(byLastSeen),
  };
}

export async function shutdown() {
  if (flushTimer) clearTimeout(flushTimer);
  await flush();
}
