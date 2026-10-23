import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The admin area's server, settings, alert, integration and job tools, called as MCP calls them.
process.env.COOK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cook-mcp-admin-"));
process.env.COOK_SECRET_KEY ??= "dGVzdC1rZXktbm90LWEtc2VjcmV0LTAxMjM0NTY3ODk=";

const { registry } = await import("../../src/capabilities/registry.js");
const { servedTools } = await import("../../src/mcp/tools.js");
const integrations = await import("../../src/security/integrations.js");
const serverSettings = await import("../../src/security/server-settings.js");

const cap = (id) => registry.byId(id);
const ctx = { token: { id: "t1", owner: "boss" }, by: { name: "t1" } };

test("every admin tool is served, and the ones the HTTP lane refuses are MCP-only", () => {
  for (const id of ["server_status", "server_restart", "settings_get", "settings_set", "server_task", "alerts_get", "alerts_set", "integration_list", "integration_set", "job_cancel", "device_set", "account_set"]) {
    assert.ok(servedTools().includes(cap(id)), `${id} is served`);
  }
  for (const id of ["server_restart", "alerts_set", "device_set", "account_set"]) assert.equal(cap(id).mcp, true, id);
});

test("settings_get lists values and what only the admin page may change; one name gives its compose value", async () => {
  const all = await cap("settings_get").handler(ctx, {});
  assert.ok("nszLevel" in all.values);
  assert.ok(all.adminOnly.includes("passwordLogin") && all.adminOnly.includes("mcpEnabled"));
  const one = await cap("settings_get").handler(ctx, { name: "nszLevel" });
  assert.deepEqual(Object.keys(one.values), ["nszLevel"]);
  await assert.rejects(cap("settings_get").handler(ctx, { name: "nope" }), (e) => e.status === 404);
});

test("settings_set previews the change, saves it, and refuses sign-in settings and unknown names", async () => {
  const set = cap("settings_set");
  const before = serverSettings.describe().backupDays.value;
  const to = before === 9 ? 8 : 9;
  const p = await set.preview(ctx, { values: { backupDays: to } });
  assert.deepEqual(p.changed, ["backupDays"]);
  assert.equal(serverSettings.describe().backupDays.value, before, "a preview saves nothing");
  assert.deepEqual((await set.handler(ctx, { values: { backupDays: to } })).changed, ["backupDays"]);
  assert.equal(serverSettings.describe().backupDays.value, to);
  assert.deepEqual((await set.handler(ctx, { values: { backupDays: null } })).changed, ["backupDays"]);
  await assert.rejects(set.handler(ctx, { values: { passwordLogin: false } }), (e) => e.status === 403 && /admin page/.test(e.message));
  await assert.rejects(set.handler(ctx, { values: { nope: 1 } }), (e) => e.status === 404);
  await assert.rejects(set.handler(ctx, { values: { backupDays: "many" } }), (e) => e.status === 400 && /backupDays/.test(e.message));
  await assert.rejects(set.handler(ctx, { values: {} }), /object of setting name/);
});

test("server_task rejects an unknown task, and backup makes a backup", async () => {
  const task = cap("server_task");
  await assert.rejects(task.handler(ctx, { task: "fly" }), /task is one of/);
  assert.match((await task.preview(ctx, { task: "backup" })).changes, /backup/);
  assert.deepEqual(await task.handler(ctx, { task: "backup" }), { started: "backup", already: false });
});

test("server_restart previews what it interrupts and does not restart when only previewed", async () => {
  const p = await cap("server_restart").preview(ctx, {});
  assert.equal(typeof p.inflight, "number");
  assert.match(p.changes, /drop/);
  assert.equal(typeof (await cap("server_status").handler(ctx, {})).uptime, "number");
});

test("alerts_get never carries the bot token, and alerts_set save keeps the stored token", async () => {
  integrations.save("telegram", { botToken: "123456:AAAA0000AAAA0000AAAA0000AAAA0000AAA", chatId: "1", events: "-", buttons: "off", approvers: "", lang: "" });
  const got = await cap("alerts_get").handler(ctx, {});
  assert.equal(got.tokenSet, true);
  assert.ok(!JSON.stringify(got).includes("AAAA0000"));
  await cap("alerts_set").handler(ctx, { op: "save", chatId: "42", buttons: true });
  const after = integrations.get("telegram");
  assert.equal(after.chatId, "42");
  assert.ok(after.botToken.startsWith("123456:"), "the stored token stays");
  assert.match((await cap("alerts_set").preview(ctx, { op: "clear" })).changes, /Forgets/);
  await cap("alerts_set").handler(ctx, { op: "clear" });
  assert.equal((await cap("alerts_get").handler(ctx, {})).tokenSet, false);
  await assert.rejects(cap("alerts_set").handler(ctx, { op: "chats" }), (e) => e.status === 409);
  await assert.rejects(cap("alerts_set").handler(ctx, { op: "fly" }), /op is one of/);
});

test("integration_list shows no key values, and clear and test answer for a service with no key", async () => {
  integrations.save("github", { token: "ghp_AAAA0000AAAA0000AAAA0000AAAA0000AAAA" });
  const list = await cap("integration_list").handler(ctx, {});
  assert.ok(!JSON.stringify(list).includes("AAAA0000"));
  assert.ok(!list.services.some((s) => s.service === "telegram"));
  assert.equal(list.services.find((s) => s.service === "github").source, "admin");
  await cap("integration_set").handler(ctx, { service: "github", op: "clear" });
  const test_ = await cap("integration_set").handler(ctx, { service: "github", op: "test" });
  assert.equal(test_.ok, false);
  await assert.rejects(cap("integration_set").handler(ctx, { service: "telegram", op: "test" }), /service is one of/);
});

test("job_cancel says which jobs it can stop", async () => {
  await assert.rejects(cap("job_cancel").preview(ctx, { id: "nope" }), (e) => e.status === 404 && /jobs_list/.test(e.message));
  await assert.rejects(cap("job_cancel").handler(ctx, { id: "nope" }), (e) => e.status === 404);
});
