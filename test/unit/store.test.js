import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { persistedState } from "../support/security-db.js";

// `src/security/store.js` reads COOK_DATA_DIR (via helpers/envs.js) at
// module-eval time, and both are singletons cached by the ESM loader for the
// lifetime of this process. `node --test` runs each test *file* in its own
// process, so as long as this is the very first thing this file does, we get
// one isolated temp dataDir for the whole suite — mirroring the technique
// already used in test/unit/pairing.test.js.
const DATA_DIR = mkdtempSync(path.join(tmpdir(), "cook-store-unit-"));
process.env.COOK_DATA_DIR = DATA_DIR;

const store = await import("../../src/security/store.js");

const STATE_PATH = path.join(DATA_DIR, "security", "state.json");

const readPersisted = () => persistedState(DATA_DIR);

// A handful of tests need deterministic ordering of Date.now()-derived
// timestamps (pending eviction, lastSeen sort order). Real wall-clock calls
// in a tight loop can tie or race, so we swap in a monotonically increasing
// fake clock for those tests only, then restore the real one.
function withFakeClock(fn) {
  const realNow = Date.now;
  let t = 1_700_000_000_000;
  Date.now = () => (t += 1);
  try {
    return fn();
  } finally {
    Date.now = realNow;
  }
}

after(async () => {
  await store.shutdown();
});

// ── load() ──────────────────────────────────────────────────────────────────
// Taking over a state.json from before is in store-takeover.test.js (it happens
// once per data folder, so it needs a process of its own).

test("load() with no state file on disk leaves all maps empty and does not throw", async () => {
  assert.equal(existsSync(STATE_PATH), false);
  await assert.doesNotReject(store.load());
  const { approved, pending, activitySince } = store.devicesSnapshot();
  assert.deepEqual({ approved, pending }, { approved: [], pending: [] });
  assert.ok(activitySince > 0, "the first start marks when console activity began to be kept");
  assert.deepEqual(store.snapshot(), { failures: [], lockouts: [], audit: [] });
  assert.deepEqual(store.accessSnapshot(), []);
});

test("load() with COOK_RESET_LOCKOUTS=true clears failures+lockouts and appends a reset audit entry", async () => {
  store.setFailure("5.5.5.5", { count: 1, firstAt: 1, lastAt: 1 });
  store.lock("5.5.5.5", { reason: "test", ttlMs: 0 });
  assert.equal(store.isLocked("5.5.5.5"), true);

  process.env.COOK_RESET_LOCKOUTS = "true";
  try {
    // No file on disk right now (nothing has flushed since the corrupt-JSON
    // write), so load() takes the ENOENT branch and falls straight into the
    // reset block against current in-memory state.
    await store.load();
  } finally {
    delete process.env.COOK_RESET_LOCKOUTS;
  }

  assert.equal(store.getFailure("5.5.5.5"), null);
  assert.equal(store.isLocked("5.5.5.5"), false);
  const kinds = store.snapshot().audit.map((a) => a.kind);
  assert.ok(kinds.includes("reset"), "reset should append an audit entry");
});

// ── failures / lockouts ──────────────────────────────────────────────────────

test("getFailure returns null for an ip with no recorded failures", () => {
  assert.equal(store.getFailure("203.0.113.1"), null);
});

test("setFailure/getFailure/clearFailure roundtrip", () => {
  const ip = "203.0.113.2";
  assert.equal(store.getFailure(ip), null);

  store.setFailure(ip, { count: 1, firstAt: 10, lastAt: 10, lastUser: "eve" });
  assert.deepEqual(store.getFailure(ip), { count: 1, firstAt: 10, lastAt: 10, lastUser: "eve" });

  store.clearFailure(ip);
  assert.equal(store.getFailure(ip), null);
});

test("clearFailure on an ip with no failures is a harmless no-op", () => {
  assert.doesNotThrow(() => store.clearFailure("203.0.113.3"));
});

