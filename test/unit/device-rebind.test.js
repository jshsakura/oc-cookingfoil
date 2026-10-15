import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// A client that used to keep a random device key makes it from the console
// now; POST /api/pair/rebind moves the console's approval, name, access key
// and per-device login lock from the old key to the new one.
const PORT = 18300 + (process.pid % 500);
const BASE = `http://127.0.0.1:${PORT}`;
const basic = (name, password) => "Basic " + Buffer.from(`${name}:${password}`).toString("base64");
const ALICE = basic("alice", "alice-password");
const BOB = basic("bob", "bob-password-1");
const OLD = "A1".repeat(32);
const NEW = "B2".repeat(32);
const OLD2 = "C3".repeat(32);
const NEW2 = "D4".repeat(32);
const OLD3 = "E5".repeat(32);
const NEW3 = "F6".repeat(32);
const ELSE = "0A".repeat(32);

async function boot() {
  const data = mkdtempSync(path.join(tmpdir(), "cook-rebind-"));
  const games = path.join(data, "games");
  mkdirSync(games, { recursive: true });
  const child = spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: {
      ...process.env, COOK_CONSOLE_PASSWORDS: "true", COOK_PORT: String(PORT), COOK_DATA_DIR: data, COOK_GAMES_DIR: games,
      COOK_AUTH_USERS: "alice:alice-password,bob:bob-password-1", COOK_DEVICE_PAIRING: "true",
      COOK_TITLEDB_AUTO_FETCH: "false", COOK_LOCKOUT_TRUST_LOOPBACK: "false",
    },
    stdio: "ignore",
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) return child;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill("SIGKILL");
  throw new Error("server did not start");
}

const rebind = (to, body, headers = {}) =>
  fetch(`${BASE}/api/pair/rebind`, { method: "POST", headers: { "Content-Type": "application/json", "X-Device-Key": to, ...headers }, body: JSON.stringify(body) });
const status = async (key, auth) => (await fetch(`${BASE}/api/pair/status`, { headers: { "X-Device-Key": key, ...(auth ? { Authorization: auth } : {}) } })).json();
const shop = (headers) => fetch(`${BASE}/api/shop/sections`, { headers });

test("a console moves to its new key with its account, or with its old access key", async () => {
  const server = await boot();
  try {
    // Approved by signing in as alice, key taken.
    const first = await status(OLD, ALICE);
    assert.equal(first.status, "approved");
    const accessKey = first.accessKey;
    assert.ok(accessKey);

    assert.equal((await rebind(NEW, { from: OLD })).status, 401, "no proof");
    assert.equal((await rebind(NEW, { from: OLD }, { Authorization: basic("alice", "wrong") })).status, 401, "a wrong password is no proof");
    assert.equal((await rebind(NEW, { from: OLD }, { Authorization: BOB })).status, 403, "another account cannot take alice's console");
    assert.equal((await rebind(OLD, { from: OLD }, { Authorization: ALICE })).status, 400, "the same key");
    assert.equal((await rebind(NEW, { from: "nope" }, { Authorization: ALICE })).status, 400);

    const moved = await rebind(NEW, { from: OLD }, { Authorization: ALICE });
    assert.equal(moved.status, 200);
    assert.deepEqual(await moved.json(), { status: "moved", deviceKey: NEW });
    assert.equal((await shop({ "X-Device-Key": NEW, "X-Access-Key": accessKey })).status, 200, "the old access key opens the shop under the new key");
    assert.equal((await shop({ "X-Device-Key": OLD, "X-Access-Key": accessKey })).status, 401, "and no longer under the old one");
    assert.equal((await status(NEW)).status, "approved");
    const again = await rebind(NEW, { from: OLD }, { Authorization: ALICE });
    assert.deepEqual(await again.json(), { status: "kept", deviceKey: NEW }, "a retry is harmless");

    // No password at all: the old access key is the proof.
    const second = await status(OLD2, BOB);
    assert.equal((await rebind(NEW2, { from: OLD2, accessKey: "x".repeat(43) })).status, 401, "a wrong access key is no proof");
    const byKey = await rebind(NEW2, { from: OLD2 }, { "X-Access-Key": second.accessKey });
    assert.deepEqual(await byKey.json(), { status: "moved", deviceKey: NEW2 });
    assert.equal((await shop({ "X-Device-Key": NEW2, "X-Access-Key": second.accessKey })).status, 200);
  } finally {
    server.kill("SIGKILL");
  }
});

