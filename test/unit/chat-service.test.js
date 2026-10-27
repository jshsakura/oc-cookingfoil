import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { createChatService, ChatError, llmFromEnv, isConfigured } = await import("../../src/chat/service.js");

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

test("llmFromEnv reads the three settings and isConfigured needs all of them", () => {
  const got = llmFromEnv({ COOK_CHAT_LLM_BASE_URL: " https://x.example.com ", COOK_CHAT_LLM_MODEL: "m", COOK_CHAT_LLM_API_KEY: "k" });
  assert.deepEqual(got, { baseUrl: "https://x.example.com", model: "m", apiKey: "k" });
  assert.equal(isConfigured(got), true);
  assert.equal(isConfigured({ ...got, apiKey: "" }), false);
  assert.equal(isConfigured(llmFromEnv({})), false);
});

test("a turn without a configured model is refused before anything is stored", async () => {
  const dir = tmp();
  const chat = createChatService({ dir, llmConfig: () => ({ baseUrl: "", model: "", apiKey: "" }), makeHost: noHost });
  await assert.rejects(chat.turn({ ...WHO, message: "hi", onEvent() {} }), (e) => e instanceof ChatError && e.code === "not_configured");
  assert.deepEqual(chat.list("admin"), []);
});

test("a message that is empty or too long is refused", async () => {
  const chat = createChatService({ dir: tmp(), llmConfig: () => cfg, stream: saying("x"), makeHost: noHost });
  for (const message of ["", "   ", undefined, "a".repeat(8001)]) {
    await assert.rejects(chat.turn({ ...WHO, message, onEvent() {} }), (e) => e.code === "bad_message");
  }
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
  const host = { tools: async () => [], call: async () => ({ status: "done", result: null }), pending: () => [{ id: "p1" }], approve: async (id) => (calls.push(["approve", id]), { status: "done", result: { ok: 1 } }), refuse: (id) => (calls.push(["refuse", id]), true) };
  const chat = createChatService({ dir: tmp(), llmConfig: () => cfg, stream: saying("ok"), makeHost: async () => host });
  assert.equal((await chat.decide({ ...WHO, id: "p1", approve: true })).status, "denied");
  const { conversation } = await chat.turn({ ...WHO, message: "hi", onEvent() {} });
  assert.deepEqual(await chat.pending("admin"), [{ id: "p1" }]);
  assert.equal((await chat.decide({ ...WHO, id: "p1", approve: true, conversation })).status, "done");
  assert.equal((await chat.decide({ ...WHO, id: "p2", approve: false })).status, "refused");
  assert.deepEqual(calls, [["approve", "p1"], ["refuse", "p2"]]);
  assert.equal(chat.load("admin", conversation).at(-1).role, "system");
});