test("isLocked returns false for an ip that was never locked", () => {
  assert.equal(store.isLocked("203.0.113.4"), false);
});

test("lock() with no ttlMs creates a permanent lockout (until: null, never expires)", () => {
  const ip = "203.0.113.5";
  store.lock(ip, { reason: "manual" });
  assert.equal(store.isLocked(ip), true);
  assert.equal(store.snapshot().lockouts.find((l) => l.ip === ip).until, null);
  store.unlock(ip);
});

test("lock() with a positive ttlMs sets a future `until` and stays locked", () => {
  const ip = "203.0.113.6";
  store.lock(ip, { reason: "brute-force", ttlMs: 60_000 });
  const entry = store.snapshot().lockouts.find((l) => l.ip === ip);
  assert.ok(entry.until > Date.now());
  assert.equal(store.isLocked(ip), true);
  store.unlock(ip);
});

test("isLocked self-heals an expired lockout: returns false and removes the entry", async () => {
  const ip = "203.0.113.7";
  // ttlMs must be > 0 for `until` to be set at all (falsy/negative ttlMs is
  // treated as "no ttl" → permanent lock, see lock()'s ternary). Use a tiny
  // positive ttl and let it actually elapse.
  store.lock(ip, { reason: "expired-test", ttlMs: 1 });
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(store.isLocked(ip), false);
  // Confirm it was actually deleted, not just reported false.
  assert.equal(store.snapshot().lockouts.find((l) => l.ip === ip), undefined);
});

test("unlock() removes the lockout and the failure counter, returns true", () => {
  const ip = "203.0.113.8";
  store.setFailure(ip, { count: 4, firstAt: 1, lastAt: 1 });
  store.lock(ip, { reason: "x", ttlMs: 60_000 });

  const removed = store.unlock(ip);

  assert.equal(removed, true);
  assert.equal(store.isLocked(ip), false);
  assert.equal(store.getFailure(ip), null);
});

test("unlock() on an ip that isn't locked returns false (idempotent)", () => {
  assert.equal(store.unlock("203.0.113.9"), false);
});

test("snapshot() reports failures and lockouts as ip-tagged arrays", () => {
  const ip = "203.0.113.10";
  store.setFailure(ip, { count: 2, firstAt: 1, lastAt: 1 });
  store.lock(ip, { reason: "snap-test", ttlMs: 60_000 });

  const snap = store.snapshot();
  assert.ok(snap.failures.some((f) => f.ip === ip && f.count === 2));
  assert.ok(snap.lockouts.some((l) => l.ip === ip && l.reason === "snap-test"));

  store.unlock(ip);
});

// ── access tracking ──────────────────────────────────────────────────────────

test("recordAccess with a falsy user is a no-op", () => {
  const before = store.accessSnapshot().length;
  store.recordAccess(undefined, "1.2.3.4");
  store.recordAccess("", "1.2.3.4");
  store.recordAccess(null, "1.2.3.4");
  assert.equal(store.accessSnapshot().length, before);
});

test("recordAccess creates a new entry on first sight, then accumulates on repeat calls", () => {
  const user = "access-user-1";
  store.recordAccess(user, "10.0.0.1");
  let entry = store.accessSnapshot().find((a) => a.user === user);
  assert.equal(entry.count, 1);
  assert.equal(entry.lastIp, "10.0.0.1");
  assert.deepEqual(entry.ips.map((i) => i.ip), ["10.0.0.1"]);

  store.recordAccess(user, "10.0.0.2");
  entry = store.accessSnapshot().find((a) => a.user === user);
  assert.equal(entry.count, 2);
  assert.equal(entry.lastIp, "10.0.0.2");
  assert.equal(entry.ips.length, 2, "each distinct ip is tracked separately");
});

