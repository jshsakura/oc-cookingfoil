import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeDataDir, manifestOf, newRegistry, writePlugin } from "../support/plugin-fixtures.js";
import { parseMetadata } from "../../src/plugins/agent-answer.js";
import { createAgentCache, HIT_TTL_MS, MISS_TTL_MS } from "../../src/plugins/agent-cache.js";
import { createAgentOrder, OrderError } from "../../src/plugins/agent-order.js";
import { createAgentRunner } from "../../src/plugins/agent-runner.js";
import { ADMIN, FILENAME, LOCAL, TITLEDB, mergeField, orderOf } from "../../src/meta/field-merge.js";

const A = "0100000000010000";
const B = "0100000000020000";
const C = "0100000000030000";

// A metadata plugin whose answers the test chooses by title id; every call is written to globalThis so a test counts them.
const body = (answers, id) => `
globalThis.__asked ??= {};
export default { async metadata(a) {
  (globalThis.__asked[${JSON.stringify(id)}] ??= []).push(a);
  const answers = ${JSON.stringify(answers)};
  if (answers[a.titleId] === "throw") throw new Error("boom");
  return answers[a.titleId] ?? { fields: {} };
} };`;
const asked = (id) => globalThis.__asked?.[id] ?? [];

async function boot(plugins, opts = {}) {
  const d = makeDataDir();
  globalThis.__asked = {};
  for (const [id, answers] of Object.entries(plugins)) writePlugin(d, id, { body: body(answers, id), manifest: manifestOf(id) });
  const { registry, clock } = newRegistry(d, { limits: { hookMs: { metadata: 2000 }, hookMsDefault: 2000 } });
  await registry.init();
  for (const id of Object.keys(plugins)) await registry.setEnabled(id, true);
  const store = createAgentCache({ cacheDirOf: (id) => path.join(d, "plugin-cache", id), now: () => clock.t });
  const runner = createAgentRunner({ registry, store, now: () => clock.t, ...opts });
  const settle = async () => { for (let i = 0; i < 50 && runner.pending() > 0; i++) await new Promise((r) => setTimeout(r, 10)); await new Promise((r) => setTimeout(r, 30)); };
  return { d, registry, clock, store, runner, settle };
}

test("an answer is cut down to what the core keeps, and a wrong field is dropped alone", () => {
  const got = parseMetadata({
    fields: { name: "  Moon Quest  ", publisher: 5, description: { ko: "달 이야기\n둘째 줄", xx: "no", en: "" }, releaseDate: 20240230.5, size: -1, rating: 9 },
    credit: { text: "Someone", url: "http://insecure.example.com/x" },
    extra: 1,
  });
  assert.deepEqual(got, { fields: { name: "Moon Quest", description: { ko: "달 이야기\n둘째 줄" } }, credit: { text: "Someone" } });
  assert.deepEqual(parseMetadata({ fields: { releaseDate: 20240229, size: 1024 }, credit: { text: "x", url: "https://example.com/a" } }), { fields: { releaseDate: 20240229, size: 1024 }, credit: { text: "x", url: "https://example.com/a" } });
  assert.deepEqual(parseMetadata({}), { fields: {} });
  for (const bad of [null, undefined, "x", 3, []]) assert.equal(parseMetadata(bad), null);
  assert.equal(parseMetadata({ fields: {}, credit: { text: "alone" } }).credit, undefined, "a credit with nothing to credit is left out");
});

test("a title with no file in the library is asked about by its id alone, and the answer is kept", async () => {
  const { runner, store, settle } = await boot({ eshop: { [A]: { fields: { name: "Moon Quest", publisher: "Acme" } } } });
  runner.want(A, { hasFile: false });
  await settle();
  assert.deepEqual(asked("eshop"), [{ titleId: A, name: null, hasFile: false }]);
  assert.equal(store.get("eshop", A).fields.name, "Moon Quest");
  assert.equal(store.get("eshop", A.toLowerCase()).fields.publisher, "Acme", "the key is the title id, whatever its case");
});

