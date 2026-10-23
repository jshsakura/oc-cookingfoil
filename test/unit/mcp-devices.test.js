import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// device_list and device_set: served by MCP alone, a console named by its 8-character code.
process.env.COOK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cook-mcp-devices-"));
process.env.COOK_DEVICE_LIMIT = "0";

const { registry } = await import("../../src/capabilities/registry.js");
const store = await import("../../src/security/store.js");
const { deviceCode } = await import("../../src/security/pairing-link.js");
const { servedTools } = await import("../../src/mcp/tools.js");

const key = (c) => c.repeat(64);
const list = registry.byId("device_list");
const set = registry.byId("device_set");
const ctx = { token: { id: "t1", owner: "alice" }, by: { name: "t1" } };
const run = (input) => set.handler(ctx, input);
const preview = (input) => set.preview(ctx, input);

test("the routes tokens are refused are served over MCP, and the HTTP lane stays shut", () => {
  assert.ok(servedTools().includes(set));
  assert.equal(set.token, false);
  assert.equal(set.mcp, true);
  assert.deepEqual(set.also.sort(), ["POST /admin/api/clients/:id/revoke", "POST /admin/api/devices/admin", "POST /admin/api/devices/label", "POST /admin/api/devices/revoke"]);
});

test("device_list names waiting and approved consoles by code, never by key", async () => {
  store.recordPendingDevice(key("a"), { name: "Living room", quiet: true });
  const out = await list.handler(ctx, {});
  assert.equal(out.waiting.length, 1);
  assert.equal(out.waiting[0].code, deviceCode(key("a")));
  assert.equal(out.waiting[0].name, "Living room");
  assert.ok(!JSON.stringify(out).includes(key("a")));
});

test("approving previews first, then approves under the token's account", async () => {
  const code = deviceCode(key("a"));
  const p = await preview({ device: code, op: "approve", label: "TV" });
  assert.equal(p.console.state, "pending");
  assert.equal(p.refused, null);
  assert.ok(!store.isDeviceApproved(key("a")), "a preview changes nothing");
  const done = await run({ device: code.toLowerCase(), op: "approve", label: "TV" });
  assert.equal(done.label, "TV");
  assert.ok(store.isDeviceApproved(key("a")));
  assert.equal(store.deviceAddedBy(key("a")), "alice");
});

test("rename, admin and revoke work on an approved console only as asked", async () => {
  const code = deviceCode(key("a"));
  await run({ device: code, op: "rename", label: "  Bedroom  " });
  assert.equal((await list.handler(ctx, {})).approved[0].label, "Bedroom");
  assert.equal((await run({ device: code, op: "admin", on: true })).admin, true);
  assert.equal(store.isDeviceAdmin(key("a")), true);
  await run({ device: code, op: "revoke" });
  assert.ok(!store.isDeviceApproved(key("a")));
  assert.deepEqual((await list.handler(ctx, {})).approved, []);
});

test("bad calls say what to fix", async () => {
  await assert.rejects(run({ device: "nope", op: "approve" }), /8-character code/);
  await assert.rejects(run({ device: "00000000", op: "revoke" }), (e) => e.status === 404 && /device_list/.test(e.message));
  store.recordPendingDevice(key("b"), { quiet: true });
  const code = deviceCode(key("b"));
  await assert.rejects(run({ device: code, op: "rename", label: "x" }), (e) => e.status === 409);
  await assert.rejects(run({ device: code, op: "admin" }), /on: true or false/);
  await assert.rejects(run({ device: code, op: "fly" }), /op is one of/);
});

test("a waiting client download is listed and cancelled by its id", async () => {
  const enroll = await import("../../src/security/enroll-tokens.js");
  const made = enroll.issue("alice");
  const id = enroll.list({ owner: "alice" })[0]?.id;
  assert.ok(id, `a download was made (${typeof made})`);
  assert.equal((await list.handler(ctx, {})).downloads[0].id, id);
  await run({ device: id, op: "cancel_download" });
  assert.deepEqual((await list.handler(ctx, {})).downloads, []);
  await assert.rejects(run({ device: id, op: "cancel_download" }), (e) => e.status === 404);
});

test("a Google owner's token approves under google:<email>, the name account_set revokes by", async () => {
  const google = await import("../../src/security/google-accounts.js");
  google.signIn({ sub: "sub1", email: "boss@example.com" });
  store.recordPendingDevice(key("d"), { quiet: true });
  await set.handler({ token: { id: "t2", owner: "google:sub1" } }, { device: deviceCode(key("d")), op: "approve" });
  assert.equal(store.deviceAddedBy(key("d")), "google:boss@example.com");
});
