import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import express from "express";

process.env.COOK_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "cook-chat-user-data-"));
const { Client, InMemoryTransport } = await import("@modelcontextprotocol/client");
const { McpServer, fromJsonSchema } = await import("@modelcontextprotocol/server");
const { createChatService, MESSAGE_MAX, modelRows } = await import("../../src/chat/service.js");
const { createMcpHost } = await import("../../src/chat/mcp-host.js");
const { DEFAULT_TIERS, USER_READS, USER_REQUESTS, USER_TIERS, decide, tierOf, tiersFor } = await import("../../src/chat/policy.js");
const { systemPrompt, DEFAULT_PERSONA } = await import("../../src/chat/persona.js");
const { scrubBlobs } = await import("../../src/chat/agent-loop.js");
const { createKeyRate } = await import("../../src/security/key-rate.js");
const { default: userChatRouter } = await import("../../src/routes/chat.js");
const { mountChatApi } = await import("../../src/routes/admin/chat-api.js");
const wishlist = await import("../../src/security/wishlist.js");

const cfg = { baseUrl: "https://llm.example.com/v1", model: "m", apiKey: "sk-test-secret-0000" };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "cook-chat-user-"));
const ALICE = { account: "user:alice", owner: "alice", admin: false, name: "alice" };
const BOB = { account: "user:bob", owner: "bob", admin: false, name: "bob" };
const ADMIN = { account: "admin", owner: "admin", admin: true, name: "admin" };

/** A model that answers from a script: each call takes the next step (text, or one tool call). */
function scriptedModel(steps, seen = []) {
  let i = 0;
  return async function* (o) {
    seen.push(o.messages.map((m) => ({ ...m })));
    const step = steps[Math.min(i++, steps.length - 1)];
    if (step.tool) yield { type: "tool_calls", calls: [{ id: `c${i}`, name: step.tool, arguments: JSON.stringify(step.args ?? {}) }] };
    else yield { type: "text", delta: step.text };
    if (step.usage) yield { type: "usage", usage: step.usage };
    yield { type: "done" };
  };
}

/** A stand-in MCP server shaped like CookingFoil's; it records who each call ran as. */
async function fakeHost({ owner, admin }, ran) {
  const server = new McpServer({ name: "fake", version: "1" });
  const area = (name, actions, gated) => server.registerTool(name, {
    description: name,
    inputSchema: fromJsonSchema({ type: "object", properties: { action: { type: "string", enum: actions }, args: { type: "object" }, confirm: { type: "string" } }, required: ["action"] }),
  }, async ({ action, args, confirm }) => {
    if (gated.includes(action) && confirm !== "approve") return { content: [{ type: "text", text: JSON.stringify({ preview: { changes: `would ${action}` } }) }] };
    ran.push({ owner, action, args });
    return { content: [{ type: "text", text: JSON.stringify({ ran: action }) }] };
  });
  area("games", ["games_search", "games_wishlist_set"], []);
  area("retro", ["retro_cover_set"], ["retro_cover_set"]);
  area("admin", ["settings_set", "account_list"], ["settings_set"]);
  const [c, s] = InMemoryTransport.createLinkedPair();
  await server.connect(s);
  const client = new Client({ name: "t", version: "1" });
  await client.connect(c);
  return createMcpHost({ client, base: tiersFor(admin) });
}

test("a person who is not the admin gets exactly the allowlist, and everything else is denied", () => {
  assert.deepEqual(Object.keys(USER_TIERS).sort(), [...USER_READS, ...Object.keys(USER_REQUESTS)].sort());
  for (const id of Object.keys(USER_TIERS)) assert.ok(Object.hasOwn(DEFAULT_TIERS, id), `${id} is a real capability`);
  for (const id of USER_READS) assert.equal(tierOf(id, USER_TIERS), "auto", id);
  for (const id of Object.keys(USER_REQUESTS)) assert.equal(decide(tierOf(id, USER_TIERS), { admin: false }), "request", id);
  for (const id of ["settings_set", "settings_get", "account_list", "account_set", "device_list", "integration_list", "server_status", "server_restart",
    "files_list", "trash_list", "plugin_list", "agent_list", "jobs_list", "alerts_get", "game_art_set", "retro_cores", "library_files_remove"]) {
    assert.equal(tierOf(id, USER_TIERS), "blocked", id);
  }
  assert.equal(tiersFor(true), DEFAULT_TIERS);
  assert.equal(tiersFor(false), USER_TIERS);
});