test("a fresh answer is not asked for again, a miss is kept for a shorter time, and an old one is asked again", async () => {
  const { runner, store, settle, clock } = await boot({ eshop: { [A]: { fields: { name: "Moon Quest" } } } });
  runner.track([{ titleId: A }, { titleId: B }]);
  await settle();
  assert.equal(asked("eshop").length, 2);
  assert.equal(store.get("eshop", B).miss, true, "nothing known is an answer too");
  runner.track([{ titleId: A }, { titleId: B }]);
  await settle();
  assert.equal(asked("eshop").length, 2, "both are fresh");
  clock.t += MISS_TTL_MS + 1000;
  runner.track([{ titleId: A }, { titleId: B }]);
  await settle();
  assert.deepEqual(asked("eshop").slice(2).map((x) => x.titleId), [B], "only the miss has run out");
  clock.t += HIT_TTL_MS;
  runner.track([{ titleId: A }]);
  await settle();
  assert.equal(asked("eshop").filter((x) => x.titleId === A).length, 2);
});

test("a plugin that fails leaves the title unanswered, is not asked again at once, and does not hold up another plugin", async () => {
  const { runner, store, settle, clock } = await boot({
    broken: { [A]: "throw" },
    eshop: { [A]: { fields: { name: "Moon Quest" } } },
  });
  runner.want(A);
  await settle();
  assert.equal(store.get("broken", A), null);
  assert.equal(store.get("eshop", A).fields.name, "Moon Quest");
  const before = asked("broken").length;
  runner.want(A);
  await settle();
  assert.equal(asked("broken").length, before, "a failed title waits before it is asked again");
  clock.t += 11 * 60_000;
  runner.want(A);
  await settle();
  assert.equal(asked("broken").length, before + 1);
});

test("an answer that is not an object counts as a failure and keeps nothing", async () => {
  const { runner, store, settle } = await boot({ odd: { [A]: "text" } });
  runner.want(A);
  await settle();
  assert.equal(store.get("odd", A), null);
});

test("a plugin that is off is not asked, and its kept values are not used", async () => {
  const { runner, registry, store, settle } = await boot({ eshop: { [A]: { fields: { name: "Moon Quest" } } } });
  runner.want(A);
  await settle();
  await registry.setEnabled("eshop", false);
  assert.deepEqual(registry.activeProviding("metadata"), []);
  runner.want(B);
  await settle();
  assert.equal(asked("eshop").length, 1);
  assert.equal(store.get("eshop", A).fields.name, "Moon Quest", "kept for the day it is switched on again");
});

test("the values survive a restart, and forgetting them removes the files", async () => {
  const { d, runner, store, settle } = await boot({ eshop: { [A]: { fields: { name: "Moon Quest" } } } });
  runner.want(A);
  await settle();
  const again = createAgentCache({ cacheDirOf: (id) => path.join(d, "plugin-cache", id) });
  assert.equal(again.get("eshop", A), null, "nothing is read before load");
  await again.load("eshop");
  assert.equal(again.get("eshop", A).fields.name, "Moon Quest");
  await store.forget("eshop", { remove: true });
  assert.equal(store.get("eshop", A), null);
  assert.equal(fs.existsSync(path.join(d, "plugin-cache", "eshop", "agent")), false);
});

test("reading values and merging them never calls a plugin", async () => {
  const { runner, store, settle } = await boot({ eshop: { [A]: { fields: { name: "Moon Quest" } } } });
  runner.want(A);
  await settle();
  const calls = asked("eshop").length;
  for (let i = 0; i < 100; i++) mergeField("name", { [TITLEDB]: undefined, "agent:eshop": store.get("eshop", A)?.fields.name }, { order: orderOf([ADMIN, TITLEDB, LOCAL, FILENAME], { agents: ["eshop"] }) });
  assert.equal(asked("eshop").length, calls);
});

