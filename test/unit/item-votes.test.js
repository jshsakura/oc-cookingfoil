import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// 잘 돼요 / 안 돼요: one vote per voter per item, kept across a reload.
process.env.COOK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cf-item-votes-"));
const votes = await import("../../src/meta/item-votes.js");

test("votes are counted per item, a new vote replaces the old one and null clears it", () => {
  const id = "m-0123456789ab";
  assert.deepEqual(votes.tally("homebrew", id), { up: 0, down: 0 });
  assert.equal(votes.vote("homebrew", id, "acct:alice", "up"), true);
  assert.equal(votes.vote("homebrew", id, "dev:abc", "up"), true);
  assert.equal(votes.vote("homebrew", id, "google:123", "down"), true);
  assert.deepEqual(votes.tally("homebrew", id), { up: 2, down: 1 });
  assert.equal(votes.vote("homebrew", id, "acct:alice", "down"), true);
  assert.deepEqual(votes.tally("homebrew", id), { up: 1, down: 2 }, "changing replaces, never adds");
  assert.equal(votes.mine("homebrew", id, "acct:alice"), "down");
  assert.equal(votes.mine("homebrew", id, "acct:bob"), null);
  assert.equal(votes.mine("homebrew", id, null), null);
  votes.reset();
  assert.deepEqual(votes.tally("homebrew", id), { up: 1, down: 2 }, "read back from the file");
  assert.equal(votes.vote("homebrew", id, "acct:alice", null), true);
  assert.equal(votes.mine("homebrew", id, "acct:alice"), null);
  assert.deepEqual(votes.fields("homebrew", id, "dev:abc"), { votes: { up: 1, down: 1 }, my_vote: "up" });
});

test("the same id under another kind is another item", () => {
  votes.vote("retro", "snes-1", "acct:alice", "up");
  assert.deepEqual(votes.tally("patch", "snes-1"), { up: 0, down: 0 });
  assert.deepEqual(votes.tally("retro", "snes-1"), { up: 1, down: 0 });
});

test("forget drops every vote of an item and leaves the others", () => {
  votes.vote("save", "0100000000010000-aaaaaaaaaaaa", "acct:alice", "up");
  votes.vote("save", "0100000000010000-bbbbbbbbbbbb", "acct:alice", "down");
  votes.forget("save", "0100000000010000-aaaaaaaaaaaa");
  votes.forget("save", "0100000000010000-cccccccccccc");
  votes.reset();
  assert.deepEqual(votes.tally("save", "0100000000010000-aaaaaaaaaaaa"), { up: 0, down: 0 });
  assert.deepEqual(votes.tally("save", "0100000000010000-bbbbbbbbbbbb"), { up: 0, down: 1 });
});

test("unknown kinds, malformed ids or voters and bad values are refused", () => {
  assert.equal(votes.vote("game", "0100000000010000", "acct:alice", "up"), false);
  assert.equal(votes.vote("patch", "../x", "acct:alice", "up"), false);
  assert.equal(votes.vote("patch", "p-1", "alice", "up"), false);
  assert.equal(votes.vote("patch", "p-1", "acct:alice", "meh"), false);
  assert.deepEqual(votes.tally("patch", "p-1"), { up: 0, down: 0 });
});

test("a request votes as its web account, else its console, else nobody", () => {
  assert.equal(votes.voterOf({ webUser: { kind: "password", name: "alice" } }), "acct:alice");
  assert.equal(votes.voterOf({ webUser: { kind: "google", sub: "123" } }), "google:123");
  const dev = votes.voterOf({ pairedDevice: "AB".repeat(32) });
  assert.match(dev, /^dev:[0-9a-f]{32}$/);
  assert.ok(!dev.includes("AB".repeat(4)), "the device key itself is not stored");
  assert.equal(votes.voterOf({ sessionDevice: "AB".repeat(32), auth: { user: "alice" } }), dev, "a console's session votes as the console");
  assert.equal(votes.voterOf({}), null);
  assert.equal(votes.voterOf({ auth: { user: "alice" }, apiToken: {} }), null, "an automation token does not vote");
});
