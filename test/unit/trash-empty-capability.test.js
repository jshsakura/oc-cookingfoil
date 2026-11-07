import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { fromJsonSchema } from "@modelcontextprotocol/server";

// trash_empty, the one permanent delete MCP serves: its preview names what would go and deletes
// nothing, "everything" means everything the trash_list the caller saw, and only confirm='approve'
// after that preview removes anything.
const base = fs.mkdtempSync(path.join(os.tmpdir(), "trash-empty-cap-"));
const dirs = Object.fromEntries(["games", "incoming", "patches", "saves", "homebrew", "retro", "data"].map((k) => [k, path.join(base, k)]));
for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
process.env.COOK_GAMES_DIR = dirs.games;
process.env.COOK_INCOMING_DIR = dirs.incoming;
process.env.COOK_PATCHES_DIR = dirs.patches;
process.env.COOK_SAVES_DIR = dirs.saves;
process.env.COOK_HOMEBREW_DIR = dirs.homebrew;
process.env.COOK_RETRO_DIR = dirs.retro;
process.env.COOK_DATA_DIR = dirs.data;
process.env.COOK_RATING_SYNC = "false";
process.env.COOK_TITLEDB_AUTO_FETCH = "false";
process.env.COOK_MCP_ENABLED = "true";

const { registry } = await import("../../src/capabilities/registry.js");
const { mcpRoute } = await import("../../src/mcp/route.js");
const { journalFile } = await import("../../src/mcp/journal.js");
const service = await import("../../src/library/trash-service.js");
service._setRefresh(async () => {});

const cap = registry.byId("trash_empty");
const listCap = registry.byId("trash_list");
const by = { type: "user", name: "boss" };
const hangul = /[ㄱ-힝]/;

/** A file of the games folder moved to its trash; returns the entry id trash_list shows. */
async function trashed(name, body) {
  fs.writeFileSync(path.join(dirs.games, name), body);
  return (await service.trash("games", [{ rel: name }], { kind: "file", action: "remove", by, name })).id;
}
const ids = async () => (await service.list()).items.map((e) => e.id);
const UNKNOWN = "games|.cookingfoil-trash|2020-01-01/game-0123456789";

/** The preview, checked against the shape help declares for it. */
async function preview(input) {
  const out = await cap.preview({}, input);
  const checked = await fromJsonSchema(cap.previewOutput)["~standard"].validate(JSON.parse(JSON.stringify(out)));
  assert.equal(checked.issues, undefined, JSON.stringify(checked.issues));
  return out;
}

let server;
let mcpBase;
before(async () => {
  const app = express();
  app.use((req, _res, next) => {
    if (req.headers.authorization === "Bearer good") req.apiToken = { id: "0a0a0a0a", label: "test agent" };
    next();
  });
  for (const method of ["post", "get", "delete"]) app[method]("/mcp", ...mcpRoute());
  await new Promise((resolve) => (server = app.listen(0, "127.0.0.1", resolve)));
  mcpBase = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server?.close();
  service._setRefresh(null);
});

test("the preview of chosen entries names each with its size and deletes nothing", async () => {
  const a = await trashed("a.txt", "AAAA");
  const b = await trashed("b.txt", "BB");
  const first = await preview({ ids: [a] });
  assert.deepEqual([first.count, first.bytes], [1, 4]);
  assert.deepEqual(first.entries.map((e) => [e.id, e.root, e.name, e.size, e.files]), [[a, "games", "a.txt", 4, 1]]);
  assert.match(first.changes, /Deletes 1 entry .* for good/);
  assert.deepEqual((await ids()).sort(), [a, b].sort(), "a preview changes nothing");
  // bytes freed counts each entry's manifest file with its files.
  const out = await cap.handler({ by }, { ids: [a, b] });
  assert.equal(out.removed, 2);
  assert.ok(out.bytes >= 6, String(out.bytes));
  assert.deepEqual(await ids(), []);
});

