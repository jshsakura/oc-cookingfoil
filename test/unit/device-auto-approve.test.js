import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 17400 + (process.pid % 500);
const BASE = `http://127.0.0.1:${PORT}`;
const ALICE = "Basic " + Buffer.from("alice:alice-password").toString("base64");
const SIGNED_IN = "B1".repeat(32);
const STRANGER = "C2".repeat(32);
const KNOCKER = "D3".repeat(32);

async function boot(autoApprove) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "cf-auto-"));
  fs.mkdirSync(path.join(data, "games"));
  const child = spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: { ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: data, COOK_GAMES_DIR: path.join(data, "games"),
      COOK_AUTH_USERS: "alice:alice-password", COOK_DEVICE_PAIRING: "true",
      COOK_TITLEDB_AUTO_FETCH: "false", COOK_LOCKOUT_TRUST_LOOPBACK: "false",
      ...(autoApprove === undefined ? {} : { COOK_DEVICE_AUTO_APPROVE: autoApprove }) },
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

const status = async (key) => (await fetch(`${BASE}/api/pair/status`, { headers: { "X-Device-Key": key } })).json();

test("a console that signs in is approved on the spot (the default); one that doesn't still waits", async () => {
  const server = await boot();
  try {
    assert.equal((await status(SIGNED_IN)).status, "pending");
    const r = await fetch(`${BASE}/api/shop/sections`, { headers: { Authorization: ALICE, "X-Device-Key": SIGNED_IN } });
    assert.equal(r.status, 200);

    const first = await status(SIGNED_IN);
    assert.equal(first.status, "approved");
    assert.match(first.accessKey, /^[A-Za-z0-9_-]{20,}$/, "the key comes down on the next poll");
    assert.equal((await status(SIGNED_IN)).accessKey, undefined, "and only once");
    const paired = await fetch(`${BASE}/api/shop/sections`, { headers: { "X-Device-Key": SIGNED_IN, "X-Access-Key": first.accessKey } });
    assert.equal(paired.status, 200, "afterwards it connects with no password");

    // A console whose first call is the pairing poll, with its account: approved there and then.
    const knock = await (await fetch(`${BASE}/api/pair/status`, { headers: { Authorization: ALICE, "X-Device-Key": KNOCKER } })).json();
    assert.equal(knock.status, "approved");
    assert.ok(knock.accessKey);
    const wrong = "Basic " + Buffer.from("alice:wrong").toString("base64");
    assert.equal((await (await fetch(`${BASE}/api/pair/status`, { headers: { Authorization: wrong, "X-Device-Key": STRANGER } })).json()).status, "pending", "a wrong password approves nothing");

    assert.equal((await fetch(`${BASE}/api/shop/sections`, { headers: { "X-Device-Key": STRANGER } })).status, 401);
    assert.equal((await status(STRANGER)).status, "pending", "no sign-in, no approval");
  } finally {
    server.kill("SIGKILL");
  }
});

test("manual approval: with auto-approval off, a signed-in console waits for the admin", async () => {
  const server = await boot("false");
  try {
    assert.equal((await fetch(`${BASE}/api/shop/sections`, { headers: { Authorization: ALICE, "X-Device-Key": SIGNED_IN } })).status, 200);
    assert.equal((await status(SIGNED_IN)).status, "pending");
    assert.equal((await (await fetch(`${BASE}/api/pair/status`, { headers: { Authorization: ALICE, "X-Device-Key": KNOCKER } })).json()).status, "pending");
  } finally {
    server.kill("SIGKILL");
  }
});

test("a console polling with a stale password isn't locked out; guessing passwords still is", async () => {
  const server = await boot();
  try {
    const poll = (password, key = STRANGER) => fetch(`${BASE}/api/pair/status`, {
      headers: { Authorization: "Basic " + Buffer.from(`alice:${password}`).toString("base64"), "X-Device-Key": key } });
    for (let i = 0; i < 12; i++) assert.equal((await poll("old-password")).status, 200, `poll ${i + 1}: the same saved password counts once`);
    assert.equal((await (await poll("old-password")).json()).status, "pending");
    let last;
    for (let i = 0; i < 6; i++) last = await poll(`guess-${i}`);
    assert.equal(last.status, 429, "new wrong passwords lock the address");
  } finally {
    server.kill("SIGKILL");
  }
});
