import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { fromJsonSchema } from "@modelcontextprotocol/server";

process.env.COOK_DATA_DIR = mkdtempSync(path.join(tmpdir(), "cook-mcp-"));
process.env.COOK_MCP_ENABLED = "true";
const { registry } = await import("../../src/capabilities/registry.js");
const { servedTools, areaTools, AREA_TEXT, gated } = await import("../../src/mcp/tools.js");
const { mcpRoute } = await import("../../src/mcp/route.js");
const { fitJson, errorResult, ToolError } = await import("../../src/mcp/envelope.js");
const { TOKEN_PATHS } = await import("../../src/security/auth-guard.js");

const TOKEN = { id: "0a0a0a0a", label: "test agent" };
let server;
let base;

before(async () => {
  const app = express();
  // Stands in for authGuard's token lane, which sets req.apiToken for a valid token on TOKEN_PATHS.
  app.use((req, _res, next) => {
    if (req.headers.authorization === "Bearer good") req.apiToken = TOKEN;
    next();
  });
  for (const method of ["post", "get", "delete"]) app[method]("/mcp", ...mcpRoute());
  await new Promise((resolve) => (server = app.listen(0, "127.0.0.1", resolve)));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

async function connect(mode = "auto") {
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: "Bearer good" } } });
  const client = new Client({ name: "test", version: "1" }, mode === "auto" ? { versionNegotiation: { mode: "auto" } } : {});
  await client.connect(transport);
  return client;
}

const json = (result) => JSON.parse(result.content[0].text);

test("with MCP off, /mcp answers 404 to everyone without reading the body", async () => {
  const env = await import("../../src/helpers/envs.js");
  env.applyServerSettings({ mcpEnabled: false });
  try {
    for (const auth of ["Bearer good", "Bearer bad"]) {
      const res = await fetch(`${base}/mcp`, { method: "POST", headers: { Authorization: auth, "Content-Type": "application/json" }, body: "{not json" });
      assert.equal(res.status, 404, auth);
      assert.match((await res.json()).error, /MCP is off/);
    }
  } finally {
    env.applyServerSettings({});
  }
  assert.equal(env.mcpEnabled, true, "compose's value comes back");
});

test("/mcp is on the automation token's paths", () => {
  assert.equal(TOKEN_PATHS("/mcp"), true);
});

test("a request without an automation token is refused before MCP sees it", async () => {
  const res = await fetch(`${base}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: "{}" });
  assert.equal(res.status, 401);
  assert.match((await res.json()).error, /automation token/);
});

test("a browser page from another site is refused even with a token", async () => {
  const res = await fetch(`${base}/mcp`, { method: "POST", headers: { Authorization: "Bearer good", Origin: "https://evil.example.com", "Content-Type": "application/json" }, body: "{}" });
  assert.equal(res.status, 403);
});

for (const mode of ["auto", "legacy"]) {
  test(`a ${mode === "auto" ? "2026" : "2025"} client lists help and one tool per area, read-only areas marked so and writing ones asking for confirm`, async () => {
    const client = await connect(mode);
    const { tools } = await client.listTools();
    const areas = areaTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ["help", ...areas.map((a) => a.name)].sort());
    for (const area of areas) {
      const t = tools.find((x) => x.name === area.name);
      const writes = area.caps.some(gated);
      assert.equal(t.annotations?.readOnlyHint, !writes, t.name);
      assert.equal(Boolean(t.inputSchema.properties?.confirm), writes, t.name);
      assert.deepEqual(t.inputSchema.properties.action.enum, area.caps.map((c) => c.id), t.name);
    }
    assert.deepEqual(areas.flatMap((a) => a.caps.map((c) => c.id)).concat("help").sort(), servedTools().map((c) => c.id).sort(), "every served capability is reachable once");
    await client.close();
  });
}

test("a write is served only with a preview of what it would change, and no destructive tool yet", () => {
  assert.ok(servedTools().every((c) => c.token && (c.safety === "read" || (c.safety === "write" && c.preview && c.previewOutput))));
  assert.ok(registry.all.some((c) => c.safety !== "read" && c.token && !c.preview && !servedTools().includes(c)), "token writes without a preview stay off MCP");
});

// tools/list goes with every request: an action costs its name and a share of its area's line, its spec waits for help.
test("tools/list stays small enough to send with every request: at most 120 bytes an action", async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  const size = Buffer.byteLength(JSON.stringify(tools));
  assert.ok(size / servedTools().length <= 120, `tools/list is ${size} bytes for ${servedTools().length} actions`);
  await client.close();
});

test("every area tool says what it covers", () => {
  for (const area of areaTools()) assert.ok(AREA_TEXT[area.name], `AREA_TEXT in src/mcp/tools.js needs a line for ${area.name}`);
});

test("an action is called through its area, and one of another area is refused", async () => {
  const client = await connect();
  const ok = await client.callTool({ name: "games", arguments: { action: "games_search", args: { limit: 1 } } });
  assert.notEqual(ok.isError, true, ok.content[0].text);
  assert.ok(Array.isArray(json(ok).items));
  const wrong = await client.callTool({ name: "games", arguments: { action: "trash_list" } });
  assert.equal(wrong.isError, true);
  const misplaced = await client.callTool({ name: "retro", arguments: { action: "retro_art_sync", args: { confirm: "approve" } } });
  assert.equal(misplaced.isError, true);
  assert.match(json(misplaced).error.message, /next to action/);
  await client.close();
});

test("help without a tool gives the reference and one line per action", async () => {
  const client = await connect();
  const { text } = json(await client.callTool({ name: "help", arguments: {} }));
  assert.match(text, /## Title ids/);
  for (const c of servedTools().filter((x) => x.id !== "help")) assert.ok(text.includes(`\`${c.id}(`), `${c.id} has an index line`);
  await client.close();
});

