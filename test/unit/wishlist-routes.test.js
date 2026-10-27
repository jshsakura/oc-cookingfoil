import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { webSession } from "../support/web-session.js";

// "찜" over HTTP: a signed-in account keeps its own wishlist by title id, and a console reads the list
// of the account that approved it, with whether this server holds each game.
const PORT = 27900 + (process.pid % 300);
const BASE = `http://127.0.0.1:${PORT}`;
const ACCOUNTS = { alice: "alice-password", bob: "bob-password-1" };
const key = (c) => c.repeat(64);
const secret = (c) => c.toLowerCase().repeat(64);
const GAME = "Game/Test Game [0100000000010000][v0].nsp";

async function boot() {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "cf-wish-routes-"));
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

const wish = async (account, titleId, name, to = "/pair/api/wishlist") => {
  const r = await fetch(`${BASE}${to}`, { method: "POST", headers: json(await signedIn(account)), body: JSON.stringify({ titleId, name }) });
  return { code: r.status, body: await r.json() };
};
const mine = async (account) => (await (await fetch(`${BASE}/pair/api/wishlist`, { headers: await signedIn(account) })).json()).items;
const onConsole = async (headers) => {
  const r = await fetch(`${BASE}/api/device/wishlist`, { headers });
  return { code: r.status, body: r.status === 200 ? await r.json() : null, etag: r.headers.get("etag") };
};

test("each account keeps its own wishes; a console sees its approver's, with what this server holds", async () => {
  const { child, data } = await boot();
  try {
    const consoleA = await pairAs("alice", key("1"), secret("a"));
    const consoleB = await pairAs("bob", key("2"), secret("b"));

    assert.equal((await wish("alice", "not-an-id", "x")).code, 400);
    const first = await wish("alice", "0100000000010000", "Test Game");
    assert.equal(first.code, 200);
    assert.equal(first.body.existing, false);
    assert.equal((await wish("alice", "0100000000010000".toLowerCase(), "Test Game")).body.existing, true, "the same title in any case is the same wish");
    await wish("alice", "0100000000099000", "Elsewhere");
    assert.deepEqual((await mine("alice")).map((w) => w.titleId), ["0100000000099000", "0100000000010000"], "newest first");
    assert.deepEqual(await mine("bob"), [], "another account's list is its own");

    const got = await onConsole(consoleA);
    assert.equal(got.code, 200);
    assert.match(got.body.serverId, /^[0-9a-f-]{36}$/);
    assert.deepEqual(got.body.items.map((w) => [w.titleId, w.inLibrary]), [["0100000000099000", false], ["0100000000010000", true]]);
    assert.equal((await fetch(`${BASE}/api/device/wishlist`, { headers: { ...consoleA, "If-None-Match": got.etag } })).status, 304);
    assert.deepEqual((await onConsole(consoleB)).body.items, []);
    assert.notEqual((await onConsole({})).code, 200, "no credentials, no list");

    const gone = await wish("alice", "0100000000099000", undefined, "/pair/api/wishlist/remove");
    assert.equal(gone.body.removed, true);
    assert.deepEqual((await onConsole(consoleA)).body.items.map((w) => w.titleId), ["0100000000010000"]);
    const crossSite = await fetch(`${BASE}/pair/api/wishlist`, { method: "POST", headers: { ...json(await signedIn("alice")), Origin: "https://evil.example.com" }, body: JSON.stringify({ titleId: "0100000000020000" }) });
    assert.equal(crossSite.status, 403);
  } finally {
    child.kill("SIGKILL");
    fs.rmSync(data, { recursive: true, force: true });
  }
});