test("recordAccess without an ip still bumps count but records no new ip entry", () => {
  const user = "access-user-2";
  store.recordAccess(user); // no ip
  const entry = store.accessSnapshot().find((a) => a.user === user);
  assert.equal(entry.count, 1);
  assert.equal(entry.lastIp, null, "accessSnapshot normalises a never-set lastIp to null");
  assert.deepEqual(entry.ips, []);
});

test("accessSnapshot sorts users by lastAt descending", () => {
  withFakeClock(() => {
    store.recordAccess("sort-user-old", "1.1.1.1");
    store.recordAccess("sort-user-new", "1.1.1.1");
  });
  const users = store.accessSnapshot().map((a) => a.user);
  assert.ok(
    users.indexOf("sort-user-new") < users.indexOf("sort-user-old"),
    "more recently active user should sort first"
  );
});

test("accessSnapshot's per-user ips are sorted by lastAt descending", () => {
  const user = "access-user-ip-sort";
  withFakeClock(() => {
    store.recordAccess(user, "aaa");
    store.recordAccess(user, "bbb");
  });
  const entry = store.accessSnapshot().find((a) => a.user === user);
  assert.deepEqual(entry.ips.map((i) => i.ip), ["bbb", "aaa"]);
});

// ── device pairing: approve / revoke / seen ─────────────────────────────────

const DK1 = "AAAA000000000000000000000000000000000000000000000000000000001A";
const DK2 = "BBBB000000000000000000000000000000000000000000000000000000002B";

test("isDeviceApproved is false and getDeviceAccessKeyHash is null for an unknown deviceKey", () => {
  assert.equal(store.isDeviceApproved(DK1), false);
  assert.equal(store.getDeviceAccessKeyHash(DK1), null);
});

test("approveDevice on a brand-new device stores label/addedBy/hash and audits it", () => {
  store.approveDevice(DK1, { label: "kid console", addedBy: "admin", accessKeyHash: "hash-1" });

  assert.equal(store.isDeviceApproved(DK1), true);
  assert.equal(store.getDeviceAccessKeyHash(DK1), "hash-1");

  const approved = store.devicesSnapshot().approved.find((d) => d.deviceKey === DK1);
  assert.equal(approved.label, "kid console");
  assert.equal(approved.addedBy, "admin");
  assert.deepEqual(Object.keys(approved).sort(), ["activeDays30", "addedAt", "addedBy", "admin", "days", "deviceKey", "idleSince", "label", "lastIp", "lastSeenAt"], "no client version");
  assert.equal(approved.lastSeenAt, null, "not seen yet");

  const kinds = store.snapshot().audit.map((a) => a.kind);
  assert.ok(kinds.includes("device-approve"));
});

test("approveDevice clears any pending entry for the same deviceKey", () => {
  store.recordPendingDevice(DK2);
  assert.ok(store.devicesSnapshot().pending.some((p) => p.deviceKey === DK2));

  store.approveDevice(DK2, { label: "", addedBy: null, accessKeyHash: "hash-2" });

  assert.equal(
    store.devicesSnapshot().pending.some((p) => p.deviceKey === DK2),
    false,
    "approval must clear the pending entry"
  );
});

test("re-approving an existing device preserves addedAt/addedBy/label when new values are nullish, but rotates the hash", () => {
  const before = store.devicesSnapshot().approved.find((d) => d.deviceKey === DK1);

  store.approveDevice(DK1, { label: undefined, addedBy: undefined, accessKeyHash: "hash-1-rotated" });

  const after = store.devicesSnapshot().approved.find((d) => d.deviceKey === DK1);
  assert.equal(after.addedAt, before.addedAt, "addedAt is preserved across re-approval");
  assert.equal(after.label, before.label, "label falls back to the previous value");
  assert.equal(after.addedBy, before.addedBy, "addedBy falls back to the previous value");
  assert.equal(store.getDeviceAccessKeyHash(DK1), "hash-1-rotated", "hash is always overwritten");
});

