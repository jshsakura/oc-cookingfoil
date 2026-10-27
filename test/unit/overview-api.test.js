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
    patches: () => [],
    nameOf: () => null,
    namesMissing: () => false,
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

test("a hint about the setup, like the admin page opening with the password, is not a to-do", async () => {
  const { o } = overviewWith({ warnings: () => [
    { code: "admin-authenticator-optional", severity: "info" },
    { code: "both-lanes", severity: "info" },
    { code: "proxy-collapse", severity: "warn" },
  ] });
  const { todo } = await o.read();
  assert.deepEqual(todo.filter((t) => t.severity).map((t) => t.code), ["proxy-collapse"]);
});

test("a Korean server with no names plugin on is told to fetch one", async () => {
  const { o } = overviewWith({ namesMissing: () => true });
  const { todo } = await o.read();
  assert.ok(todo.some((t) => t.code === "no-names-plugin"));
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

test("recent shows the eight newest alerts: the first line for the list, the whole message for its detail", async () => {
  const { o } = overviewWith();
  const { recent } = await o.read();
  assert.equal(recent.length, 8);
  assert.deepEqual(recent[0], { at: 100, event: "device", text: "line 0", body: "\nline 0\nmore", status: "sent", detail: null });
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

test("the newest game files and patches come first, each with when and the patch's game", async () => {
  const files = Array.from({ length: 10 }, (_, i) => ({ name: `Game ${i}`, kind: i % 2 ? "update" : "base", titleId: `01000000000${String(i).padStart(2, "0")}000`, version: 0, size: 1, mtime: 1000 + i }));
  const { o } = overviewWith({
    files: () => [...files, { name: "No time", kind: "base", titleId: "0100000000099000", size: 1, mtime: null }],
    patches: () => [
      { name: "Old", title_id: "0100000000001000", updated_at: 10 },
      { name: "New", title_id: "0100000000002000", updated_at: 30 },
      { name: "App", homebrew: "app", updated_at: 20 },
    ],
    nameOf: (id) => (id === "0100000000002000" ? "Second game" : null),
  });
  const { added } = await o.read();
  assert.equal(added.games.length, 8);
  assert.deepEqual(added.games[0], { name: "Game 9", kind: "update", titleId: "0100000000009000", version: 0, at: 1_009_000 });
  assert.ok(!added.games.some((g) => g.name === "No time"));
  assert.deepEqual(added.patches.map((p) => [p.name, p.game, p.at]), [["New", "Second game", 30_000], ["App", null, 20_000], ["Old", null, 10_000]]);
});

test("a patch listing that fails leaves the patches empty and the rest standing", async () => {
  const { o } = overviewWith({ patches: async () => { throw new Error("scan"); } });
  const r = await o.read();
  assert.deepEqual(r.added.patches, []);
  assert.ok(r.status.games);
});

test("an added patch carries what the edit dialog fills and posts back, so a save from the overview keeps its fields", async () => {
  const { o } = overviewWith({
    patches: () => [{
      id: "p1", name: "Patch", title_id: "0100000000002000", updated_at: 30, size: 9, files: 2, hash: "x",
      ko: { name: "패치" }, description: "d", version: "1.0", author: "a", game_version: "1.2.0", update_version: 65536, required: true,
    }],
    nameOf: () => "Game",
  });
  const { added } = await o.read();
  assert.deepEqual(added.patches[0], {
    id: "p1", name: "Patch", game: "Game", titleId: "0100000000002000", at: 30_000, size: 9, files: 2,
    ko: { name: "패치" }, description: "d", version: "1.0", author: "a", game_version: "1.2.0", update_version: 65536,
  });
});

test("a patch edit shows at once: the kept answer is read again when the patch information changed", async () => {
  let rev = 1;
  const { o, calls } = overviewWith({ patchRevision: () => rev });
  await o.read();
  await o.read();
  assert.equal(calls.files, 1);
  rev = 2;
  await o.read();
  assert.equal(calls.files, 2);
});