test("the user's host offers no admin tool and refuses one called anyway", async () => {
  const ran = [];
  const host = await fakeHost({ owner: "alice", admin: false }, ran);
  const tools = await host.tools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ["games", "retro"]);
  const out = await host.call({ account: "user:alice", admin: false }, { tool: "admin", arguments: { action: "settings_set", args: {} } });
  assert.equal(out.status, "denied");
  const listed = await host.call({ account: "user:alice", admin: false }, { tool: "admin", arguments: { action: "account_list" } });
  assert.equal(listed.status, "denied");
  assert.deepEqual(ran, []);
});

test("the real server: a user's wishlist call changes their own list only, and an admin tool is refused", async () => {
  const seen = [];
  const chat = createChatService({
    dir: tmp(), llmConfig: () => cfg, notify() {},
    stream: scriptedModel([
      { tool: "games", args: { action: "games_wishlist_set", args: { op: "add", titleId: "0100000000010000", name: "Test" } } },
      { tool: "admin", args: { action: "settings_get", args: {} } },
      { text: "done" },
    ], seen),
  });
  const events = [];
  await chat.turn({ ...ALICE, message: "wish", onEvent: (e) => events.push(e) });
  assert.ok(wishlist.list("alice").some((w) => w.titleId === "0100000000010000"), "alice's list has it");
  assert.ok(!wishlist.list("bob").some((w) => w.titleId === "0100000000010000"), "bob's list does not");
  assert.ok(!wishlist.list("admin").some((w) => w.titleId === "0100000000010000"), "the admin's list does not");
  const refused = seen.at(-1).find((m) => m.role === "tool" && m.content.includes("settings_get"));
  assert.match(refused.content, /not available in chat/);
});

test("a user's change becomes a request: the admin is told, approves it, it runs as the user and the user's conversation says so", async () => {
  const ran = [];
  const told = [];
  const chat = createChatService({
    dir: tmp(), llmConfig: () => cfg, notify: (n) => told.push(n), makeHost: (who) => fakeHost(who, ran),
    stream: scriptedModel([{ tool: "retro", args: { action: "retro_cover_set", args: { id: "gba-1" } } }, { text: "passed on" }]),
  });
  const events = [];
  const { conversation } = await chat.turn({ ...ALICE, message: "change the cover", onEvent: (e) => events.push(e) });
  const approval = events.find((e) => e.type === "approval");
  assert.equal(approval.status, "requested");
  assert.equal(approval.kind, "change");
  assert.deepEqual(told.map((n) => n.capId), ["retro_cover_set"]);
  assert.deepEqual(ran, [], "nothing ran yet");

  assert.equal((await chat.decide({ ...BOB, id: approval.id, approve: true })).status, "denied", "another person cannot settle it");
  assert.equal((await chat.decide({ ...ALICE, id: approval.id, approve: true })).status, "denied", "nor can the asker");
  const waiting = await chat.requests("admin");
  assert.deepEqual(waiting.map((r) => [r.id, r.by]), [[approval.id, "alice"]]);

  const out = await chat.decide({ ...ADMIN, id: approval.id, approve: true });
  assert.equal(out.status, "done");
  assert.deepEqual(ran.map((r) => [r.owner, r.action]), [["alice", "retro_cover_set"]], "it ran as alice, not as the admin");
  assert.equal(chat.load("user:alice", conversation).at(-1).note, "approved");
  assert.deepEqual(await chat.requests("admin"), []);
});

