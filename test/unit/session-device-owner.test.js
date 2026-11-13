import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { webSession } from "../support/web-session.js";

// A console's device key travels in the clear on every request, so it names a console without proving
// anything. Signed in on the web, an account gets a session on a console only when it holds that console:
// another account's console key earns nothing, and the console's own account keeps its session.
const PORT = 19600 + (process.pid % 300);
const BASE = `http://127.0.0.1:${PORT}`;
const basic = (user, pass) => "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
const ALICE_CONSOLE = "A1".repeat(32);

const data = fs.mkdtempSync(path.join(os.tmpdir(), "cf-session-owner-"));
let child;
before(async () => {
  fs.mkdirSync(path.join(data, "games"), { recursive: true });
  child = spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: { ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: data, COOK_GAMES_DIR: path.join(data, "games"),
      COOK_AUTH_USERS: "alice:alice-password,bob:bob-password", COOK_DEVICE_PAIRING: "true", COOK_DEVICE_AUTO_APPROVE: "true",
      COOK_TITLEDB_AUTO_FETCH: "false", COOK_LOCKOUT_TRUST_LOOPBACK: "false" },
    stdio: "ignore",
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not start");
});
after(() => {
  child?.kill("SIGKILL");
  fs.rmSync(data, { recursive: true, force: true });
});

const get = (url, headers) => fetch(BASE + url, { headers });

test("another account's web sign-in with alice's console key gets no session and no console of hers", async () => {
  const paired = await (await get("/api/pair/status", { Authorization: basic("alice", "alice-password"), "X-Device-Key": ALICE_CONSOLE })).json();
  assert.equal(paired.status, "approved");
  const bob = { ...(await webSession(BASE, "bob", "bob-password")), "X-Device-Key": ALICE_CONSOLE };

  assert.equal((await get("/api/session", bob)).status, 403);
  assert.equal((await get("/api/device/wishlist", bob)).status, 403);
  assert.equal((await get("/api/device/sends", bob)).status, 403);
  const ack = await fetch(`${BASE}/api/device/sends/ack`, { method: "POST", headers: { ...bob, "Content-Type": "application/json" }, body: JSON.stringify({ ids: [], result: "declined" }) });
  assert.equal(ack.status, 403);
});

test("the console's own account still gets its session there, and the session works", async () => {
  const alice = { ...(await webSession(BASE, "alice", "alice-password")), "X-Device-Key": ALICE_CONSOLE };
  const r = await get("/api/session", alice);
  assert.equal(r.status, 200);
  const { token } = await r.json();
  const lane = { "X-Device-Key": ALICE_CONSOLE, Authorization: `Bearer ${token}` };
  assert.equal((await get("/api/device/wishlist", lane)).status, 200);
  assert.equal((await get("/api/device/sends", lane)).status, 200);
});