test("an unknown id is refused before anything goes, and the refusal is in English", async () => {
  const a = await trashed("keep.txt", "K");
  await assert.rejects(cap.preview({}, { ids: [a, UNKNOWN] }), (err) => err.status === 404 && err.message.includes(UNKNOWN));
  await assert.rejects(cap.handler({ by }, { ids: [a, UNKNOWN] }), (err) => err.status === 404 && !hangul.test(err.message));
  assert.deepEqual(await ids(), [a], "the good one is still there");
  await cap.handler({ by }, { ids: [a] });
});

test("ids or all, not both; all needs the version the list gave, and refuses a stale one in English", async () => {
  const a = await trashed("c.txt", "C");
  for (const input of [{}, { ids: [a], all: true }, { all: true }, { all: true, version: "" }, { all: true, version: "x", listedAt: "soon" }, { ids: [] }, { ids: "x" }]) {
    await assert.rejects(cap.preview({}, input), (err) => err.status === 400, JSON.stringify(input));
  }
  await assert.rejects(cap.preview({}, { all: true, version: "0000000000000000" }), (err) => err.status === 409 && !hangul.test(err.message));
  await assert.rejects(cap.handler({ by }, { all: true, version: "0000000000000000" }), (err) => err.status === 409 && !hangul.test(err.message));
  assert.deepEqual(await ids(), [a], "nothing was deleted");
  await cap.handler({ by }, { ids: [a] });
});

test("all empties what the trash_list showed: an entry that came in after it stays", async () => {
  const seen1 = await trashed("s1.txt", "11");
  const seen2 = await trashed("s2.txt", "22");
  const listed = await listCap.handler({}, {});
  assert.equal(typeof listed.version, "string");
  assert.equal(typeof listed.listedAt, "number");
  await new Promise((r) => setTimeout(r, 5));
  const late = await trashed("late.txt", "L");
  const whole = await preview({ all: true, version: listed.version, listedAt: listed.listedAt });
  assert.deepEqual([whole.count, whole.bytes], [2, 4]);
  assert.deepEqual(whole.entries.map((e) => e.id).sort(), [seen1, seen2].sort(), "the late entry is not in the preview");
  const out = await cap.handler({ by }, { all: true, version: listed.version, listedAt: listed.listedAt });
  assert.deepEqual([out.removed, out.bytes >= 4], [2, true]);
  assert.deepEqual(await ids(), [late], "the late entry is untouched");
  // Without listedAt the version must match the whole trash as it is now.
  await assert.rejects(cap.handler({ by }, { all: true, version: listed.version }), (err) => err.status === 409);
  const now = await listCap.handler({}, {});
  assert.equal((await cap.handler({ by }, { all: true, version: now.version })).removed, 1);
});

test("over MCP the library tool previews trash_empty without confirm, deletes with confirm='approve', and journals it", async () => {
  const a = await trashed("mcp.txt", "MCP");
  const transport = new StreamableHTTPClientTransport(new URL(`${mcpBase}/mcp`), { requestInit: { headers: { Authorization: "Bearer good" } } });
  const client = new Client({ name: "test", version: "1" });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    const library = tools.find((t) => t.name === "library");
    assert.ok(library.inputSchema.properties.action.enum.includes("trash_empty"));
    assert.equal(library.annotations.destructiveHint, true);
    const read = (r) => JSON.parse(r.content[0].text);
    const first = read(await client.callTool({ name: "library", arguments: { action: "trash_empty", args: { ids: [a] } } }));
    assert.equal(first.preview.count, 1);
    assert.equal(first.preview.entries[0].name, "mcp.txt");
    assert.match(first.next, /Nothing changed yet/);
    assert.deepEqual(await ids(), [a], "no confirm, nothing gone");
    const done = read(await client.callTool({ name: "library", arguments: { action: "trash_empty", args: { ids: [a] }, confirm: "approve" } }));
    assert.deepEqual([done.removed, done.bytes >= 3], [1, true]);
    assert.deepEqual(await ids(), []);
    const lines = fs.readFileSync(journalFile(), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.ok(lines.some((l) => l.tool === "trash_empty" && l.ok === true && l.by === "test agent"), "the delete is journaled with who asked");
  } finally {
    await client.close();
  }
});
