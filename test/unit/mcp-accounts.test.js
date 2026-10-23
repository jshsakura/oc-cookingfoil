import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// account_list and account_set: password users and Google accounts through MCP, never a password out.
process.env.COOK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cook-mcp-accounts-"));

const { registry } = await import("../../src/capabilities/registry.js");
const users = await import("../../src/security/users.js");
const google = await import("../../src/security/google-accounts.js");
const store = await import("../../src/security/store.js");

const list = registry.byId("account_list");
const set = registry.byId("account_set");
const as = (owner) => ({ token: { id: "t1", owner }, by: { name: "t1" } });
const boss = as("boss");

users.add("boss", "boss-password-1", "admin");
users.add("kim", "kim-password-1", "user");
google.signIn({ sub: "s1", email: "g1@example.com" });

test("account_list gives one row per account and never a password or hash", async () => {
  const out = await list.handler(boss, {});
  assert.deepEqual(out.accounts.map((a) => a.id).sort(), ["boss", "google:s1", "kim"]);
  assert.equal(out.accounts.find((a) => a.id === "google:s1").state, "pending");
  assert.ok(!/hash|secret|-password-1/i.test(JSON.stringify(out)));
});

test("a preview counts what disabling would end and changes nothing", async () => {
  store.approveDevice("c".repeat(64), { label: "TV", addedBy: "kim", accessKeyHash: "h" });
  const p = await set.preview(boss, { account: "kim", op: "disable" });
  assert.deepEqual(p.revokes, { consoles: 1, enrollTokens: 0 });
  assert.ok(store.isDeviceApproved("c".repeat(64)));
  assert.equal(users.list().find((u) => u.name === "kim").enabled, true);
});

test("disable ends the consoles, enable and role work, remove deletes the account", async () => {
  const out = await set.handler(boss, { account: "kim", op: "disable" });
  assert.equal(out.revoked.consoles, 1);
  assert.ok(!store.isDeviceApproved("c".repeat(64)));
  await set.handler(boss, { account: "kim", op: "enable" });
  await set.handler(boss, { account: "kim", op: "role", role: "admin" });
  assert.equal(users.list().find((u) => u.name === "kim").role, "admin");
  await set.handler(boss, { account: "kim", op: "remove" });
  assert.ok(!users.list().some((u) => u.name === "kim"));
});

test("Google accounts are approved, demoted and removed by their google: id", async () => {
  await set.handler(boss, { account: "google:s1", op: "enable" });
  assert.equal(google.get("s1").status, "approved");
  await set.handler(boss, { account: "google:s1", op: "role", role: "admin" });
  assert.equal(google.get("s1").role, "admin");
  await set.handler(boss, { account: "google:s1", op: "remove" });
  assert.equal(google.get("s1") ?? null, null);
});

test("a token cannot lower the account that owns it, and bad calls say what to fix", async () => {
  await assert.rejects(set.handler(boss, { account: "boss", op: "disable" }), (e) => e.status === 409 && /owns it/.test(e.message));
  await assert.rejects(set.preview(boss, { account: "boss", op: "role", role: "user" }), (e) => e.status === 409);
  await set.handler(boss, { account: "boss", op: "role", role: "admin" });
  await assert.rejects(set.handler(boss, { account: "nobody", op: "enable" }), (e) => e.status === 404 && /account_list/.test(e.message));
  await assert.rejects(set.handler(boss, { account: "boss", op: "role" }), /role: admin or user/);
  await assert.rejects(set.handler(boss, { account: "boss", op: "fly" }), /op is one of/);
});
