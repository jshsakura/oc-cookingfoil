import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { webSession } from "../support/web-session.js";

const { deviceCode } = await import("../../src/security/pairing-link.js");

// The real server with two accounts, each with a console, and the chat on with a stand-in model.
// Game cards, "add to my console" and the consoles list must reach the signed-in person's own consoles only.
const PORT = 19500 + (process.pid % 90);
const BASE = `http://127.0.0.1:${PORT}`;
const ACCOUNTS = { alice: "alice-password", bob: "bob-password-1" };
const TITLE = "0100000000010000";
const GAME = `Game/Test Game [${TITLE}][v0].nsp`;
const key = (c) => c.repeat(64);
const secret = (c) => c.toLowerCase().repeat(64);

/** A model that reads the last user line: "show" or "send [code]" becomes one tool call, then it answers in words. */
function fakeModel() {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const { messages } = JSON.parse(body);
      const chunk = (o) => `data: ${JSON.stringify(o)}\n\n`;
      res.writeHead(200, { "content-type": "text/event-stream" });
      if (messages.at(-1).role === "tool") {
        res.write(chunk({ choices: [{ delta: { content: "done." }, finish_reason: "stop" }] }));
      } else {
        const said = messages.at(-1).content;
        const call = said.startsWith("show") ? { action: "games_show", args: { ids: TITLE } }
          : { action: "my_send", args: { game: TITLE, device: said.split(" ")[1] } };
        res.write(chunk({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "games", arguments: JSON.stringify(call) } }] }, finish_reason: "tool_calls" }] }));
      }
      res.write(chunk({ choices: [], usage: { prompt_tokens: 50, completion_tokens: 5 } }));
      res.end("data: [DONE]\n\n");
    });
  });
  return server;
}

async function boot(modelPort) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "cf-chat-cards-"));
  fs.mkdirSync(path.join(data, "games", "Game"), { recursive: true });
  fs.writeFileSync(path.join(data, "games", GAME), "NSP");
  const child = spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: {
      ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: data, COOK_GAMES_DIR: path.join(data, "games"), COOK_TITLEDB_AUTO_FETCH: "false",
      COOK_AUTH_USERS: Object.entries(ACCOUNTS).map(([n, p]) => `${n}:${p}`).join(","), COOK_DEVICE_PAIRING: "true",
      COOK_DEVICE_AUTO_APPROVE: "false", COOK_DEVICE_LIMIT: "3", COOK_PUBLIC_BASE_URL: "", COOK_LOCKOUT_TRUST_LOOPBACK: "false",
      COOK_ADMIN_PASSWORD: "admin-password-123", COOK_ADMIN_TOTP_SECRET: "", COOK_CHAT_ENABLED: "true",
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

const json = (h) => ({ ...h, "Content-Type": "application/json" });

async function pairAs(headers, deviceKey, pairSecret) {
  const asked = await (await fetch(`${BASE}/api/pair/request`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceKey, pairSecret }) })).json();
  const ok = await fetch(`${BASE}/pair/approve`, { method: "POST", headers: json(headers), body: JSON.stringify({ code: asked.pairCode }) });
  assert.equal(ok.status, 200);
  const { accessKey } = await (await fetch(`${BASE}/api/pair/status`, { headers: { "X-Device-Key": deviceKey, "X-Pair-Secret": pairSecret } })).json();
  const consoleHeaders = { "X-Device-Key": deviceKey, "X-Access-Key": accessKey };
  // The console's client reads its list once, which is what makes it a target for sends.
  assert.equal((await fetch(`${BASE}/api/device/sends`, { headers: consoleHeaders })).status, 200);
  return consoleHeaders;
}

const events = async (res) => (await res.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));