test("a per-device login's console lock follows the console to its new key", async () => {
  const server = await boot();
  try {
    const login = await (await fetch(`${BASE}/pair/api/logins`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: ALICE, Origin: BASE }, body: JSON.stringify({ label: "TV" }),
    })).json();
    const auth = basic(login.name, login.password);
    assert.equal((await shop({ Authorization: auth, UID: OLD3 })).status, 200, "locks to the old key");
    assert.equal((await shop({ Authorization: auth, UID: NEW3 })).status, 403, "the new key is another console until it moves");

    assert.equal((await rebind(NEW3, { from: ELSE }, { Authorization: auth })).status, 403, "a login moves only from the console it is locked to");
    const moved = await rebind(NEW3, { from: OLD3 }, { Authorization: auth });
    assert.equal(moved.status, 200);
    assert.equal((await shop({ Authorization: auth, UID: NEW3 })).status, 200, "the new key is the console now");
    assert.equal((await shop({ Authorization: auth, UID: OLD3 })).status, 403, "and the old one is not");
  } finally {
    server.kill("SIGKILL");
  }
});

const VICTIM = "1B".repeat(32);
const MINE = "2C".repeat(32);
const WAITING = "3D".repeat(32);
const SPARE = "4E".repeat(32);
const SPARE2 = "5F".repeat(32);

test("nobody moves a console that is not theirs, nor onto a key that is in use", async () => {
  const server = await boot();
  try {
    // Bob's console, approved by signing in as bob.
    const victim = await status(VICTIM, BOB);
    assert.equal(victim.status, "approved");
    const newLogin = async () => (await fetch(`${BASE}/pair/api/logins`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: ALICE, Origin: BASE }, body: JSON.stringify({ label: "x" }),
    })).json();

    // A fresh, unlocked login of alice's proves nothing about bob's console.
    const fresh = await newLogin();
    const freshAuth = basic(fresh.name, fresh.password);
    assert.equal((await rebind(SPARE, { from: VICTIM }, { Authorization: freshAuth })).status, 403);
    // Nor one already locked to alice's own console, moving bob's onto it.
    const locked = await newLogin();
    const lockedAuth = basic(locked.name, locked.password);
    assert.equal((await shop({ Authorization: lockedAuth, UID: MINE })).status, 200);
    assert.equal((await rebind(MINE, { from: VICTIM }, { Authorization: lockedAuth })).status, 403);
    // Nor one locked to bob's key by presenting it (keys are no secret).
    const grabbed = await newLogin();
    const grabbedAuth = basic(grabbed.name, grabbed.password);
    await shop({ Authorization: grabbedAuth, UID: VICTIM });
    await fetch(`${BASE}/api/pair/request`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: grabbedAuth, "X-Device-Key": VICTIM }, body: "{}" });
    assert.equal((await rebind(SPARE, { from: VICTIM }, { Authorization: grabbedAuth })).status, 403);
    assert.equal((await shop({ "X-Device-Key": VICTIM, "X-Access-Key": victim.accessKey })).status, 200, "bob's console still works");

    // Alice's own console cannot be moved onto a key waiting in the queue,
    // or onto one bob's account approved.
    const mine = await status(SPARE2, ALICE);
    assert.equal(mine.status, "approved");
    assert.equal((await status(WAITING)).status, "pending");
    assert.equal((await rebind(WAITING, { from: SPARE2 }, { Authorization: ALICE })).status, 409);
    assert.equal((await rebind(VICTIM, { from: SPARE2 }, { "X-Access-Key": mine.accessKey })).status, 409);
    assert.equal((await status(WAITING)).status, "pending", "the waiting console is untouched");
  } finally {
    server.kill("SIGKILL");
  }
});

