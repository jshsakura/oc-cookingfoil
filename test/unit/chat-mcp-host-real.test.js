import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The host in front of CookingFoil's own MCP server and capability registry, not a stand-in.
process.env.COOK_DATA_DIR = mkdtempSync(path.join(tmpdir(), "cook-chat-host-"));
const { Client, InMemoryTransport } = await import("@modelcontextprotocol/client");
const { buildServer } = await import("../../src/mcp/server.js");
const { createMcpHost } = await import("../../src/chat/mcp-host.js");
const { DEFAULT_TIERS } = await import("../../src/chat/policy.js");

const USER = { account: "user-1", admin: false };
let host;

before(async () => {
  const server = buildServer({ token: { id: null, label: "chat", owner: null }, by: { type: "chat", name: "user-1" } });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await server.connect(s);
  const client = new Client({ name: "chat-host", version: "1" });
  await client.connect(c);
  host = createMcpHost({ client });
});

test("the model is offered no blocked action and no confirm argument", async () => {
  const tools = await host.tools();
  assert.ok(tools.length > 0);
  const blocked = Object.entries(DEFAULT_TIERS).filter(([, t]) => t === "blocked").map(([id]) => id);
  for (const t of tools) {
    const offered = t.inputSchema.properties?.action?.enum ?? [];
    assert.deepEqual(offered.filter((a) => blocked.includes(a)), [], `${t.name} offers a blocked action`);
    assert.equal(t.inputSchema.properties?.confirm, undefined, `${t.name} asks the model for confirm`);
  }
});

test("every action the real server serves is either offered with a tier or left out on purpose", async () => {
  const { areaTools } = await import("../../src/mcp/tools.js");
  const served = areaTools().flatMap((a) => a.caps.map((c) => c.id));
  const unlisted = served.filter((id) => !Object.hasOwn(DEFAULT_TIERS, id));
  assert.deepEqual(unlisted, [], `served over MCP but no tier in src/chat/policy.js: ${unlisted.join(", ")}`);
});

test("a read action runs against the real server", async () => {
  const r = await host.call(USER, { tool: "help", arguments: {} });
  assert.equal(r.status, "done");
});

test("a removal asked for by name is refused before it reaches the server", async () => {
  const r = await host.call({ account: "admin-1", admin: true }, { tool: "library", arguments: { action: "library_files_remove", args: { rels: ["x.nsp"] } } });
  assert.equal(r.status, "denied");
});