test("an approved console is no admin device until set; the flag survives a new key and clears on revoke", () => {
  const dk = "EEEE000000000000000000000000000000000000000000000000000000005E";
  const flag = () => store.devicesSnapshot().approved.find((d) => d.deviceKey === dk)?.admin;
  assert.equal(store.setDeviceAdmin(dk, true), false, "unknown console");
  store.approveDevice(dk, { label: "living room", addedBy: "admin", accessKeyHash: "hash-e" });
  assert.equal(store.isDeviceAdmin(dk), false);
  assert.equal(flag(), false);
  assert.equal(store.setDeviceAdmin(dk, true), true);
  assert.equal(store.isDeviceAdmin(dk), true);
  assert.equal(flag(), true);
  store.approveDevice(dk, { accessKeyHash: "hash-e2" });
  assert.equal(store.isDeviceAdmin(dk), true, "a new key keeps it");
  store.setDeviceAdmin(dk, false);
  assert.equal(store.isDeviceAdmin(dk), false);
  store.setDeviceAdmin(dk, true);
  store.revokeDevice(dk);
  assert.equal(store.isDeviceAdmin(dk), false);
  store.approveDevice(dk, { label: "again", addedBy: "admin", accessKeyHash: "hash-e3" });
  assert.equal(store.isDeviceAdmin(dk), false, "approved again: off until set again");
  store.revokeDevice(dk);
});

test("rebindDevice moves the admin flag with the record that moves whole", () => {
  const from = "F1F1000000000000000000000000000000000000000000000000000000006F";
  const to = "F2F2000000000000000000000000000000000000000000000000000000007F";
  store.approveDevice(from, { label: "old", addedBy: "admin", accessKeyHash: "hash-f" });
  store.setDeviceAdmin(from, true);
  assert.equal(store.rebindDevice(from, to), true);
  assert.equal(store.isDeviceAdmin(from), false);
  assert.equal(store.isDeviceAdmin(to), true);
  store.revokeDevice(to);
});

test("revokeDevice removes an approved device and its pending trace, returns true then false", () => {
  assert.equal(store.revokeDevice(DK1), true);
  assert.equal(store.isDeviceApproved(DK1), false);
  assert.equal(store.getDeviceAccessKeyHash(DK1), null);
  assert.equal(store.revokeDevice(DK1), false, "revoking twice is idempotent");
});

// ── pending devices ───────────────────────────────────────────────────────────

test("recordPendingDevice keeps only when a console asked: no IP, no version", () => {
  const dk = "DDDD000000000000000000000000000000000000000000000000000000004D";
  store.recordPendingDevice(dk);
  const p = store.devicesSnapshot().pending.find((x) => x.deviceKey === dk);
  assert.deepEqual(Object.keys(p).sort(), ["deviceKey", "firstSeenAt", "lastSeenAt"]);
  assert.equal(p.firstSeenAt, p.lastSeenAt);
  store.revokeDevice(dk); // also clears the pending entry; keep the pool clean
});

test("recordPendingDevice on repeat knocks keeps firstSeenAt and bumps lastSeenAt", () => {
  const dk = "EEEE000000000000000000000000000000000000000000000000000000005E";
  let first;
  withFakeClock(() => {
    store.recordPendingDevice(dk);
    first = store.devicesSnapshot().pending.find((x) => x.deviceKey === dk);
    store.recordPendingDevice(dk);
  });
  const second = store.devicesSnapshot().pending.find((x) => x.deviceKey === dk);
  assert.equal(second.firstSeenAt, first.firstSeenAt, "firstSeenAt never changes");
  assert.ok(second.lastSeenAt > first.lastSeenAt);
  store.revokeDevice(dk);
});

