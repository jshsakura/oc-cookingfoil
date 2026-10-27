import { test } from "node:test";
import assert from "node:assert/strict";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer, fromJsonSchema } from "@modelcontextprotocol/server";

const { createMcpHost } = await import("../../src/chat/mcp-host.js");

const ADMIN = { account: "admin-1", admin: true };
const USER = { account: "user-1", admin: false };

const text = (value) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
const fail = (code) => ({ isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code, message: "no" } }) }] });

/** A server shaped like CookingFoil's: area tools with action, args and confirm; writes preview first. */
async function fixture(options = {}) {
  const calls = [];
  const server = new McpServer({ name: "fake", version: "1" });
  const area = (name, actions, gated) => server.registerTool(name, {
    description: `${name} area`,
    inputSchema: fromJsonSchema({
      type: "object",
      properties: { action: { type: "string", enum: actions }, args: { type: "object" }, confirm: { type: "string", enum: ["approve"] } },
      required: ["action"],
    }),
  }, async ({ action, args, confirm }) => {
    calls.push({ action, args, confirm });
    if (action === "boom") return fail("INTERNAL");
    if (gated.includes(action) && confirm !== "approve") return text({ preview: { changes: `would run ${action}` }, next: "ask the user" });
    return text({ ran: action, args });
  });
  area("games", ["games_search", "game_art_set", "games_wishlist_set"], ["game_art_set", "games_wishlist_set"]);
  area("admin", ["settings_set", "server_status", "no_preview_set", "boom"], ["settings_set"]);
  area("library", ["library_files_remove", "brand_new_unlisted"], ["library_files_remove", "brand_new_unlisted"]);
  server.registerTool("help", { description: "help", inputSchema: fromJsonSchema({ type: "object", properties: {} }) }, async () => {
    calls.push({ action: "help" });
    return text({ rules: "r" });
  });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await server.connect(s);
  const client = new Client({ name: "host", version: "1" });
  await client.connect(c);
  const host = createMcpHost({ client, ...options });
  return { host, calls, client };
}

const call = (host, ctx, tool, action, args = {}, extra = {}) => host.call(ctx, { tool, arguments: { action, args, ...extra } });

test("an auto read runs and returns the parsed result", async () => {
  const { host, calls } = await fixture();
  const r = await call(host, USER, "games", "games_search", { q: "x" });
  assert.equal(r.status, "done");
  assert.deepEqual(r.result, { ran: "games_search", args: { q: "x" } });
  assert.equal(calls.length, 1);
});

test("an auto write is carried out at once, the host supplies the confirm", async () => {
  const { host, calls } = await fixture();
  const r = await call(host, USER, "games", "games_wishlist_set", { op: "add", titleId: "0100000000010000" });
  assert.equal(r.status, "done");
  assert.equal(calls.at(-1).confirm, "approve");
});

test("a blocked action never reaches the server, even with the model's own confirm", async () => {
  const { host, calls } = await fixture();
  const r = await call(host, ADMIN, "library", "library_files_remove", { rels: ["a"] }, { confirm: "approve" });
  assert.equal(r.status, "denied");
  assert.equal(calls.length, 0);
});

test("an action the policy table does not list is blocked", async () => {
  const { host, calls } = await fixture();
  const r = await call(host, ADMIN, "library", "brand_new_unlisted");
  assert.equal(r.status, "denied");
  assert.equal(calls.length, 0);
});

test("the model's confirm is never forwarded: an approve-tier call only previews", async () => {
  const { host, calls } = await fixture();
  const r = await call(host, ADMIN, "admin", "settings_set", { key: "k" }, { confirm: "approve" });
  assert.equal(r.status, "pending");
  assert.match(r.id, /^[A-Za-z0-9_-]{22}$/);
  assert.deepEqual(r.preview, { changes: "would run settings_set" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].confirm, undefined);
});

test("approving carries out exactly the stored call, once", async () => {
  const { host, calls } = await fixture();
  const p = await call(host, ADMIN, "admin", "settings_set", { key: "k", value: "v" });
  const done = await host.approve(p.id, ADMIN);
  assert.equal(done.status, "done");
  assert.deepEqual(calls.at(-1), { action: "settings_set", args: { key: "k", value: "v" }, confirm: "approve" });
  const again = await host.approve(p.id, ADMIN);
  assert.equal(again.status, "denied");
  assert.equal(calls.filter((c) => c.confirm === "approve").length, 1);
});

test("a non-admin's approve-tier call becomes a request that the requester cannot approve", async () => {
  const { host, calls } = await fixture();
  const p = await call(host, USER, "admin", "settings_set", { key: "k" });
  assert.equal(p.status, "requested");
  assert.equal((await host.approve(p.id, USER)).status, "denied");
  assert.equal(calls.filter((c) => c.confirm === "approve").length, 0);
  assert.equal((await host.approve(p.id, ADMIN)).status, "done");
});

test("another account cannot approve, refuse or see a pending call", async () => {
  const { host } = await fixture();
  const p = await call(host, ADMIN, "admin", "settings_set");
  assert.equal((await host.approve(p.id, { account: "admin-2", admin: true })).status, "denied");
  assert.equal(host.refuse(p.id, { account: "admin-2", admin: true }), false);
  assert.deepEqual(host.pending("admin-2"), []);
  assert.equal(host.pending("admin-1").length, 1);
});

test("a refused call cannot be approved later", async () => {
  const { host } = await fixture();
  const p = await call(host, ADMIN, "admin", "settings_set");
  assert.equal(host.refuse(p.id, ADMIN), true);
  assert.equal((await host.approve(p.id, ADMIN)).status, "denied");
});

test("a pending call lapses after its time", async () => {
  let now = 1_000;
  const { host } = await fixture({ now: () => now, ttlMs: 60_000 });
  const p = await call(host, ADMIN, "admin", "settings_set");
  now += 60_001;
  assert.equal((await host.approve(p.id, ADMIN)).status, "denied");
  assert.deepEqual(host.pending("admin-1"), []);
});

test("an approve-tier call whose server gives no preview is refused rather than run unseen", async () => {
  const { host, calls } = await fixture({ tiers: { no_preview_set: "approve" } });
  const r = await call(host, ADMIN, "admin", "no_preview_set");
  assert.equal(r.status, "denied");
  assert.equal(calls.filter((c) => c.confirm === "approve").length, 0);
});

test("a server error comes back as an error the model can read", async () => {
  const { host } = await fixture({ tiers: { boom: "auto" } });
  const r = await call(host, USER, "admin", "boom");
  assert.equal(r.status, "error");
  assert.equal(r.error.code, "INTERNAL");
});

test("help is offered and runs", async () => {
  const { host } = await fixture();
  const r = await host.call(USER, { tool: "help", arguments: {} });
  assert.equal(r.status, "done");
});

test("tools(): blocked and unlisted actions and the confirm argument are not shown to the model", async () => {
  const { host } = await fixture();
  const tools = await host.tools();
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  assert.ok(byName.games && byName.admin && byName.help);
  assert.equal(byName.library, undefined, "an area with nothing offered is left out");
  assert.deepEqual(byName.games.inputSchema.properties.action.enum, ["games_search", "game_art_set", "games_wishlist_set"]);
  assert.deepEqual(byName.admin.inputSchema.properties.action.enum, ["settings_set", "server_status"]);
  for (const t of tools) assert.equal(t.inputSchema.properties?.confirm, undefined, `${t.name} must not ask the model for confirm`);
});
