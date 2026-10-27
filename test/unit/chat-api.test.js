import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import express from "express";

process.env.COOK_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "cook-chat-api-data-"));
const { createChatService } = await import("../../src/chat/service.js");
const { mountChatApi } = await import("../../src/routes/admin/chat-api.js");

const cfg = { baseUrl: "https://llm.example.com/v1", model: "m", apiKey: "sk-test-secret-0000" };

/** Scripted model: round one calls the `help` tool, round two answers in words. */
const scripted = () => {
  let round = 0;
  return async function* ({ messages }) {
    round++;
    if (messages.at(-1).role === "tool") {
      yield { type: "text", delta: "done reading" };
    } else {
      yield { type: "tool_calls", calls: [{ id: "c1", name: "help", arguments: "{}" }] };
    }
    yield { type: "done" };
    if (round > 5) throw new Error("loop");
  };
};

async function start({ enabled = true, signedIn = true, stream = scripted(), llmConfig = () => cfg } = {}) {
  const service = createChatService({ dir: fs.mkdtempSync(path.join(os.tmpdir(), "cook-chat-api-")), llmConfig, stream });
  const router = express.Router();
  router.use(express.json());
  const requireSession = (req, res) => {
    if (signedIn) return true;
    res.status(401).json({ error: "2fa required" });
    return false;
  };
  mountChatApi(router, requireSession, { service: () => service, enabled: () => enabled });
  const app = express().use("/admin", router);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}/admin/api/chat`;
  return { base, close: () => server.close(), service };
}

const post = (url, body) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const lines = async (res) => (await res.text()).trim().split("\n").map((l) => JSON.parse(l));

test("the chat is not there while the setting is off, and needs a session", async () => {
  const off = await start({ enabled: false });
  assert.equal((await fetch(off.base)).status, 404);
  assert.equal((await post(off.base, { message: "hi" })).status, 404);
  off.close();
  const out = await start({ signedIn: false });
  assert.equal((await fetch(out.base)).status, 401);
  out.close();
});

test("a turn streams events as lines, runs the help tool for real, and the conversation can be read back", async () => {
  const s = await start();
  const res = await post(s.base, { message: "what can you do" });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /ndjson/);
  const events = await lines(res);
  assert.deepEqual(events.map((e) => e.type), ["tool_start", "tool_end", "text", "done"]);
  assert.equal(events.find((e) => e.type === "tool_end").status, "done");
  const id = events[0].conversation;

  const list = await (await fetch(s.base)).json();
  assert.equal(list.configured, true);
  assert.deepEqual(list.conversations.map((c) => c.id), [id]);
  const loaded = await (await fetch(`${s.base}?id=${id}`)).json();
  assert.deepEqual(loaded.messages.map((m) => m.role), ["user", "assistant", "tool", "assistant"]);
  s.close();
});

test("a refusal before the stream starts is a plain JSON error", async () => {
  const s = await start({ llmConfig: () => ({ baseUrl: "", model: "", apiKey: "" }) });
  const res = await post(s.base, { message: "hi" });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).code, "not_configured");
  const bad = await start();
  assert.equal((await post(bad.base, { message: "" })).status, 400);
  assert.equal((await post(`${bad.base}/decision`, { id: 1 })).status, 400);
  s.close();
  bad.close();
});

test("deleting a conversation removes it, and an unknown one is 404", async () => {
  const s = await start();
  const id = (await lines(await post(s.base, { message: "hi" })))[0].conversation;
  assert.equal((await fetch(`${s.base}?id=${id}`, { method: "DELETE" })).status, 200);
  assert.equal((await fetch(`${s.base}?id=${id}`)).status, 404);
  assert.equal((await fetch(`${s.base}?id=${id}`, { method: "DELETE" })).status, 404);
  s.close();
});

test("settling a call that is not waiting says denied", async () => {
  const s = await start();
  await post(s.base, { message: "hi" });
  const out = await (await post(`${s.base}/decision`, { id: "nope", approve: true })).json();
  assert.equal(out.status, "denied");
  s.close();
});

test("the status query tells whether the chat is on and its model set, without listing conversations", async () => {
  const on = await start();
  assert.deepEqual(await (await fetch(`${on.base}?status=1`)).json(), { configured: true, name: "" });
  on.close();
  const unset = await start({ llmConfig: () => ({ baseUrl: "", model: "", apiKey: "" }) });
  assert.deepEqual(await (await fetch(`${unset.base}?status=1`)).json(), { configured: false, name: "" });
  unset.close();
  const off = await start({ enabled: false });
  assert.equal((await fetch(`${off.base}?status=1`)).status, 404);
  off.close();
});