test("devicesSnapshot lists approved consoles newest first and pending ones by latest request", () => {
  withFakeClock(() => {
    store.approveDevice("1111000000000000000000000000000000000000000000000000000000001A", {
      label: "old-approved",
      accessKeyHash: "h",
    });
    store.approveDevice("2222000000000000000000000000000000000000000000000000000000002B", {
      label: "new-approved",
      accessKeyHash: "h",
    });

    store.recordPendingDevice("3333000000000000000000000000000000000000000000000000000000003C");
    store.recordPendingDevice("4444000000000000000000000000000000000000000000000000000000004D");
  });

  const approved = store.devicesSnapshot().approved.map((d) => d.label);
  assert.ok(approved.indexOf("new-approved") < approved.indexOf("old-approved"));

  const pendingKeys = store.devicesSnapshot().pending.map((p) => p.deviceKey);
  const iOld = pendingKeys.indexOf("3333000000000000000000000000000000000000000000000000000000003C");
  const iNew = pendingKeys.indexOf("4444000000000000000000000000000000000000000000000000000000004D");
  assert.ok(iNew < iOld, "more recently-seen pending device should sort first");

  // cleanup so later length-sensitive assertions aren't affected — revokeDevice
  // also clears any pending trace for the same key.
  store.revokeDevice("1111000000000000000000000000000000000000000000000000000000001A");
  store.revokeDevice("2222000000000000000000000000000000000000000000000000000000002B");
  store.revokeDevice("3333000000000000000000000000000000000000000000000000000000003C");
  store.revokeDevice("4444000000000000000000000000000000000000000000000000000000004D");
});

test("recordPendingDevice evicts the single oldest entry once the pool exceeds PENDING_MAX (200)", () => {
  // Every earlier pending-device test cleans up after itself via
  // revokeDevice(), so the pool should be empty here — assert that
  // precondition rather than silently assuming it.
  const startSize = store.devicesSnapshot().pending.length;
  assert.equal(startSize, 0, "pending pool must be empty before this test (earlier tests should have cleaned up)");

  const keys = Array.from({ length: 201 }, (_, i) => {
    const suffix = String(i).padStart(4, "0");
    return `9${suffix}0000000000000000000000000000000000000000000000000000000${(i % 10)}`.slice(0, 64);
  });

  withFakeClock(() => {
    for (const k of keys) store.recordPendingDevice(k);
  });

  const snapPending = store.devicesSnapshot().pending;
  const pendingNow = new Set(snapPending.map((p) => p.deviceKey));

  assert.equal(snapPending.length, 200, "pool never grows past PENDING_MAX");
  assert.equal(pendingNow.has(keys[0]), false, "the very first (oldest) entry was evicted");
  assert.ok(pendingNow.has(keys[200]), "the most recent entry survives");

  // cleanup
  for (const k of keys) store.revokeDevice(k);
});

// ── persistence: flush()/shutdown() actually write serialise()'d state ──────

test("shutdown() forces an immediate flush: the console is in the database at once", async () => {
  store.approveDevice(
    "5555000000000000000000000000000000000000000000000000000000005E",
    { label: "persisted-device", addedBy: "admin", accessKeyHash: "persisted-hash" }
  );

  await store.shutdown();

  const persisted = readPersisted();
  assert.ok(persisted.devices["5555000000000000000000000000000000000000000000000000000000005E"]);
  assert.equal(
    persisted.devices["5555000000000000000000000000000000000000000000000000000000005E"].label,
    "persisted-device"
  );

  store.revokeDevice("5555000000000000000000000000000000000000000000000000000000005E");
});

test("concurrent shutdown() calls share the in-flight write instead of racing two writes", async () => {
  store.setFailure("198.51.100.1", { count: 1, firstAt: 1, lastAt: 1 });
  await assert.doesNotReject(Promise.all([store.shutdown(), store.shutdown()]));
  const persisted = readPersisted();
  assert.ok(persisted.failures["198.51.100.1"]);
  store.clearFailure("198.51.100.1");
});