test("help with a tool gives its input and output field by field", async () => {
  const client = await connect();
  const { text } = json(await client.callTool({ name: "help", arguments: { tool: "games_search" } }));
  assert.match(text, /Call: `games \{ action: "games_search", args: \{ \.\.\.input \} \}`/);
  assert.match(text, /## Input \(args\)\n- `q\?`: string/);
  assert.match(text, /- `items\[\]\.titleId`: string\. base game id/);
  await client.close();
});

test("help for an unknown tool is an error naming the tools there are", async () => {
  const client = await connect();
  const result = await client.callTool({ name: "help", arguments: { tool: "game_delete" } });
  assert.equal(result.isError, true);
  const { error } = json(result);
  assert.equal(error.code, "NOT_FOUND");
  assert.match(error.message, /games_search/);
  await client.close();
});

test("arguments of the wrong type come back as an error the model can read, before the handler runs", async () => {
  const client = await connect();
  const result = await client.callTool({ name: "games", arguments: { action: "games_search", args: { limit: "ten" } } });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /limit/);
  await client.close();
});

test("the reference is also a resource", async () => {
  const client = await connect();
  const { contents } = await client.readResource({ uri: "cookingfoil://reference" });
  assert.match(contents[0].text, /## Tools/);
  await client.close();
});

test("every served tool declares its output", () => {
  for (const c of servedTools()) assert.equal(c.output?.type, "object", `${c.id} has an output schema`);
});

// A write is checked through its preview only: running it here would change the server.
async function conforms(cap, input) {
  const [run, schema] = cap.safety === "read" ? [cap.handler, cap.output] : [cap.preview, cap.previewOutput];
  const out = await run({}, input);
  const checked = await fromJsonSchema(schema)["~standard"].validate(JSON.parse(JSON.stringify(out)));
  assert.equal(checked.issues, undefined, `${cap.id}(${JSON.stringify(input)}): ${JSON.stringify(checked.issues)}`);
}

test("each served tool's real result (a write's preview) matches its declared output", async () => {
  for (const cap of servedTools()) {
    if (cap.input.required?.length) continue; // checked with real arguments in mcp-outputs.test.js and below
    await conforms(cap, {});
  }
  await conforms(registry.byId("help"), { tool: "trash_list" });
});

test("library_folder_guide's result matches its output for every folder, a bad path and an unknown one", async () => {
  const cap = registry.byId("library_folder_guide");
  const { guides } = await registry.byId("library_storage_guide").handler({}, {});
  for (const g of guides) await conforms(cap, { path: g.path });
  await conforms(cap, { path: "../games" });
  await conforms(cap, { path: "no/such/folder" });
});

test("jobs_list reports a running job in its declared shape", async () => {
  const activity = await import("../../src/tasks/activity.js");
  const job = activity.begin("verify", { title: "test" });
  await conforms(registry.byId("jobs_list"), {});
  job.done("ok");
  await conforms(registry.byId("jobs_list"), {});
});

test("the reference names only tools that are served", () => {
  const text = readFileSync(new URL("../../src/mcp/reference.md", import.meta.url), "utf8");
  const served = new Set(servedTools().map((c) => c.id));
  for (const [, name] of text.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)) assert.ok(served.has(name), `reference.md names ${name}, which is not a served tool`);
});

