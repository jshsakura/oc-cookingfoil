import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// A Google account is filed by its sub, which never changes; its email can. Its consoles, downloads
// and lists stay its own when the email changes, and ending the account ends what it holds.
const data = fs.mkdtempSync(path.join(os.tmpdir(), "cf-google-sub-"));
Object.assign(process.env, { COOK_DATA_DIR: data, COOK_DEVICE_PAIRING: "true", COOK_TITLEDB_AUTO_FETCH: "false" });
const { securityDb } = await import("../../src/db/database.js");
const { migrateGoogleOwners } = await import("../../src/security/google-owner-migration.js");
const accounts = await import("../../src/security/google-accounts.js");
const store = await import("../../src/security/store.js");
const { deviceOwner, suspension, holds } = await import("../../src/security/device-owner.js");
const { revokeOwnedBy } = await import("../../src/security/account-access.js");
const { hashAccessKey } = await import("../../src/security/pairing.js");

const put = (kind, id, value) => securityDb().prepare("INSERT OR REPLACE INTO records (kind, id, data) VALUES (?, ?, ?)").run(kind, id, JSON.stringify(value));
const get = (kind, id) => {
  const row = securityDb().prepare("SELECT data FROM records WHERE kind = ? AND id = ?").get(kind, id);
  return row ? JSON.parse(row.data) : null;
};
const ids = (kind) => securityDb().prepare("SELECT id FROM records WHERE kind = ?").all(kind).map((r) => r.id);
const chatFolder = (account) => crypto.createHash("sha256").update(account).digest("base64url");

test("records filed under an account's email move to its sub, once, and an unknown email stays", () => {
  put("google-account", "sub-old", { sub: "sub-old", email: "Friend@example.org", status: "approved", role: "user", createdAt: 1 });
  put("device", "A".repeat(64), { label: "living room", addedBy: "google:friend@example.org" });
  put("device", "B".repeat(64), { label: "gone", addedBy: "google:left@example.org" });
  put("enroll-token", "t1", { id: "t1", owner: "google:Friend@example.org" });
  put("pending-device", "C".repeat(64), { at: 1, download: { owner: "google:friend@example.org", id: "t1" } });
  put("device-send", "s1", { id: "s1", sentBy: "google:friend@example.org" });
  put("wishlist", "google:friend@example.org", { items: ["0100000000010000"] });
  put("send-history", "google:friend@example.org", { items: [] });
  put("enroll-ledger", "google:friend@example.org", { at: [1] });
  const chat = path.join(data, "chat");
  fs.mkdirSync(path.join(chat, chatFolder("user:google:Friend@example.org")), { recursive: true });

  assert.equal(migrateGoogleOwners(securityDb(), { chatDir: chat }), 8, "seven records and one chat folder");
  assert.equal(get("device", "A".repeat(64)).addedBy, "google:sub-old");
  assert.equal(get("device", "B".repeat(64)).addedBy, "google:left@example.org", "an email no account has stays");
  assert.equal(get("enroll-token", "t1").owner, "google:sub-old");
  assert.equal(get("pending-device", "C".repeat(64)).download.owner, "google:sub-old");
  assert.equal(get("device-send", "s1").sentBy, "google:sub-old");
  for (const kind of ["wishlist", "send-history", "enroll-ledger"]) assert.deepEqual(ids(kind), ["google:sub-old"], kind);
  assert.ok(fs.existsSync(path.join(chat, chatFolder("user:google:sub-old"))), "the account's chats follow it");
  assert.equal(migrateGoogleOwners(securityDb(), { chatDir: chat }), 0, "a second run changes nothing");
});

test("a console filed by sub stays the account's when its email changes, and ending the account ends it", async () => {
  await store.load();
  accounts.signIn({ sub: "sub-new", email: "before@example.org" });
  accounts.setStatus("sub-new", "approved");
  const owner = accounts.ownerOf("sub-new");
  const key = "D".repeat(64);
  store.approveDevice(key, { label: "bedroom", addedBy: owner, accessKeyHash: hashAccessKey("k") });

  accounts.signIn({ sub: "sub-new", email: "after@example.org" });
  const o = deviceOwner(key);
  assert.equal(o.state, "bound");
  assert.equal(o.active, true, "the account still holds it");
  assert.equal(o.owner.displayName, accounts.maskEmail("after@example.org"), "shown by the current email");
  assert.equal(suspension(key), null);
  assert.ok(holds(owner, store.deviceAddedBy(key)));

  assert.equal(revokeOwnedBy(owner).consoles, 1);
  assert.equal(store.isDeviceApproved(key), false);
});

test("an owner kept in the email form still names its account", () => {
  accounts.signIn({ sub: "sub-kept", email: "kept@example.org" });
  assert.equal(accounts.accountOfOwner("google:Kept@example.org")?.sub, "sub-kept");
  assert.equal(accounts.canonicalOwner("google:kept@example.org"), "google:sub-kept");
  assert.equal(accounts.canonicalOwner("google:nobody@example.org"), "google:nobody@example.org");
  assert.equal(accounts.canonicalOwner("alice"), "alice");
});
