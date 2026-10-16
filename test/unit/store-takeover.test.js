import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { everything, persistedState, securityDbFile } from "../support/security-db.js";

// The security state of an earlier version (one state.json) is taken over once
// per data folder, so each case runs the store in a fresh process.
const ROOT = path.join(import.meta.dirname, "../..");
const DK1 = "AAAA000000000000000000000000000000000000000000000000000000001A";
const DK2 = "BBBB000000000000000000000000000000000000000000000000000000002B";

function withState(body) {
  const dataDir = mkdtempSync(path.join(tmpdir(), "cf-state-take-"));
  mkdirSync(path.join(dataDir, "security"));
  const file = path.join(dataDir, "security", "state.json");
  if (body !== undefined) writeFileSync(file, typeof body === "string" ? body : JSON.stringify(body));
  return { dataDir, file };
}

/** Loads the store in its own process, runs `code` (with `store` in scope) and returns its JSON result. */
function run(dataDir, code) {
  const script = `const store = await import(${JSON.stringify(path.join(ROOT, "src/security/store.js"))});
await store.load();
const out = await (async () => { ${code} })();
await store.shutdown();
process.stdout.write(JSON.stringify(out ?? null));`;
  return JSON.parse(execFileSync(process.execPath, ["--no-warnings", "--input-type=module", "-e", script], { env: { ...process.env, COOK_DATA_DIR: dataDir }, encoding: "utf8" }));
}

test("a state.json from before is taken over: failures, lockouts, access, consoles, logs", () => {
  const { dataDir, file } = withState({
    failures: { "9.9.9.9": { count: 3, firstAt: 1, lastAt: 2, lastUser: "bob" } },
    lockouts: { "9.9.9.9": { lockedAt: 1, until: null, reason: "too many failures" } },
    access: { alice: { firstAt: 1, lastAt: 2, count: 5, lastIp: "1.1.1.1", ips: { "1.1.1.1": 2 } } },
    devices: { [DK1]: { label: "tv", addedAt: 1, addedBy: "admin", accessKeyHash: "h" } },
    pending: {},
    pairSecrets: { [DK2]: "a".repeat(64), bad: "not-a-hash" },
    audit: [{ kind: "fixture", at: 1 }],
    denials: [{ reason: "probe", at: 1 }],
    denialCounts: { probe: 7 },
    savedAt: 123,
  });
  const out = run(dataDir, `return {
    failure: store.getFailure("9.9.9.9").count, locked: store.isLocked("9.9.9.9"),
    access: store.accessSnapshot().map((a) => [a.user, a.count]),
    devices: store.devicesSnapshot().approved.map((d) => d.deviceKey),
    secret: store.pairSecretHash(${JSON.stringify(DK2)}), bad: store.pairSecretHash("bad"),
    audit: store.snapshot().audit.map((a) => a.kind), denials: store.denialsSnapshot(),
  };`);
  assert.deepEqual(out.failure, 3);
  assert.equal(out.locked, true);
  assert.deepEqual(out.access, [["alice", 5]]);
  assert.deepEqual(out.devices, [DK1]);
  assert.equal(out.secret, "a".repeat(64));
  assert.equal(out.bad, null, "only well-formed secret hashes come in");
  assert.deepEqual(out.audit, ["fixture"]);
  assert.equal(out.denials.total, 1);
  assert.deepEqual(out.denials.counts, { probe: 7 });
  assert.ok(readFileSync(file, "utf8").includes("fixture"), "the file is left as it was");
  assert.equal(statSync(securityDbFile(dataDir)).mode & 0o777, 0o600);
});

test("once taken over, the file is not read again: the database is the truth", () => {
  const { dataDir, file } = withState({ failures: { "9.9.9.9": { count: 3, firstAt: 1, lastAt: 2 } } });
  run(dataDir, `store.clearFailure("9.9.9.9");`);
  writeFileSync(file, JSON.stringify({ failures: { "8.8.8.8": { count: 1 } } }));
  assert.deepEqual(run(dataDir, `return [store.getFailure("9.9.9.9"), store.getFailure("8.8.8.8")];`), [null, null]);
});

test("the IP, last-seen time and version older versions kept for consoles are not carried over", () => {
  const { dataDir } = withState({
    devices: { [DK1]: { label: "tv", addedAt: 1, addedBy: "admin", accessKeyHash: "h", lastSeenAt: 5, lastIp: "203.0.113.9", lastVersion: "1.0" } },
    pending: { [DK2]: { firstSeenAt: 1, lastSeenAt: 2, count: 3, lastIp: "203.0.113.10", lastVersion: "1.0" } },
  });
  const snap = run(dataDir, `store.touchDevice(${JSON.stringify(DK1)}); return store.devicesSnapshot();`);
  assert.equal(snap.approved[0].label, "tv");
  assert.ok(snap.approved[0].lastSeenAt > 0, "seen now, in memory");
  assert.deepEqual(snap.pending[0], { deviceKey: DK2, firstSeenAt: 1, lastSeenAt: 2 });
  assert.ok(!everything(dataDir).includes("203.0.113"), "the old addresses are not in the database");
  assert.equal(persistedState(dataDir).devices[DK1].lastSeenAt, undefined, "last-seen never reaches the disk");
});

test("a state.json that does not read starts the store empty instead of stopping it", () => {
  const { dataDir } = withState("{ not valid json ]]]");
  assert.deepEqual(run(dataDir, `return [store.devicesSnapshot(), store.snapshot()];`), [{ approved: [], pending: [] }, { failures: [], lockouts: [], audit: [] }]);
});

test("only the log lines added since the last write are written, and the logs keep their length", () => {
  const { dataDir } = withState();
  run(dataDir, `for (let i = 0; i < 1005; i++) store.appendAudit({ kind: "a" + i, at: i });`);
  run(dataDir, `store.appendAudit({ kind: "next", at: 2000 }); store.clearDenials(); store.recordDenial({ reason: "x", at: 1 });`);
  const { audit, denials } = persistedState(dataDir);
  assert.equal(audit.length, 1000);
  assert.deepEqual([audit[0].kind, audit.at(-2).kind, audit.at(-1).kind], ["a6", "a1004", "next"]);
  assert.deepEqual(denials.map((d) => d.reason), ["x"]);
});
