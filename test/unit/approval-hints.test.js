import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// A request waiting for the admin (a console's code, a Google account) tells the open admin pages,
// so they read the waiting list again. The hint names the kind and nothing else.
process.env.COOK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cf-approval-hints-"));
process.env.COOK_TELEGRAM_BOT_TOKEN = "";
process.env.COOK_TELEGRAM_CHAT_ID = "";
const store = await import("../../src/security/store.js");
const accounts = await import("../../src/security/google-accounts.js");
const { bus } = await import("../../src/realtime/events.js");

const KEY = "A1".repeat(32);
const KEY2 = "B2".repeat(32);

let admin;
let user;
let off = [];
beforeEach(() => {
  for (const f of off) f();
  admin = [];
  user = [];
  off = [bus.subscribe({ account: "owner", admin: true }, (e) => admin.push(e)), bus.subscribe({ account: "alice", admin: false }, (e) => user.push(e))];
});
const approvals = (list) => list.filter((e) => e.topic === "approvals").map((e) => e.payload);

test("a console that asks to pair tells the admin pages once, not on every repeat", () => {
  store.recordPendingDevice(KEY, { quiet: true });
  store.recordPendingDevice(KEY, { quiet: true });
  store.recordPendingDevice(KEY, { quiet: true });
  assert.deepEqual(approvals(admin), [{ kind: "device" }]);
});

test("a request that gains a note or a name tells again, since the row changed", () => {
  store.recordPendingDevice(KEY2, { quiet: true });
  store.recordPendingDevice(KEY2, { quiet: true, message: "let me in" });
  store.recordPendingDevice(KEY2, { quiet: true, message: "let me in" });
  assert.equal(approvals(admin).length, 2);
});

test("approving, dismissing and revoking a console tell the admin pages", () => {
  store.recordPendingDevice(KEY, { quiet: true });
  admin.length = 0;
  store.approveDevice(KEY, { label: "Living room", addedBy: "owner", admin: false });
  assert.deepEqual(approvals(admin), [{ kind: "device" }]);
  admin.length = 0;
  store.revokeDevice(KEY);
  assert.deepEqual(approvals(admin), [{ kind: "device" }]);
  store.recordPendingDevice(KEY2, { quiet: true });
  admin.length = 0;
  store.dismissPending(KEY2);
  assert.deepEqual(approvals(admin), [{ kind: "device" }]);
});

test("dismissing what is not waiting tells nobody", () => {
  admin.length = 0;
  store.dismissPending("C3".repeat(32));
  assert.deepEqual(approvals(admin), []);
});

test("a new Google account waiting for approval, and each decision on it, tell the admin pages", () => {
  accounts.signIn({ sub: "sub-1", email: "new@example.com" }, 1000);
  assert.deepEqual(approvals(admin), [{ kind: "account" }]);
  admin.length = 0;
  accounts.setStatus("sub-1", "approved", 2000);
  accounts.remove("sub-1");
  assert.deepEqual(approvals(admin), [{ kind: "account" }, { kind: "account" }]);
});

test("a known account signing in again does not tell anyone", () => {
  accounts.signIn({ sub: "sub-2", email: "again@example.com" }, 1000);
  admin.length = 0;
  accounts.signIn({ sub: "sub-2", email: "again@example.com" }, 5000);
  assert.deepEqual(approvals(admin), []);
});

test("only admins hear it, and the hint carries no key, email or name", () => {
  accounts.signIn({ sub: "sub-3", email: "private@example.com" }, 1000);
  store.recordPendingDevice(KEY2, { quiet: true, name: "My Switch" });
  assert.deepEqual(approvals(user), []);
  const text = JSON.stringify(admin);
  assert.doesNotMatch(text, /private@example\.com|My Switch|sub-3/);
  assert.ok(!text.includes(KEY2));
});
