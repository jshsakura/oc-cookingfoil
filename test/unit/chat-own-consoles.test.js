import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The chat reaches only the consoles an account approved itself; a name is not a right to the admin's.
process.env.COOK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cf-own-consoles-"));
process.env.COOK_TELEGRAM_BOT_TOKEN = "";
process.env.COOK_TELEGRAM_CHAT_ID = "";
const store = await import("../../src/security/store.js");
const sends = await import("../../src/security/device-sends.js");
const { deviceCode } = await import("../../src/security/pairing-link.js");
const { ownConsoles, sendGame } = await import("../../src/chat/own-consoles.js");

const KEYS = { alice: "A1".repeat(32), bob: "B2".repeat(32), admin: "C3".repeat(32), alice2: "D4".repeat(32) };
for (const [who, key] of Object.entries(KEYS)) {
  store.approveDevice(key, { label: `${who}'s console`, addedBy: who.replace(/\d$/, ""), admin: false });
  sends.markRead(key);
}

test("an account lists only the consoles it approved", () => {
  assert.deepEqual(ownConsoles("alice").map((c) => c.code).sort(), [deviceCode(KEYS.alice), deviceCode(KEYS.alice2)].sort());
  assert.deepEqual(ownConsoles("bob").map((c) => c.code), [deviceCode(KEYS.bob)]);
  assert.deepEqual(ownConsoles("nobody"), []);
});

test("a console the admin approved is no one's to reach from the chat, the admin page's included", () => {
  assert.deepEqual(ownConsoles("admin"), []);
});

test("sending names a console of the caller's, or says which they have", () => {
  const game = "0100000000010000";
  assert.throws(() => sendGame("alice", { game, device: deviceCode(KEYS.bob) }), (e) => e.status === 404);
  assert.throws(() => sendGame("alice", { game, device: deviceCode(KEYS.admin) }), (e) => e.status === 404);
  assert.throws(() => sendGame("admin", { game, device: deviceCode(KEYS.admin) }), (e) => e.status === 404);
  assert.throws(() => sendGame("alice", { game }), (e) => e.status === 400 && e.message.includes(deviceCode(KEYS.alice)) && !e.message.includes(deviceCode(KEYS.bob)));
  assert.throws(() => sendGame("nobody", { game }), (e) => e.status === 404);
  assert.throws(() => sendGame("alice", { game: "nope" }), (e) => e.status === 400);
});