test("cards, the consoles list and add-to-console reach only the signed-in person's own consoles", async () => {
  const model = fakeModel();
  await new Promise((r) => model.listen(0, "127.0.0.1", r));
  const { child, data } = await boot(model.address().port);
  try {
    const alice = json(await webSession(BASE, "alice", ACCOUNTS.alice));
    const bob = json(await webSession(BASE, "bob", ACCOUNTS.bob));
    const aliceKey = key("1");
    const bobKey = key("2");
    const aliceConsole = await pairAs(alice, aliceKey, secret("a"));
    const bobConsole = await pairAs(bob, bobKey, secret("b"));
    const aliceCode = deviceCode(aliceKey);
    const bobCode = deviceCode(bobKey);
    const queue = async (headers) => (await (await fetch(`${BASE}/api/device/sends`, { headers })).json()).items;
    const say = (headers, message, conversation) => fetch(`${BASE}/api/chat`, { method: "POST", headers, body: JSON.stringify({ message, conversation }) });

    // The consoles list is the caller's own.
    const mineA = await (await fetch(`${BASE}/api/chat/consoles`, { headers: alice })).json();
    assert.deepEqual(mineA.consoles.map((c) => c.code), [aliceCode]);
    const mineB = await (await fetch(`${BASE}/api/chat/consoles`, { headers: bob })).json();
    assert.deepEqual(mineB.consoles.map((c) => c.code), [bobCode]);
    assert.equal((await fetch(`${BASE}/api/chat/consoles`)).status, 401, "signed out");

    // A turn that names a game gives the page a card built by the server.
    const shown = await events(await say(alice, "show me the game"));
    const cards = shown.find((e) => e.type === "cards");
    assert.ok(cards, JSON.stringify(shown));
    assert.equal(cards.cards.length, 1);
    assert.equal(cards.cards[0].id, TITLE);
    assert.equal(cards.cards[0].kind, "switch");
    assert.equal(cards.cards[0].sendable, true);
    assert.match(cards.cards[0].icon, /^\/api\/library\/icon\//);
    const conversation = shown.find((e) => e.conversation).conversation;

    // The stored conversation keeps the cards, so a reload draws them again; the model's copy of the row has no card fields.
    const stored = await (await fetch(`${BASE}/api/chat?id=${conversation}`, { headers: alice })).json();
    assert.deepEqual(stored.messages.find((m) => m.role === "tool").cards[0].id, TITLE);

    // The card's button: needs the page's CSRF token, goes only to a console the caller owns.
    const post = (headers, body) => fetch(`${BASE}/api/chat/send`, { method: "POST", headers, body: JSON.stringify(body) });
    assert.equal((await post({ ...alice, "X-CSRF-Token": "" }, { game: TITLE })).status, 403);
    const toBob = await post(alice, { game: TITLE, device: bobCode });
    assert.equal(toBob.status, 404, "alice cannot reach bob's console by its code");
    assert.deepEqual(await queue(bobConsole), []);
    assert.equal((await post(alice, { game: "0100000000010001" })).status, 404, "a game the library does not hold");
    assert.equal((await post(alice, { game: "nope" })).status, 400);

    const ok = await post(alice, { game: TITLE });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).code, aliceCode);
    const waiting = await queue(aliceConsole);
    assert.equal(waiting.length, 1);
    assert.equal(waiting[0].path, GAME);
    assert.deepEqual(await queue(bobConsole), []);
    const again = await (await post(alice, { game: TITLE, device: aliceCode })).json();
    assert.equal(again.existing, true);

    // The model's own tools hold to the same line: my_send with bob's code is refused, my_devices lists one console.
    const forced = await events(await say(alice, `send ${bobCode}`));
    assert.ok(forced.some((e) => e.type === "tool_end"));
    assert.deepEqual(await queue(bobConsole), [], "the model could not queue a game for another account's console");
    const listed = await (await fetch(`${BASE}/api/chat?id=${forced.find((e) => e.conversation).conversation}`, { headers: alice })).json();
    assert.match(listed.messages.find((m) => m.role === "tool").content, /none of your consoles/);

    // Without a code the model's call goes to the caller's only console.
    const plain = await events(await say(alice, "send"));
    const convo = await (await fetch(`${BASE}/api/chat?id=${plain.find((e) => e.conversation).conversation}`, { headers: alice })).json();
    const sent = JSON.parse(convo.messages.find((m) => m.role === "tool").content);
    assert.equal(sent.code, aliceCode);
    assert.ok(!JSON.stringify(sent).includes(bobCode));
  } finally {
    child.kill("SIGKILL");
    model.close();
    fs.rmSync(data, { recursive: true, force: true });
  }
});
