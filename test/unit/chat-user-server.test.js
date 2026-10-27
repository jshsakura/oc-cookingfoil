import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { webSession } from "../support/web-session.js";

// The real server with two accounts and the chat on, its model a stand-in on this machine.
const PORT = 19900 + (process.pid % 90);
const BASE = `http://127.0.0.1:${PORT}`;
const TITLE = "0100000000010000";

/** An OpenAI-style stream: first a wishlist call, then words once the tool has answered. */
function fakeModel() {
  const asked = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const { messages, tools = [] } = JSON.parse(body);
      asked.push({ messages, tools: tools.map((t) => t.function.name) });
      const chunk = (o) => `data: ${JSON.stringify(o)}\n\n`;
      res.writeHead(200, { "content-type": "text/event-stream" });
      if (messages.at(-1).role === "tool") {
        res.write(chunk({ choices: [{ delta: { content: "담았습니다." }, finish_reason: "stop" }] }));
      } else {
        const args = JSON.stringify({ action: "games_wishlist_set", args: { op: "add", titleId: TITLE, name: "Test" } });
        res.write(chunk({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "games", arguments: args } }] }, finish_reason: "tool_calls" }] }));
      }
      res.write(chunk({ choices: [], usage: { prompt_tokens: 50, completion_tokens: 5 } }));
      res.end("data: [DONE]\n\n");
    });
  });
  return { server, asked };
}

async function boot(modelPort) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "cf-chat-user-"));
  fs.mkdirSync(path.join(data, "games"));
  const child = spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: {
      ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: data, COOK_GAMES_DIR: path.join(data, "games"), COOK_TITLEDB_AUTO_FETCH: "false",
      COOK_AUTH_USERS: "alice:alice-password,bob:bob-password", COOK_CHAT_ENABLED: "true",
      COOK_CHAT_LLM_BASE_URL: `http://127.0.0.1:${modelPort}/v1`, COOK_CHAT_LLM_MODEL: "test-model", COOK_CHAT_LLM_API_KEY: "sk-test-0000-0000",
    },
    stdio: "ignore",
  });
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) return { child, data };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill("SIGKILL");
  throw new Error("server did not start");
}

test("on the real server a signed-in person chats as themselves: their wishlist, their conversations, the user tools only", async () => {
  const model = fakeModel();
  await new Promise((r) => model.server.listen(0, "127.0.0.1", r));
  const { child, data } = await boot(model.server.address().port);
  try {
    const alice = { ...(await webSession(BASE, "alice", "alice-password")), "Content-Type": "application/json" };
    const bob = { ...(await webSession(BASE, "bob", "bob-password")), "Content-Type": "application/json" };

    assert.equal((await fetch(`${BASE}/api/chat?status=1`, { headers: { Accept: "application/json" } })).status, 401, "signed out");
    const status = await (await fetch(`${BASE}/api/chat?status=1`, { headers: alice })).json();
    assert.equal(status.configured, true);

    const noCsrf = await fetch(`${BASE}/api/chat`, { method: "POST", headers: { ...alice, "X-CSRF-Token": "" }, body: JSON.stringify({ message: "hi" }) });
    assert.equal(noCsrf.status, 403);
    const otherSite = await fetch(`${BASE}/api/chat`, { method: "POST", headers: { ...alice, Origin: "https://evil.example.com" }, body: JSON.stringify({ message: "hi" }) });
    assert.equal(otherSite.status, 403);

    const res = await fetch(`${BASE}/api/chat`, { method: "POST", headers: alice, body: JSON.stringify({ message: "찜해 주세요" }) });
    assert.equal(res.status, 200);
    const events = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
    const id = events[0].conversation;
    assert.equal(events.find((e) => e.type === "tool_end").status, "done");
    assert.ok(events.some((e) => e.type === "context" && e.used === 55));

    const offered = new Set(model.asked[0].tools);
    assert.deepEqual([...offered].sort(), ["games", "help", "retro"], "no admin, library, jobs or plugins area is offered");
    assert.match(model.asked[0].messages[0].content, /Butter/);

    const wishes = async (who) => (await (await fetch(`${BASE}/pair/api/wishlist`, { headers: who })).json()).items.map((w) => w.titleId);
    assert.deepEqual(await wishes(alice), [TITLE], "the chat changed alice's own list");
    assert.deepEqual(await wishes(bob), [], "and not bob's");

    assert.equal((await fetch(`${BASE}/api/chat?id=${id}`, { headers: alice })).status, 200);
    assert.equal((await fetch(`${BASE}/api/chat?id=${id}`, { headers: bob })).status, 404);
    assert.equal((await fetch(`${BASE}/api/chat?id=${id}`, { method: "DELETE", headers: bob })).status, 404);
    assert.deepEqual((await (await fetch(`${BASE}/api/chat`, { headers: bob })).json()).conversations, []);
  } finally {
    child.kill("SIGKILL");
    model.server.close();
    fs.rmSync(data, { recursive: true, force: true });
  }
});