test("a refused request is written into the person's conversation", async () => {
  const chat = createChatService({
    dir: tmp(), llmConfig: () => cfg, notify() {}, makeHost: (who) => fakeHost(who, []),
    stream: scriptedModel([{ tool: "retro", args: { action: "retro_cover_set", args: { id: "gba-1" } } }, { text: "ok" }]),
  });
  const events = [];
  const { conversation } = await chat.turn({ ...ALICE, message: "change", onEvent: (e) => events.push(e) });
  const id = events.find((e) => e.type === "approval").id;
  assert.equal((await chat.decide({ ...ADMIN, id, approve: false })).status, "refused");
  assert.equal(chat.load("user:alice", conversation).at(-1).note, "refused");
});

test("the default persona is Butter, an edited one reaches the system prompt, and admin and user differ only in what they may do", async () => {
  const user = systemPrompt({}, { admin: false });
  const admin = systemPrompt({}, { admin: true });
  assert.match(user, /Butter \(버터 in Korean\)/);
  assert.ok(user.includes(DEFAULT_PERSONA) && admin.includes(DEFAULT_PERSONA));
  for (const rule of ["never guess what the library holds", "never show settings, keys", "Answer in the language"]) assert.ok(user.includes(rule) && admin.includes(rule), rule);
  assert.notEqual(user, admin);

  const seen = [];
  const chat = createChatService({ dir: tmp(), llmConfig: () => cfg, persona: () => ({ name: "Mochi", text: "Speak like a calm librarian." }), stream: scriptedModel([{ text: "hi" }], seen), makeHost: (who) => fakeHost(who, []) });
  await chat.turn({ ...ALICE, message: "hello", onEvent() {} });
  const sys = seen[0][0];
  assert.equal(sys.role, "system");
  assert.match(sys.content, /Your name is Mochi\./);
  assert.match(sys.content, /calm librarian/);
  assert.ok(!sys.content.includes(DEFAULT_PERSONA));
});

test("usage reaches the meter, and compacting shrinks what the model sees but keeps what the person sees", async () => {
  const seen = [];
  const chat = createChatService({
    dir: tmp(), llmConfig: () => cfg, contextWindow: () => 100000, makeHost: (who) => fakeHost(who, []),
    stream: scriptedModel([
      { text: "first answer", usage: { prompt_tokens: 900, completion_tokens: 100 } },
      { text: "second answer", usage: { prompt_tokens: 1500, completion_tokens: 100 } },
      { text: "SUMMARY: they asked twice" },
      { text: "third answer" },
    ], seen),
  });
  const events = [];
  const { conversation } = await chat.turn({ ...ALICE, message: "one", onEvent: (e) => events.push(e) });
  assert.deepEqual(events.find((e) => e.type === "context"), { type: "context", used: 1000, window: 100000, conversation });
  await chat.turn({ ...ALICE, conversation, message: "two", onEvent() {} });
  assert.equal(chat.context("user:alice", conversation).used, 1600);

  const after = await chat.compact({ account: "user:alice", admin: false, conversation });
  assert.ok(after.used < 1600, "the meter drops");
  await chat.turn({ ...ALICE, conversation, message: "three", onEvent() {} });
  const sent = seen.at(-1).map((m) => [m.role, m.content]);
  assert.equal(sent.length, 3, "system, the summary, the new message");
  assert.match(sent[1][1], /SUMMARY: they asked twice/);
  assert.deepEqual(sent[2], ["user", "three"]);
  const visible = chat.load("user:alice", conversation).filter((m) => m.role === "user").map((m) => m.content);
  assert.deepEqual(visible, ["one", "two", "three"], "the person still sees every message");
  assert.equal(modelRows(chat.load("user:alice", conversation))[0].compact, true);
});