const BASE = [ADMIN, TITLEDB, LOCAL, FILENAME];
const valuesOf = (v) => ({ [TITLEDB]: v.db, [LOCAL]: v.local, [FILENAME]: v.file, "agent:one": v.one, "agent:two": v.two });

test("without an order set, the plugins come after the built-in sources and before the file name", () => {
  assert.deepEqual(orderOf(BASE, { agents: ["one", "two"] }), [ADMIN, TITLEDB, LOCAL, "agent:one", "agent:two", FILENAME]);
  assert.equal(mergeField("name", valuesOf({ file: "f", one: "One" }), { order: orderOf(BASE, { agents: ["one"] }) }).value, "One", "a plugin beats the file name");
  assert.equal(mergeField("name", valuesOf({ db: "Db", one: "One" }), { order: orderOf(BASE, { agents: ["one"] }) }).value, "Db", "and does not beat what is read today");
  assert.deepEqual(orderOf(BASE, {}), BASE, "no plugin, no change");
});

test("the admin's order puts a plugin first, an empty value falls to the next, and an unlisted source keeps its place", () => {
  const order = orderOf(BASE, { agents: ["one", "two"], configured: ["agent:two", "agent:one"] });
  assert.deepEqual(order, [ADMIN, "agent:two", "agent:one", TITLEDB, LOCAL, FILENAME]);
  assert.deepEqual(mergeField("name", valuesOf({ db: "Db", one: "One" }), { order }), { value: "One", source: "agent:one" }, "two had nothing");
  assert.deepEqual(mergeField("name", valuesOf({ db: "Db", one: "One", two: "Two" }), { order }), { value: "Two", source: "agent:two" });
  assert.deepEqual(mergeField("name", valuesOf({ db: "Db" }), { order }), { value: "Db", source: TITLEDB }, "a failing plugin leaves the field to the next source");
  assert.deepEqual(orderOf(BASE, { agents: ["one"], configured: ["agent:gone", TITLEDB] }), [ADMIN, TITLEDB, LOCAL, "agent:one", FILENAME], "a plugin that is not on is skipped");
  assert.equal(orderOf(BASE, { agents: ["one"], configured: [ADMIN, TITLEDB] })[0], ADMIN);
});

test("a field the admin locked is read without the plugins, and the admin's text is always first", () => {
  const order = orderOf(BASE, { agents: ["one"], configured: ["agent:one"], locked: true });
  assert.deepEqual(order, BASE);
  assert.equal(mergeField("name", { [ADMIN]: "Mine", "agent:one": "One" }, { order: orderOf(BASE, { agents: ["one"], configured: ["agent:one"] }) }).value, "Mine");
});

test("the order is saved at once, survives a restart, and refuses what is not a field or a source", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cf-order-")), "agent-order.json");
  const order = createAgentOrder({ file });
  assert.equal(order.get("name"), null);
  order.set({ name: ["agent:one", "titledb"], size: ["local"] });
  assert.deepEqual(createAgentOrder({ file }).get("name"), ["agent:one", "titledb"]);
  order.set({ name: null });
  assert.equal(createAgentOrder({ file }).get("name"), null);
  assert.deepEqual(createAgentOrder({ file }).all(), { size: ["local"] });
  for (const bad of [{ colour: ["titledb"] }, { name: "titledb" }, { name: ["titledb", "titledb"] }, { name: ["admin"] }, { name: ["Agent:One"] }, { name: Array.from({ length: 17 }, (_, i) => `s${i}`.replace(/\d/g, "x") + "-" + "a".repeat(i + 1)) }]) {
    assert.throws(() => order.set(bad), OrderError, JSON.stringify(bad));
  }
  assert.deepEqual(createAgentOrder({ file }).all(), { size: ["local"] }, "a refused change saves nothing");
});

test("the queue is bounded", async () => {
  const { runner, settle } = await boot({ eshop: {} }, { queueMax: 3 });
  for (const id of [A, B, C, "0100000000040000", "0100000000050000"]) runner.want(id);
  await settle();
  assert.equal(asked("eshop").length, 3, "the rest wait for the next scan");
});
