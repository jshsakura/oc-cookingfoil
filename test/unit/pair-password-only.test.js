import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { records } from "../support/security-db.js";

// A console's ID and password count in one place only: the pairing routes,
// once, to approve it (COOK_DEVICE_AUTO_APPROVE). Everywhere else a Basic
// header authenticates nothing: with keys the keys decide, alone it is the
// same as sending nothing (no Basic challenge either).
const PORT = 19300 + (process.pid % 300);
const BASE = `http://127.0.0.1:${PORT}`;
const basic = (user, pass) => "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
const ALICE = basic("alice", "alice-password");
const KEY = "D4".repeat(32);
const STRANGER = "E5".repeat(32);
const MAX_FAILURES = 3;

const data = fs.mkdtempSync(path.join(os.tmpdir(), "cf-pair-password-"));
let child;
before(async () => {
  fs.mkdirSync(path.join(data, "games"), { recursive: true });
  child = spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: { ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: data, COOK_GAMES_DIR: path.join(data, "games"),
      COOK_AUTH_USERS: "alice:alice-password", COOK_DEVICE_PAIRING: "true", COOK_DEVICE_AUTO_APPROVE: "true",
      COOK_TITLEDB_AUTO_FETCH: "false", COOK_LOCKOUT_TRUST_LOOPBACK: "false", COOK_AUTH_MAX_FAILURES: String(MAX_FAILURES) },
    stdio: "ignore",
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not start");
});
after(() => {
  child?.kill("SIGKILL");
  fs.rmSync(data, { recursive: true, force: true });
});

const get = (url, headers = {}) => fetch(BASE + url, { headers });
let keys;

test("the right ID and password on /api/pair/status approve the console; its keys work from then on", async () => {
  const paired = await (await get("/api/pair/status", { Authorization: ALICE, "X-Device-Key": KEY })).json();
  assert.equal(paired.status, "approved");
  assert.equal(paired.passwordOnly, true);
  assert.ok(paired.accessKey);
  keys = { "X-Device-Key": KEY, "X-Access-Key": paired.accessKey };
  assert.equal((await get("/api/shop/sections", keys)).status, 200);
  const again = await (await get("/api/pair/status", { Authorization: ALICE, "X-Device-Key": KEY })).json();
  assert.deepEqual(again, { status: "approved", passwordOnly: true }, "the key is handed down once");
  const request = await (await fetch(`${BASE}/api/pair/request`, { method: "POST", headers: { "Content-Type": "application/json", ...keys }, body: "{}" })).json();
  assert.deepEqual(request, { status: "approved", passwordOnly: true });
});

test("keys win over a Basic header that comes along, even a wrong one", async () => {
  const r = await get("/api/shop/sections", { ...keys, Authorization: basic("alice", "not-the-password") });
  assert.equal(r.status, 200);
  const info = await (await get("/api/shop/info", { ...keys, Authorization: ALICE })).json();
  assert.ok(info.features.includes("pair-password-only"));
  assert.ok(!info.features.includes("device-logins"));
});

test("/api/session issues the token by the keys and ignores Basic", async () => {
  const withBasic = await get("/api/session", { ...keys, Authorization: ALICE });
  assert.equal(withBasic.status, 200);
  const { token } = await withBasic.json();
  assert.ok(token);
  assert.equal((await get("/api/shop/sections", { "X-Device-Key": KEY, Authorization: `Bearer ${token}` })).status, 200);
  const basicOnly = await get("/api/session", { Authorization: ALICE, "X-Device-Key": KEY });
  assert.equal(basicOnly.status, 401, "a password alone makes no session");
  assert.equal((await get("/api/session", { Authorization: ALICE })).status, 401);
});

test("Basic alone on the shop is the same as nothing: 401, no challenge, and the console waits for approval", async () => {
  const nothing = await get("/api/shop/sections");
  const r = await get("/api/shop/sections", { Authorization: ALICE });
  assert.equal(r.status, 401);
  assert.equal(r.status, nothing.status);
  assert.equal(r.headers.get("www-authenticate"), null, "no password prompt");
  assert.equal(await r.text(), await nothing.text());
  const unpaired = await get("/api/shop/sections", { Authorization: ALICE, "X-Device-Key": STRANGER });
  assert.equal(unpaired.status, 401);
  // The queue reaches the database on its next flush.
  let queued = false;
  for (let i = 0; i < 40 && !queued; i++) {
    queued = STRANGER in records(data, "pending-device");
    if (!queued) await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(queued, "recorded as waiting for approval, as with no credentials");
  const pending = await (await fetch(`${BASE}/api/pair/request`, { method: "POST", headers: { "Content-Type": "application/json", "X-Device-Key": STRANGER }, body: "{}" })).json();
  assert.equal(pending.status, "pending");
  assert.equal(pending.passwordOnly, true);
});

test("a wrong password at pairing leaves the console waiting and counts toward the lockout", async () => {
  const waiting = await (await get("/api/pair/status", { Authorization: basic("alice", "wrong-1"), "X-Device-Key": STRANGER })).json();
  assert.equal(waiting.status, "pending");
  assert.equal(waiting.passwordOnly, true);
  // The same stale password while polling counts once; new guesses each count.
  await get("/api/pair/status", { Authorization: basic("alice", "wrong-1"), "X-Device-Key": STRANGER });
  for (let i = 2; i <= MAX_FAILURES; i++) await get("/api/pair/status", { Authorization: basic("alice", `wrong-${i}`), "X-Device-Key": STRANGER });
  assert.equal((await get("/api/shop/sections")).status, 429, "the address is locked out");
  const locked = await get("/api/pair/status", { Authorization: ALICE, "X-Device-Key": STRANGER });
  assert.equal(locked.status, 429, "a locked-out address is not approved even with the right password");
});