test("a conversation past 80% of the window is compacted by itself before the next model call", async () => {
  const seen = [];
  const chat = createChatService({
    dir: tmp(), llmConfig: () => cfg, contextWindow: () => 1000, makeHost: (who) => fakeHost(who, []),
    stream: scriptedModel([{ text: "long", usage: { prompt_tokens: 850, completion_tokens: 10 } }, { text: "SUMMARY" }, { text: "after" }], seen),
  });
  const { conversation } = await chat.turn({ ...ALICE, message: "one", onEvent() {} });
  const events = [];
  await chat.turn({ ...ALICE, conversation, message: "two", onEvent: (e) => events.push(e) });
  assert.deepEqual(events.slice(0, 2).map((e) => e.type), ["compacting", "context"]);
  assert.equal(events[1].compacted, true);
  assert.deepEqual(seen.at(-1).slice(1).map((m) => m.content.includes("SUMMARY") || m.content), [true, "two"]);
});

test("a message over the cap is refused with a clear error", async () => {
  const chat = createChatService({ dir: tmp(), llmConfig: () => cfg, stream: scriptedModel([{ text: "x" }]), makeHost: (who) => fakeHost(who, []) });
  await assert.rejects(chat.turn({ ...ALICE, message: "a".repeat(MESSAGE_MAX + 1), onEvent() {} }), (e) => e.code === "too_long" && e.status === 413 && /at most 4000/.test(e.message));
  assert.equal(MESSAGE_MAX, 4000);
});

test("file data in a tool result never reaches the conversation", async () => {
  const blob = (await import("node:crypto")).randomBytes(1200).toString("base64");
  const out = scrubBlobs(JSON.stringify({ name: "save.bin", size: 1600, data: blob }));
  assert.ok(!out.includes(blob));
  assert.match(out, /1600 characters of file data left out/);
  const prose = "a".repeat(2000);
  assert.equal(scrubBlobs(prose), prose, "a long run that is not file data stays (the length cap handles it)");
  assert.match(out, /save\.bin/);
});

test("the per-person limit counts each key on its own and says when to retry", () => {
  const rate = createKeyRate({ max: 2, windowMs: 60_000 });
  assert.ok(rate.hit("a", 0).ok && rate.hit("a", 1).ok);
  const third = rate.hit("a", 2);
  assert.equal(third.ok, false);
  assert.equal(third.retryAfterSec, 60);
  assert.ok(rate.hit("b", 2).ok, "another person is not held back");
  assert.ok(rate.hit("a", 60_001).ok, "the window moves on");
});

// The web routes: the person is named by a test header; writes carry the CSRF cookie and header.
async function startWeb({ enabled = true, rate, stream = scriptedModel([{ text: "hello", usage: { prompt_tokens: 10, completion_tokens: 2 } }, { text: "SUMMARY" }]) } = {}) {
  const service = createChatService({ dir: tmp(), llmConfig: () => cfg, stream, notify() {}, makeHost: (who) => fakeHost(who, []) });
  const whoOf = (req) => ({ alice: ALICE, bob: BOB })[req.get("x-test-user")] ?? null;
  const app = express().use(userChatRouter({ service: () => service, enabled: () => enabled, whoOf, ...(rate ? { rate } : {}) }));
  const admin = express.Router();
  admin.use(express.json());
  mountChatApi(admin, () => true, { service: () => service, enabled: () => enabled });
  app.use("/admin", admin);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const root = `http://127.0.0.1:${server.address().port}`;
  const as = (user, url, init = {}) => fetch(`${root}${url}`, {
    ...init,
    headers: { "x-test-user": user, cookie: "cf_csrf=test-csrf-token-0000000000000000", "x-csrf-token": "test-csrf-token-0000000000000000", "content-type": "application/json", ...(init.headers ?? {}) },
  });
  return { root, as, close: () => server.close() };
}
const lines = async (res) => (await res.text()).trim().split("\n").map((l) => JSON.parse(l));

