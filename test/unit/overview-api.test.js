import { test } from "node:test";
import assert from "node:assert/strict";
import { createOverview } from "../../src/routes/admin/overview-api.js";

const VERIFY = { status: "idle", total: 10, counts: { ok: 7, modified: 1, damaged: 2, unchecked: 0, misnamed: 0 } };

function overviewWith(over = {}) {
  let t = 1_000;
  const calls = { files: 0 };
  const o = createOverview({
    warnings: () => [{ code: "no-prod-keys", severity: "warn" }],
    counts: async () => ({ pendingDevices: 1, pendingAccounts: 0, inbox: 3, lockouts: 0 }),
    files: () => { calls.files++; return [
      { baseTitleId: "0100000000010000", size: 100 },
      { baseTitleId: "0100000000010000", size: 50 },
      { titleId: "0100000000020000", size: 25 },
    ]; },
    verify: () => VERIFY,
    activeTransfers: () => 2,
    plugins: () => [{ id: "a", enabled: true, state: "on" }, { id: "b", enabled: true, state: "failed" }, { id: "c", enabled: false, state: "off" }],
    recentAlerts: () => Array.from({ length: 12 }, (_, i) => ({ at: 100 - i, event: "device", text: `\nline ${i}\nmore`, status: "sent" })),
    disks: async () => [{ key: "games", free: 5, size: 10 }, null],
    now: () => t,
    ...over,
  });
  return { o, calls, tick: (ms) => { t += ms; } };
}

test("the to-do list holds config warnings first and only counts above zero", async () => {
  const { o } = overviewWith();
  const { todo } = await o.read();
  assert.deepEqual(todo.map((t) => t.code), ["no-prod-keys", "damaged", "pending-devices", "inbox", "plugins-failing"]);
  assert.equal(todo.find((t) => t.code === "damaged").n, 2);
  assert.deepEqual(todo.find((t) => t.code === "plugins-failing").ids, ["b"]);
});

test("the status counts games by title, sums their size and keeps the disks it could read", async () => {
  const { o } = overviewWith();
  const { status } = await o.read();
  assert.deepEqual(status.games, { titles: 2, files: 3, bytes: 175 });
  assert.deepEqual(status.disk, [{ key: "games", free: 5, size: 10 }]);
  assert.equal(status.transfers.active, 2);
  assert.deepEqual(status.plugins, { on: 1, total: 3 });
  assert.equal(status.verify.counts.damaged, 2);
});

test("recent shows the eight newest alerts, first line only", async () => {
  const { o } = overviewWith();
  const { recent } = await o.read();
  assert.equal(recent.length, 8);
  assert.deepEqual(recent[0], { at: 100, event: "device", text: "line 0", status: "sent" });
});

test("the answer is kept for ten seconds, then read again", async () => {
  const { o, calls, tick } = overviewWith();
  await o.read();
  await o.read();
  assert.equal(calls.files, 1);
  tick(10_001);
  await o.read();
  assert.equal(calls.files, 2);
});
