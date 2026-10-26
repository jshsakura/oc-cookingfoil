import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The queue of downloads a user sent to a console: dedupe, the cap, the 7-day expiry, who can remove what.
process.env.COOK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cf-sends-unit-"));
const sends = await import("../../src/security/device-sends.js");
const { cleanRelPath } = await import("../../src/routes/device-sends.js");

const KEY_A = "A1".repeat(32);
const KEY_B = "B2".repeat(32);
const file = (n) => ({ path: `Game ${n}/Game ${n}.nsp`, name: `Game ${n}`, titleId: "0100000000010000", size: 10 });

test("an item is stamped by the server and a console lists its own, oldest first", () => {
  sends.resetForTests();
  const t0 = Date.UTC(2026, 9, 26);
  const second = sends.add(KEY_A, file(2), "alice", t0 + 5000).item;
  const first = sends.add(KEY_A, file(1), "alice", t0).item;
  sends.add(KEY_B, file(3), "bob", t0);
  assert.match(first.id, /^[0-9a-f]{12}$/);
  assert.equal(first.sentAt, new Date(t0).toISOString());
  assert.deepEqual(sends.list(KEY_A, t0 + 6000).map((i) => i.id), [first.id, second.id], "sorted by sentAt, not by insertion");
  assert.deepEqual(sends.list(KEY_B, t0 + 6000).map((i) => i.sentBy), ["bob"]);
});

test("the same path for the same console returns the waiting item and adds nothing", () => {
  sends.resetForTests();
  const a = sends.add(KEY_A, file(1), "alice");
  const again = sends.add(KEY_A, file(1), "alice");
  assert.equal(again.existing, true);
  assert.equal(again.item.id, a.item.id);
  assert.equal(sends.list(KEY_A).length, 1);
  assert.equal(sends.add(KEY_B, file(1), "alice").existing, false, "another console is another queue");
});

test("a console holds at most MAX_PENDING and refuses the next", () => {
  sends.resetForTests();
  for (let i = 0; i < sends.MAX_PENDING; i++) assert.ok(sends.add(KEY_A, file(i), "alice").item);
  assert.deepEqual(sends.add(KEY_A, file(999), "alice"), { refused: "full" });
  assert.equal(sends.add(KEY_A, file(0), "alice").existing, true, "a path already waiting is still answered");
  assert.ok(sends.add(KEY_B, file(999), "alice").item, "the cap is per console");
});

test("an item lapses after seven days", () => {
  sends.resetForTests();
  const t0 = Date.UTC(2026, 9, 1);
  sends.add(KEY_A, file(1), "alice", t0);
  assert.equal(sends.list(KEY_A, t0 + sends.TTL_MS - 1).length, 1);
  assert.equal(sends.list(KEY_A, t0 + sends.TTL_MS).length, 0);
  assert.equal(sends.add(KEY_A, file(1), "alice", t0 + sends.TTL_MS).existing, false, "a lapsed one can be sent again");
});

test("removing needs the console, and cancelling needs the sender", () => {
  sends.resetForTests();
  const a = sends.add(KEY_A, file(1), "alice").item;
  assert.equal(sends.remove(KEY_B, [a.id]), 0, "another console cannot ack it");
  assert.equal(sends.remove(KEY_A, [a.id], { sentBy: "bob" }), 0, "another sender cannot cancel it");
  assert.equal(sends.find(a.id, { sentBy: "bob" }), null);
  assert.equal(sends.find(a.id, { sentBy: "alice" }).deviceKey, KEY_A);
  assert.equal(sends.remove(KEY_A, [a.id]), 1);
  assert.deepEqual(sends.list(KEY_A), []);
});

test("the queue is kept in the security database and forgotten with the console", async () => {
  sends.resetForTests();
  const a = sends.add(KEY_A, file(1), "alice").item;
  const fresh = await import("../../src/security/device-sends.js?reload");
  assert.equal(fresh.list(KEY_A)[0].id, a.id);
  sends.forget(KEY_A);
  assert.deepEqual(sends.list(KEY_A), []);
});

test("a path is relative to the library and never climbs out of it", () => {
  assert.equal(cleanRelPath("Game/file.nsp"), "Game/file.nsp");
  assert.equal(cleanRelPath("../Game/file.nsp"), "Game/file.nsp", "the item's url form");
  for (const bad of ["../../etc/passwd", "Game/../../x.nsp", "/etc/passwd", "a//b.nsp", "./a.nsp", "a\\b.nsp", "a\0b.nsp", "", "..", null, 5, "x".repeat(2000)]) {
    assert.equal(cleanRelPath(bad), null, String(bad));
  }
});