test("appendAudit trims the persisted audit log to AUDIT_MAX (1000) entries, dropping the oldest", async () => {
  for (let i = 0; i < 1005; i++) {
    store.appendAudit({ kind: `bulk-${i}`, at: i });
  }
  await store.shutdown();

  const persisted = readPersisted();
  assert.equal(persisted.audit.length, 1000, "audit log is capped at AUDIT_MAX");
  assert.equal(persisted.audit[0].kind, "bulk-5", "the 5 oldest entries were dropped");
  assert.equal(persisted.audit[persisted.audit.length - 1].kind, "bulk-1004", "the newest entry survives");
});

test("scheduleFlush's debounced timer eventually persists to disk without an explicit shutdown()", async () => {
  store.setFailure("192.0.2.222", { count: 9, firstAt: 1, lastAt: 1 });
  // FLUSH_DEBOUNCE_MS is 500ms; wait past it and confirm the background
  // timer wrote the file on its own (no shutdown()/flush() call here).
  await new Promise((resolve) => setTimeout(resolve, 650));
  const persisted = readPersisted();
  assert.ok(persisted.failures["192.0.2.222"], "debounced flush wrote the pending change to disk");
  store.clearFailure("192.0.2.222");
});

test("flush() failures (e.g. an unwritable state dir) are caught internally, not thrown", async () => {
  const securityDir = path.join(DATA_DIR, "security");
  chmodSync(securityDir, 0o555); // read + execute only, no write
  try {
    await assert.doesNotReject(store.shutdown(), "a disk write error must not propagate to the caller");
  } finally {
    chmodSync(securityDir, 0o755); // restore so later flushes (incl. the after() hook) succeed
  }
});

test("dismissing a request that was never approved is saved, so it does not come back after a restart", async () => {
  const key = "7777000000000000000000000000000000000000000000000000000000007A";
  store.recordPendingDevice(key, { ip: "198.51.100.7" });
  await store.shutdown();
  assert.ok(readPersisted().pending[key], "the request is on disk");

  assert.equal(store.revokeDevice(key), false, "nothing approved was revoked");
  // No forced flush: the dismissal must schedule its own save.
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(readPersisted().pending[key], undefined);
});

test("steady changes cannot put the save off for ever: it happens within the longest wait", async () => {
  const ip = "192.0.2.77";
  const started = Date.now();
  let saved = false;
  // A change every 200 ms keeps restarting the 500 ms debounce.
  while (!saved && Date.now() - started < 8000) {
    store.setFailure(ip, { count: Date.now(), firstAt: 1, lastAt: 1 });
    await new Promise((r) => setTimeout(r, 200));
    saved = Boolean(readPersisted().failures[ip]);
  }
  assert.ok(saved, "saved while changes kept coming");
  assert.ok(Date.now() - started < 6500, `saved after ${Date.now() - started} ms`);
  store.clearFailure(ip);
});

test("a waiting console's address and app are shown to the admin from memory, and go when it is dismissed", () => {
  const dk = "FFFF000000000000000000000000000000000000000000000000000000006F";
  store.recordPendingDevice(dk, { quiet: true, from: { ip: "192.0.2.10", agent: "CyberFoil/1.2" } });
  const p = store.devicesSnapshot().pending.find((x) => x.deviceKey === dk);
  assert.deepEqual({ ip: p.from.ip, place: p.from.place, app: p.from.app, accounts: p.from.accounts }, { ip: "192.0.2.10", place: "집 밖", app: "CyberFoil/1.2", accounts: [] });
  assert.equal(JSON.stringify(readPersisted()).includes("192.0.2.10"), false, "never written to disk");
  store.revokeDevice(dk);
  assert.equal(store.devicesSnapshot().pending.some((x) => x.deviceKey === dk), false);
  store.recordPendingDevice(dk, { quiet: true });
  assert.equal("from" in store.devicesSnapshot().pending.find((x) => x.deviceKey === dk), false, "a request without an address shows none");
  store.revokeDevice(dk);
});
