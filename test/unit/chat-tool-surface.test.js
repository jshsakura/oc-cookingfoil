import { test } from "node:test";
import assert from "node:assert/strict";

const { buildToolSurface, estimateTokens, externalTier } = await import("../../src/chat/tool-surface.js");

const tool = (name, description = `does ${name}`, extra = {}) => ({ name, description, inputSchema: { type: "object", properties: { q: { type: "string" } } }, ...extra });
const many = (server, n) => ({ name: server, tools: Array.from({ length: n }, (_, i) => tool(`tool_${i}`, `Handles thing number ${i} for the ${server} service. ${"More detail. ".repeat(10)}`, { annotations: { readOnlyHint: true } })) });
const BUILTIN = { name: "cookingfoil", builtin: true, tools: [tool("games"), tool("help")] };

test("the built-in tools are always shown as they are", () => {
  const s = buildToolSurface([BUILTIN, many("ext", 200)]);
  assert.ok(s.tools.some((t) => t.name === "games"));
  assert.ok(s.tools.some((t) => t.name === "help"));
});

test("a few external tools are shown in full, named by their server", () => {
  const s = buildToolSurface([BUILTIN, many("files", 3)], { budget: 5000 });
  const names = s.tools.map((t) => t.name);
  assert.ok(names.includes("files__tool_0") && names.includes("files__tool_2"));
  assert.ok(!names.includes("tool_search"));
  assert.deepEqual(s.resolve("files__tool_1"), { server: "files", tool: "tool_1" });
});

test("many external tools collapse into search and call, within the budget", () => {
  const s = buildToolSurface([BUILTIN, many("big", 300)], { budget: 2000 });
  const names = s.tools.map((t) => t.name);
  assert.ok(names.includes("tool_search") && names.includes("tool_call"));
  assert.ok(!names.some((n) => n.startsWith("big__")));
  assert.ok(estimateTokens(s.tools) <= 2000, `surface is ${estimateTokens(s.tools)} tokens`);
});

test("the surface is the same for the same tools, so a prompt cache keeps hitting", () => {
  const a = buildToolSurface([BUILTIN, many("big", 300), many("zeta", 2)]);
  const b = buildToolSurface([many("zeta", 2), many("big", 300), BUILTIN]);
  assert.equal(JSON.stringify(a.tools), JSON.stringify(b.tools));
});

test("search finds a tool by what it does and returns a small result", () => {
  const servers = [{ name: "media", tools: [
    tool("sub_fetch", "Download subtitles for a movie", { annotations: { readOnlyHint: true } }),
    tool("poster_find", "Find a poster image", { annotations: { readOnlyHint: true } }),
    ...many("media", 300).tools,
  ] }];
  const s = buildToolSurface(servers, { budget: 1000 });
  const hits = s.search("subtitles movie");
  assert.equal(hits[0].name, "media__sub_fetch");
  assert.ok(hits.length <= 8);
  assert.ok(estimateTokens(hits) < 1500);
  assert.ok(hits[0].inputSchema, "a hit carries the schema the model needs to call it");
});

test("search with no match returns an empty list, not everything", () => {
  const s = buildToolSurface([many("big", 300)], { budget: 1000 });
  assert.deepEqual(s.search("zzzz-no-such-thing"), []);
});

test("a name that is not a tool resolves to null", () => {
  const s = buildToolSurface([BUILTIN, many("files", 3)]);
  for (const bad of ["files__nope", "nope__tool_0", "__proto__", "files", "", null, undefined]) assert.equal(s.resolve(bad), null, String(bad));
});

test("names stay valid function names for the model API", () => {
  const s = buildToolSurface([{ name: "my server.v2", tools: [tool("do it!", "x", { annotations: { readOnlyHint: true } })] }], { budget: 5000 });
  for (const t of s.tools) assert.match(t.name, /^[A-Za-z0-9_-]{1,64}$/);
  assert.ok(s.resolve(s.tools.find((t) => t.name.includes("do")).name));
});

test("externalTier: read-only tools run, others are blocked unless the admin allowed them", () => {
  assert.equal(externalTier({ annotations: { readOnlyHint: true } }, undefined), "auto");
  assert.equal(externalTier({}, undefined), "blocked");
  assert.equal(externalTier({ annotations: { destructiveHint: true } }, undefined), "blocked");
  assert.equal(externalTier({}, "approve"), "approve");
  assert.equal(externalTier({ annotations: { readOnlyHint: true } }, "blocked"), "blocked");
  assert.equal(externalTier({}, "junk"), "blocked");
});

test("blocked external tools are not in the surface or the search", () => {
  const server = { name: "x", tools: [tool("read_it", "read", { annotations: { readOnlyHint: true } }), tool("write_it", "write")] };
  const s = buildToolSurface([server], { budget: 5000 });
  assert.deepEqual(s.tools.map((t) => t.name), ["x__read_it"]);
  assert.equal(s.resolve("x__write_it"), null);
  const allowed = buildToolSurface([server], { budget: 5000, allow: { x: { write_it: "approve" } } });
  assert.deepEqual(allowed.tools.map((t) => t.name), ["x__read_it", "x__write_it"]);
  assert.equal(allowed.tierOf("x__write_it"), "approve");
});
