import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { createChatService, ChatError, llmFromSettings, isConfigured } = await import("../../src/chat/service.js");

const KEY = "sk-test-secret-0000";
const cfg = { baseUrl: "https://llm.example.com/v1", model: "m", apiKey: KEY };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "cook-chat-service-"));
const WHO = { account: "admin", admin: true, name: "admin" };

/** A model that says one thing; remembers what it was asked. */
const saying = (text, seen = []) => async function* (o) {
  seen.push({ ...o, messages: [...o.messages] });
  yield { type: "text", delta: text };
  yield { type: "done" };
};
const noHost = async () => ({ tools: async () => [], call: async () => ({ status: "done", result: null }), pending: () => [] });

test("the model settings are the chat integration, and isConfigured needs all three", () => {
  const got = llmFromSettings();
  assert.deepEqual(Object.keys(got).sort(), ["apiKey", "baseUrl", "model"]);
  assert.equal(isConfigured({ baseUrl: "https://x.example.com/v1", model: "m", apiKey: "k" }), true);
  assert.equal(isConfigured({ baseUrl: "https://x.example.com/v1", model: "m", apiKey: "" }), false);
});

test("a turn without a configured model is refused before anything is stored", async () => {
  const dir = tmp();
  const chat = createChatService({ dir, llmConfig: () => ({ baseUrl: "", model: "", apiKey: "" }), makeHost: noHost });
  await assert.rejects(chat.turn({ ...WHO, message: "hi", onEvent() {} }), (e) => e instanceof ChatError && e.code === "not_configured");
  assert.deepEqual(chat.list("admin"), []);
});

test("a message that is empty or too long is refused", async () => {
  const chat = createChatService({ dir: tmp(), llmConfig: () => cfg, stream: saying("x"), makeHost: noHost });
  for (const message of ["", "   ", undefined]) {
    await assert.rejects(chat.turn({ ...WHO, message, onEvent() {} }), (e) => e.code === "bad_message");
  }
  await assert.rejects(chat.turn({ ...WHO, message: "a".repeat(4001), onEvent() {} }), (e) => e.code === "too_long" && e.status === 413);
});

test("a turn stores the question and the answer and a second turn sends the history", async () => {
  const seen = [];
  const chat = createChatService({ dir: tmp(), llmConfig: () => cfg, stream: saying("hello", seen), makeHost: noHost });
  const events = [];
  const first = await chat.turn({ ...WHO, message: "hi", onEvent: (e) => events.push(e) });
  assert.ok(events.every((e) => e.conversation === first.conversation));
  assert.deepEqual(events.map((e) => e.type), ["text", "done"]);
  assert.deepEqual(chat.load("admin", first.conversation).map((m) => [m.role, m.content]), [["user", "hi"], ["assistant", "hello"]]);

  await chat.turn({ ...WHO, conversation: first.conversation, message: "again", onEvent() {} });
  const sent = seen.at(-1).messages.map((m) => [m.role, m.content]);
  assert.deepEqual(sent.slice(1), [["user", "hi"], ["assistant", "hello"], ["user", "again"]]);
  assert.equal(sent[0][0], "system");
});

test("the key reaches the model call and is in nothing stored or sent to the screen", async () => {
  const seen = [];
  const dir = tmp();
  const chat = createChatService({ dir, llmConfig: () => cfg, stream: saying("ok", seen), makeHost: noHost });
  const events = [];
  await chat.turn({ ...WHO, message: "hi", onEvent: (e) => events.push(e) });
  assert.equal(seen[0].apiKey, KEY);
  assert.ok(!JSON.stringify(events).includes(KEY));
  const stored = fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((d) => d.isFile()).map((d) => fs.readFileSync(path.join(d.parentPath, d.name), "utf8")).join("");
  assert.ok(stored.length > 0 && !stored.includes(KEY));
});

test("a conversation of another account is not found", async () => {
  const chat = createChatService({ dir: tmp(), llmConfig: () => cfg, stream: saying("ok"), makeHost: noHost });
  const { conversation } = await chat.turn({ ...WHO, message: "hi", onEvent() {} });
  assert.throws(() => chat.load("someone-else", conversation), (e) => e.code === "no_conversation" && e.status === 404);
  await assert.rejects(chat.turn({ ...WHO, account: "someone-else", conversation, message: "x", onEvent() {} }), (e) => e.code === "no_conversation");
});

