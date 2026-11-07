import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The 휴지통 tab's routes are capabilities an agent can find: listing and reading the journal are
// reads, restoring, undoing and releasing are writes a manage token may make. Emptying deletes for
// good, so tokens are refused its route and MCP alone serves it, behind its preview and an approval.
process.env.COOK_DATA_DIR = mkdtempSync(path.join(tmpdir(), "cook-trash-capabilities-"));
const { registry } = await import("../../src/capabilities/registry.js");
const { OPT_OUT } = await import("../../src/capabilities/opt-out.js");

test("each trash route but emptying is a capability with the safety it needs", () => {
  const want = {
    trash_list: ["GET /admin/api/trash", "read"],
    trash_journal: ["GET /admin/api/trash/journal", "read"],
    trash_restore: ["POST /admin/api/trash/restore", "write"],
    trash_undo: ["POST /admin/api/trash/undo", "write"],
    trash_release: ["POST /admin/api/trash/release", "write"],
  };
  for (const [id, [route, safety]] of Object.entries(want)) {
    const cap = registry.byId(id);
    assert.ok(cap, `${id} is registered`);
    assert.equal(`${cap.http.method} ${cap.http.path}`, route);
    assert.equal(cap.safety, safety);
    assert.equal(cap.token, true, `${id} is open to automation tokens`);
  }
});

test("emptying the trash is served by MCP alone, as the destructive action it is, behind its preview", () => {
  const cap = registry.byId("trash_empty");
  assert.ok(cap, "trash_empty is registered");
  assert.deepEqual([cap.safety, cap.mcp, cap.access, `${cap.http.method} ${cap.http.path}`], ["destructive", true, "full", "POST /admin/api/trash/empty"]);
  assert.notEqual(cap.token, true, "automation tokens are still refused the HTTP route");
  assert.equal(typeof cap.preview, "function");
  assert.ok(!("POST /admin/api/trash/empty" in OPT_OUT), "the route is a capability now, not an opt-out");
  assert.ok(!registry.toolsFor("full").some((c) => c.id === "trash_empty"), "not a token tool");
});

test("trash_restore's ids are a bounded list of strings, so a tool call is checked like the HTTP route", () => {
  const ids = registry.byId("trash_restore").input.properties.ids;
  assert.deepEqual([ids.type, ids.items, ids.maxItems, ids.minItems], ["array", { type: "string", minLength: 1, maxLength: 300 }, 1000, 1]);
});

test("trash_restore called directly refuses ids that are not a short list of strings", async () => {
  const cap = registry.byId("trash_restore");
  for (const ids of [[], "x", [1], Array.from({ length: 1001 }, (_, i) => `id-${i}`), ["y".repeat(301)]]) {
    await assert.rejects(cap.handler({}, { ids }), (err) => err.status === 400, JSON.stringify(ids).slice(0, 40));
  }
});
