import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { webSession } from "../support/web-session.js";

// "Send to my console" over HTTP: a signed-in account queues a library file for a console it approved,
// the console lists and acks its own queue, and nobody reaches another account's console.
const PORT = 27600 + (process.pid % 300);
const BASE = `http://127.0.0.1:${PORT}`;
const ACCOUNTS = { alice: "alice-password", bob: "bob-password-1" };
const key = (c) => c.repeat(64);
const secret = (c) => c.toLowerCase().repeat(64);
const GAME = "Game/Test Game [0100000000010000][v0].nsp";

async function boot() {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "cf-sends-routes-"));
  fs.mkdirSync(path.join(data, "games", "Game"), { recursive: true });
  fs.writeFileSync(path.join(data, "games", GAME), "NSP");
  const child = spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: { ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: data, COOK_GAMES_DIR: path.join(data, "games"),
      COOK_AUTH_USERS: Object.entries(ACCOUNTS).map(([n, p]) => `${n}:${p}`).join(","), COOK_DEVICE_PAIRING: "true",
      COOK_DEVICE_AUTO_APPROVE: "false", COOK_DEVICE_LIMIT: "3", COOK_PUBLIC_BASE_URL: "",
      COOK_ADMIN_PASSWORD: "admin-password-123", COOK_ADMIN_TOTP_SECRET: "", COOK_TITLEDB_AUTO_FETCH: "false", COOK_LOCKOUT_TRUST_LOOPBACK: "false" },
    stdio: "ignore",
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) return { child, data };
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill("SIGKILL");
  throw new Error("server did not start");
}

const sessions = {};
const signedIn = async (a) => (sessions[a] ??= await webSession(BASE, a, ACCOUNTS[a]));
const json = (h) => ({ ...h, "Content-Type": "application/json" });

async function pairAs(account, deviceKey, pairSecret) {
  const asked = await (await fetch(`${BASE}/api/pair/request`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceKey, pairSecret }) })).json();
  const ok = await fetch(`${BASE}/pair/approve`, { method: "POST", headers: json(await signedIn(account)), body: JSON.stringify({ code: asked.pairCode }) });
  assert.equal(ok.status, 200);
  const r = await fetch(`${BASE}/api/pair/status`, { headers: { "X-Device-Key": deviceKey, "X-Pair-Secret": pairSecret } });
  const { accessKey } = await r.json();
  assert.ok(accessKey);
  return { "X-Device-Key": deviceKey, "X-Access-Key": accessKey };
}

const send = async (account, deviceKey, p) => {
  const r = await fetch(`${BASE}/pair/api/sends`, { method: "POST", headers: json(await signedIn(account)), body: JSON.stringify({ deviceKey, path: p }) });
  return { code: r.status, body: await r.json() };
};
const queue = async (headers) => {
  const r = await fetch(`${BASE}/api/device/sends`, { headers });
  return { code: r.status, body: r.status === 200 ? await r.json() : null, etag: r.headers.get("etag") };
};