test("conversations are per account: user B gets 404 on user A's conversation, and nobody else lists it", async () => {
  const s = await startWeb();
  const res = await s.as("alice", "/api/chat", { method: "POST", body: JSON.stringify({ message: "hi" }) });
  assert.equal(res.status, 200);
  const id = (await lines(res))[0].conversation;
  assert.equal((await s.as("alice", `/api/chat?id=${id}`)).status, 200);
  assert.equal((await s.as("bob", `/api/chat?id=${id}`)).status, 404);
  assert.equal((await s.as("bob", "/api/chat", { method: "POST", body: JSON.stringify({ message: "more", conversation: id }) })).status, 404);
  assert.equal((await s.as("bob", "/api/chat/compact", { method: "POST", body: JSON.stringify({ conversation: id }) })).status, 404);
  assert.equal((await s.as("bob", `/api/chat?id=${id}`, { method: "DELETE" })).status, 404);
  assert.deepEqual((await (await s.as("bob", "/api/chat")).json()).conversations, []);
  assert.deepEqual((await (await fetch(`${s.root}/admin/api/chat`)).json()).conversations, [], "the admin's list is the admin's own");
  assert.equal((await fetch(`${s.root}/admin/api/chat?id=${id}`)).status, 404);
  assert.equal((await s.as("alice", `/api/chat?id=${id}`)).status, 200, "still there for alice");
  s.close();
});

test("the web chat needs a signed-in person and the CSRF token, and is not there while the chat is off", async () => {
  const s = await startWeb();
  assert.equal((await fetch(`${s.root}/api/chat`)).status, 401);
  const noCsrf = await fetch(`${s.root}/api/chat`, { method: "POST", headers: { "x-test-user": "alice", "content-type": "application/json" }, body: JSON.stringify({ message: "hi" }) });
  assert.equal(noCsrf.status, 403);
  const status = await (await s.as("alice", "/api/chat?status=1")).json();
  assert.equal(status.configured, true);
  s.close();
  const off = await startWeb({ enabled: false });
  assert.equal((await off.as("alice", "/api/chat?status=1")).status, 404);
  assert.equal((await off.as("alice", "/api/chat", { method: "POST", body: JSON.stringify({ message: "hi" }) })).status, 404);
  off.close();
});

test("sending is limited per account, and an over-long message is a 413 before the model is asked", async () => {
  const s = await startWeb({ rate: createKeyRate({ max: 2, windowMs: 60_000 }) });
  const send = (user, message) => s.as(user, "/api/chat", { method: "POST", body: JSON.stringify({ message }) });
  const long = await send("alice", "a".repeat(MESSAGE_MAX + 1));
  assert.equal(long.status, 413);
  assert.equal((await long.json()).code, "too_long");
  assert.equal((await send("alice", "two")).status, 200);
  const third = await send("alice", "three");
  assert.equal(third.status, 429);
  assert.ok(Number(third.headers.get("retry-after")) > 0);
  assert.equal((await send("bob", "one")).status, 200, "bob has his own allowance");
  s.close();
});

test("the meter's numbers come back with a conversation, and compaction answers only its owner", async () => {
  const s = await startWeb();
  const id = (await lines(await s.as("alice", "/api/chat", { method: "POST", body: JSON.stringify({ message: "hi" }) })))[0].conversation;
  const got = await (await s.as("alice", `/api/chat?id=${id}`)).json();
  assert.equal(got.context.used, 12);
  const compacted = await s.as("alice", "/api/chat/compact", { method: "POST", body: JSON.stringify({ conversation: id }) });
  assert.equal(compacted.status, 200);
  const after = await (await s.as("alice", `/api/chat?id=${id}`)).json();
  assert.deepEqual(after.messages.filter((m) => m.role === "user").map((m) => m.content), ["hi"]);
  assert.ok(after.messages.some((m) => m.compact === true));
  s.close();
});