test("a failing model ends the turn with an error event and still stores the question", async () => {
  const stream = async function* () {
    throw new Error(`boom ${KEY}`);
  };
  const chat = createChatService({ dir: tmp(), llmConfig: () => cfg, stream, makeHost: noHost });
  const events = [];
  const out = await chat.turn({ ...WHO, message: "hi", onEvent: (e) => events.push(e) });
  assert.equal(out.error, true);
  assert.deepEqual(events.map((e) => e.type), ["error", "done"]);
  assert.ok(!JSON.stringify(events).includes(KEY));
  assert.equal(chat.load("admin", out.conversation)[0].content, "hi");
});

test("deciding with no parked call says denied, and approve and refuse go to the host", async () => {
  const calls = [];
  const host = { tools: async () => [], call: async () => ({ status: "done", result: null }), pending: () => [{ id: "p1" }], owner: (id) => ({ account: "admin", conversation: null, capId: "x", status: "pending", id }), approve: async (id) => (calls.push(["approve", id]), { status: "done", result: { ok: 1 } }), refuse: (id) => (calls.push(["refuse", id]), true) };
  const chat = createChatService({ dir: tmp(), llmConfig: () => cfg, stream: saying("ok"), makeHost: async () => host });
  assert.equal((await chat.decide({ ...WHO, id: "p1", approve: true })).status, "denied");
  const { conversation } = await chat.turn({ ...WHO, message: "hi", onEvent() {} });
  assert.deepEqual(await chat.pending("admin"), [{ id: "p1" }]);
  assert.equal((await chat.decide({ ...WHO, id: "p1", approve: true, conversation })).status, "done");
  assert.equal((await chat.decide({ ...WHO, id: "p2", approve: false })).status, "refused");
  assert.deepEqual(calls, [["approve", "p1"], ["refuse", "p2"]]);
  assert.equal(chat.load("admin", conversation).at(-1).role, "system");
});

test("the chat integration is saved sealed, shows only whether the key is set, and is not a tool for agents", async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "cook-chat-int-"));
  const { spawnSync } = await import("node:child_process");
  const script = `
    const integrations = await import("${new URL("../../src/security/integrations.js", import.meta.url).href}");
    const { registry } = await import("${new URL("../../src/capabilities/registry.js", import.meta.url).href}");
    integrations.save("chat", { baseUrl: "https://llm.example.com/v1", model: "glm-5.2", apiKey: "${KEY}" });
    const shown = JSON.stringify(integrations.describe().chat);
    const offered = registry.all.find((c) => c.id === "integration_list").input;
    console.log(JSON.stringify({ shown, offered: JSON.stringify(offered), got: integrations.get("chat"), same: integrations.save("chat", { baseUrl: "https://llm.example.com/v1/", model: "glm-6" }).fields.apiKey, moved: integrations.save("chat", { baseUrl: "https://other.example.net/v1", model: "glm-6" }).fields.apiKey, moved2: integrations.get("chat").apiKey, again: integrations.save("chat", { baseUrl: "https://other.example.net/v1", model: "glm-6", apiKey: "${KEY}2" }).fields.apiKey }));
  `;
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", env: { ...process.env, COOK_DATA_DIR: data, COOK_SECRET_KEY: Buffer.alloc(32, 7).toString("base64") } });
  assert.equal(run.status, 0, run.stderr);
  const out = JSON.parse(run.stdout.trim().split("\n").at(-1));
  assert.ok(!out.shown.includes(KEY), "describe never returns the key");
  assert.deepEqual(JSON.parse(out.shown).fields.apiKey, { set: true });
  assert.equal(out.got.apiKey, KEY);
  assert.deepEqual(out.same, { set: true }, "an empty key on save keeps the saved one while the address stays");
  assert.deepEqual(out.moved, { set: false }, "a new address does not inherit the old key");
  assert.equal(out.moved2, "");
  assert.deepEqual(out.again, { set: true }, "a new address with a new key is saved");
  assert.ok(!out.offered.includes('"chat"'));
  const files = fs.readdirSync(data, { recursive: true, withFileTypes: true }).filter((d) => d.isFile());
  for (const f of files) assert.ok(!fs.readFileSync(path.join(f.parentPath, f.name)).includes(KEY), `${f.name} holds the key in plain text`);
});

test("an automation token cannot read or change the chat or its model settings", async () => {
  process.env.COOK_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "cook-chat-token-"));
  const { tokenBlocked } = await import("../../src/routes/admin-page.js");
  for (const [method, p] of [["POST", "/api/integrations/chat"], ["POST", "/api/integrations/chat/clear"], ["POST", "/api/integrations/chat/test"], ["POST", "/api/chat"], ["GET", "/api/chat"], ["DELETE", "/api/chat"]]) {
    assert.equal(tokenBlocked(method, p), true, `${method} ${p}`);
  }
  assert.equal(tokenBlocked("POST", "/api/integrations/github"), false, "the other keys keep working for tokens");
});