test("send, list, ack, and who may do which", async () => {
  const { child, data } = await boot();
  try {
    for (const k of Object.keys(sessions)) delete sessions[k];
    const consoleA = await pairAs("alice", key("1"), secret("a"));
    const consoleB = await pairAs("bob", key("2"), secret("b"));

    // Ownership: bob cannot send to alice's console, and cannot tell it from a console that does not exist.
    assert.equal((await send("bob", key("1"), GAME)).code, 404);
    assert.equal((await send("alice", key("9"), GAME)).code, 404);
    assert.equal((await queue(consoleA)).body.items.length, 0, "nothing was queued by the refused tries");

    // Paths: only what the library holds, and nothing that climbs out of it.
    assert.equal((await send("alice", key("1"), "Game/Nope.nsp")).code, 404);
    for (const bad of ["../../etc/passwd", "/etc/passwd", "Game/../../x", "", 5]) assert.equal((await send("alice", key("1"), bad)).code, 400, String(bad));

    // A send, and the same again.
    const sent = await send("alice", key("1"), GAME);
    assert.equal(sent.code, 200);
    assert.equal(sent.body.existing, false);
    assert.equal(sent.body.item.sentBy, "alice");
    assert.match(sent.body.item.sentAt, /^\d{4}-\d\d-\d\dT.*Z$/);
    const again = await send("alice", key("1"), `../${GAME}`);
    assert.equal(again.body.existing, true);
    assert.equal(again.body.item.id, sent.body.item.id);

    // The web list is the account's own; another account's is empty.
    const mineList = await (await fetch(`${BASE}/pair/api/sends`, { headers: await signedIn("alice") })).json();
    assert.deepEqual(mineList.consoles.map((c) => [c.deviceKey, c.items.length]), [[key("1"), 1]]);
    assert.deepEqual((await (await fetch(`${BASE}/pair/api/sends`, { headers: await signedIn("bob") })).json()).consoles, []);

    // The console sees its own queue only, with an absolute url and the server id; 304 while unchanged.
    const got = await queue(consoleA);
    assert.equal(got.code, 200);
    assert.match(got.body.serverId, /^[0-9a-f-]{36}$/);
    assert.equal(got.body.items.length, 1);
    assert.equal(got.body.items[0].url, `${BASE}/${encodeURIComponent("Game").replace(/%2F/g, "/")}%2F${encodeURIComponent("Test Game [0100000000010000][v0].nsp")}`);
    assert.equal((await queue(consoleB)).body.items.length, 0, "another console's queue is empty");
    assert.equal((await fetch(`${BASE}/api/device/sends`, { headers: { ...consoleA, "If-None-Match": got.etag } })).status, 304);
    assert.equal((await fetch(`${BASE}/api/device/sends`)).status === 200, false, "no credentials, no queue");
    const file = await fetch(got.body.items[0].url, { headers: consoleA });
    assert.equal(await file.text(), "NSP", "the url downloads the file with the console's credentials");

    // Cancel: only the sender.
    const id = sent.body.item.id;
    assert.equal((await fetch(`${BASE}/pair/api/sends/${id}/cancel`, { method: "POST", headers: await signedIn("bob") })).status, 404);
    // Ack: only its own console's items; another console's ack changes nothing.
    const wrong = await fetch(`${BASE}/api/device/sends/ack`, { method: "POST", headers: json(consoleB), body: JSON.stringify({ ids: [id], result: "accepted" }) });
    assert.equal((await wrong.json()).removed, 0);
    assert.equal((await queue(consoleA)).body.items.length, 1);
    const bad = await fetch(`${BASE}/api/device/sends/ack`, { method: "POST", headers: json(consoleA), body: JSON.stringify({ ids: [id], result: "maybe" }) });
    assert.equal(bad.status, 400);
    const ack = await fetch(`${BASE}/api/device/sends/ack`, { method: "POST", headers: json(consoleA), body: JSON.stringify({ ids: [id], result: "declined" }) });
    assert.deepEqual(await ack.json(), { ok: true, removed: 1 });
    assert.equal((await queue(consoleA)).body.items.length, 0);

    // Cancel by the sender removes it before the console looks.
    const second = (await send("alice", key("1"), GAME)).body.item.id;
    const cancel = await fetch(`${BASE}/pair/api/sends/${second}/cancel`, { method: "POST", headers: await signedIn("alice") });
    assert.equal(cancel.status, 200);
    assert.equal((await queue(consoleA)).body.items.length, 0);

    // A write from another origin is refused.
    const cross = await fetch(`${BASE}/pair/api/sends`, { method: "POST", headers: json({ ...(await signedIn("alice")), Origin: "http://192.0.2.1" }), body: JSON.stringify({ deviceKey: key("1"), path: GAME }) });
    assert.equal(cross.status, 403);
  } finally {
    child.kill("SIGKILL");
    fs.rmSync(data, { recursive: true, force: true });
  }
});
