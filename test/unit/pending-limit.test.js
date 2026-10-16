import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Anyone can knock with a fresh device key before sign-in. New consoles are let
// into the approval queue a few at a time per address, and past an hourly cap
// for everyone they wait without an alert.
process.env.COOK_DATA_DIR = mkdtempSync(path.join(tmpdir(), "cook-pending-limit-"));
const { createPendingLimit, PER_IP_MAX, PER_IP_WINDOW_MS } = await import("../../src/security/pending-limit.js");

test("an address adds a few new consoles per window, then is told when to come back", () => {
  const waiting = new Set();
  const limit = createPendingLimit({ isPending: (k) => waiting.has(k) });
  const t0 = 1_000_000;
  for (let i = 0; i < PER_IP_MAX; i++) {
    assert.deepEqual(limit.admit("203.0.113.5", `K${i}`, t0 + i), { ok: true, quiet: false });
    waiting.add(`K${i}`);
  }
  const refused = limit.admit("203.0.113.5", "NEW", t0 + 1000);
  assert.equal(refused.ok, false);
  assert.equal(refused.retryAfterSec, Math.ceil((PER_IP_WINDOW_MS - 1000) / 1000));
  assert.equal(limit.admit("203.0.113.5", "K0", t0 + 1000).ok, true, "a console already waiting keeps polling");
  assert.equal(limit.admit("198.51.100.7", "OTHER", t0 + 1000).ok, true, "other addresses are not held back");
  assert.equal(limit.admit("203.0.113.5", "NEW", t0 + PER_IP_WINDOW_MS + 1).ok, true, "the window passes");
});

test("past the cap for everyone, a new console still waits but raises no alert", () => {
  const limit = createPendingLimit({ isPending: () => false, perIpMax: 100, globalMax: 3 });
  const t0 = 2_000_000;
  const quiet = [0, 1, 2, 3, 4].map((i) => limit.admit(`10.0.0.${i}`, `K${i}`, t0 + i).quiet);
  assert.deepEqual(quiet, [false, false, false, true, true]);
});

test("the table of addresses stays bounded", () => {
  const limit = createPendingLimit({ isPending: () => false, maxAddresses: 50, globalMax: 1e9 });
  for (let i = 0; i < 500; i++) limit.admit(`ip-${i}`, `K${i}`, 3_000_000 + i);
  assert.ok(limit.size() <= 50);
});

test("POST /api/pair/request answers 429 with Retry-After once an address asks for too many new consoles", async () => {
  const data = mkdtempSync(path.join(tmpdir(), "cook-pending-server-"));
  const games = path.join(data, "games");
  mkdirSync(games, { recursive: true });
  const port = 18900 + (process.pid % 400);
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: {
      ...process.env, COOK_PORT: String(port), COOK_DATA_DIR: data, COOK_GAMES_DIR: games, COOK_AUTH_USERS: "",
      COOK_DEVICE_PAIRING: "true", COOK_TITLEDB_AUTO_FETCH: "false", COOK_LOCKOUT_TRUST_LOOPBACK: "false",
    },
    stdio: "ignore",
  });
  try {
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(`${base}/healthz`)).ok) break;
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    const knock = (key) => fetch(`${base}/api/pair/request`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceKey: key, message: "flood" }) });
    const keys = Array.from({ length: PER_IP_MAX + 1 }, (_, i) => String(i + 1).padStart(2, "0").repeat(32));
    for (const key of keys.slice(0, PER_IP_MAX)) assert.equal((await knock(key)).status, 200);
    const refused = await knock(keys[PER_IP_MAX]);
    assert.equal(refused.status, 429);
    assert.ok(Number(refused.headers.get("retry-after")) > 0);
    // Polling for a new key is refused the same way; a console already waiting still polls.
    assert.equal((await fetch(`${base}/api/pair/status`, { headers: { "X-Device-Key": keys[PER_IP_MAX] } })).status, 429);
    const waiting = await fetch(`${base}/api/pair/status`, { headers: { "X-Device-Key": keys[0] } });
    assert.equal(waiting.status, 200);
    assert.equal((await waiting.json()).status, "pending");
  } finally {
    child.kill("SIGKILL");
  }
});