test("the core write tools take (ctx, input) and answer a bad input as BAD_INPUT, not a crash", async () => {
  for (const [id, input] of [["retro_core_enabled", { core: "mgba", enabled: "yes" }], ["retro_core_source", { core: "mgba", source: "ftp" }], ["retro_core_repo", { repo: "not a repo" }]]) {
    await assert.rejects(registry.byId(id).handler({}, input), (err) => err.status === 400, id);
  }
});

test("a long result loses rows from the end of its longest list and says how many", () => {
  const value = { total: 500, items: Array.from({ length: 500 }, (_, i) => ({ i, pad: "x".repeat(200) })) };
  const text = fitJson(value, 10_000);
  assert.ok(Buffer.byteLength(text) <= 10_000);
  const back = JSON.parse(text);
  assert.equal(back.truncated.list, "items");
  assert.equal(back.truncated.kept + back.truncated.dropped, 500);
  assert.deepEqual(back.items[0], value.items[0]);
});

test("errors keep a 4xx message and hide anything else behind INTERNAL", () => {
  const tool = (r) => JSON.parse(r.content[0].text).error;
  assert.deepEqual(tool(errorResult(Object.assign(new Error("no such core"), { status: 404 }), "t")), { code: "NOT_FOUND", message: "no such core" });
  assert.deepEqual(tool(errorResult(new ToolError("CONFLICT", "busy", { hint: "wait" }), "t")), { code: "CONFLICT", message: "busy", hint: "wait" });
  const internal = tool(errorResult(new Error("ENOENT: /data/secret/path"), "t"));
  assert.equal(internal.code, "INTERNAL");
  assert.doesNotMatch(internal.message, /secret/);
});

test("/mcp matches the token lane the way Express routes it, so a valid token never counts as a failed login", () => {
  for (const p of ["/mcp/", "/MCP", "/Mcp/"]) assert.equal(TOKEN_PATHS(p), true, p);
  assert.equal(TOKEN_PATHS("/mcp/x"), false);
});

test("a body that is not JSON gets a JSON-RPC parse error", async () => {
  const res = await fetch(`${base}/mcp`, { method: "POST", headers: { Authorization: "Bearer good", "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: "{not json" });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, -32700);
});

test("a write without confirm changes nothing and returns its preview; with confirm it runs and is journaled", async () => {
  const { journalFile } = await import("../../src/mcp/journal.js");
  const { artJob } = await import("../../src/routes/admin/retro-art-api.js");
  const client = await connect();
  const first = json(await client.callTool({ name: "retro", arguments: { action: "retro_art_sync" } }));
  assert.ok(Array.isArray(first.preview.systems));
  assert.match(first.next, /confirm='approve'/);
  assert.equal(artJob(), null, "the preview started nothing");
  assert.equal(readFileSync(journalFile(), { flag: "a+" }).toString(), "", "a preview is not journaled");

  const done = json(await client.callTool({ name: "retro", arguments: { action: "retro_art_sync", confirm: "approve" } }));
  assert.equal(done.started, true);
  const [line] = readFileSync(journalFile(), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual([line.tool, line.ok, line.token, line.input], ["retro_art_sync", true, TOKEN.id, {}]);
  await client.close();
});

test("a confirm other than approve is refused before the tool runs", async () => {
  const client = await connect();
  const result = await client.callTool({ name: "retro", arguments: { action: "retro_art_match", args: { id: "gba-0000000000", name: null }, confirm: "yes" } });
  assert.equal(result.isError, true);
  await client.close();
});

test("help shows a write's confirm argument and its preview fields", async () => {
  const client = await connect();
  const { text } = json(await client.callTool({ name: "help", arguments: { tool: "retro_art_match" } }));
  assert.match(text, /confirm\?: "approve"/);
  assert.match(text, /## Preview/);
  assert.match(text, /- `now\.boxart`/);
  await client.close();
});
