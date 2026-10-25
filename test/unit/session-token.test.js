import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// A console trades its pairing's access key for a session token at GET
// /api/session and sends only that afterwards.
const dir = mkdtempSync(path.join(tmpdir(), "cook-session-unit-"));
process.env.COOK_DATA_DIR = dir;
const session = await import("../../src/security/session-token.js");
const download = await import("../../src/security/download-token.js");

const CONSOLE = "A7".repeat(32);
const OTHER = "B8".repeat(32);
const WHO = { acct: { kind: "user", id: "alice" }, dev: CONSOLE, agent: null, paired: true, stamp: "s1", dstamp: "d1" };

test("a session token is signed, ends by itself, and is never a download token", () => {
  const now = Date.UTC(2026, 9, 15);
  const { token, expiresAt } = session.issue(WHO, now);
  assert.match(token, /^cfs_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(expiresAt, now + session.SESSION_TTL_SEC * 1000);
  const ok = session.verify(token, now + 1000);
  assert.equal(ok.verdict, "ok");
  assert.deepEqual(ok.sub, { acct: { kind: "user", id: "alice" }, dev: CONSOLE, paired: true, stamp: "s1", dstamp: "d1" });
  assert.equal(session.verify(token, expiresAt).verdict, "expired");

  const [body, mac] = token.slice(4).split(".");
  const forged = Buffer.from(JSON.parse(Buffer.from(body, "base64url")) && JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url")), sub: { ...WHO, acct: { kind: "user", id: "admin" } } })).toString("base64url");
  assert.notEqual(session.verify(`cfs_${forged}.${mac}`, now).verdict, "ok", "another account under the same MAC");
  assert.equal(session.verify("cfs_x.y", now).verdict, "invalid");

  const dl = download.issue(WHO, now);
  assert.equal(session.verify(dl, now).verdict, "invalid", "a download token is no session");
  assert.equal(session.verify(`cfs_${dl}`, now).verdict, "invalid", "nor with the prefix put in front: its MAC is not a session's");
  assert.notEqual(download.verify(token, now).verdict, "ok", "a session never opens the direct address");
  assert.notEqual(download.verify(token.slice(4), now).verdict, "ok");

  assert.equal(session.eligible(WHO), true);
  assert.equal(session.eligible({ ...WHO, dev: null }), false, "a browser gets none");
  assert.equal(session.eligible({ ...WHO, acct: { kind: "google", id: "x" } }), false);
  assert.equal(session.eligible({ ...WHO, acct: null, paired: false }), false);
  assert.equal(session.presented(`Bearer ${token}`), token);
  assert.equal(session.presented("Bearer cft_0123abcd_x"), null, "admin API tokens are not sessions");
  assert.equal(session.presented("Basic abc"), null);
});

const PORT = 18900 + (process.pid % 400);
const BASE = `http://127.0.0.1:${PORT}`;
const basic = (name, password) => "Basic " + Buffer.from(`${name}:${password}`).toString("base64");
const ALICE = basic("alice", "alice-password");

async function boot() {
  const data = mkdtempSync(path.join(tmpdir(), "cook-session-"));
  const games = path.join(data, "games");
  mkdirSync(games, { recursive: true });
  const child = spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: {
      ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: data, COOK_GAMES_DIR: games,
      COOK_AUTH_USERS: "alice:alice-password", COOK_DEVICE_PAIRING: "true",
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

const get = (url, headers) => fetch(BASE + url, { headers });
const bearer = (t) => `Bearer ${t}`;

test("a console pairs once and then sends only its session", async () => {
  const server = await boot();
  try {
    const paired = await (await get("/api/pair/status", { Authorization: ALICE, "X-Device-Key": CONSOLE })).json();
    const keys = { "X-Device-Key": CONSOLE, "X-Access-Key": paired.accessKey };
    const features = (await (await get("/api/library/info", keys)).json()).features;
    assert.ok(features.includes("session-token"));
    assert.ok(features.includes("pair-password-only"));
    assert.equal((await get("/api/session", { Authorization: ALICE })).status, 401, "a password alone makes no session");
    const r = await get("/api/session", keys);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("cache-control"), "no-store");
    const { token, expiresAt } = await r.json();
    assert.ok(expiresAt > Date.now());

    assert.equal((await get("/api/library/sections", { Authorization: bearer(token), "X-Device-Key": CONSOLE })).status, 200);
    let refused = await get("/api/library/sections", { Authorization: bearer(token), "X-Device-Key": OTHER });
    assert.equal(refused.status, 401, "only from the console it was made for");
    assert.equal(refused.headers.get("x-cookingfoil-session"), "invalid");
    assert.equal(refused.headers.get("www-authenticate"), null, "no Basic challenge");
    assert.equal((await get("/api/library/sections", { Authorization: bearer(token) })).status, 401);
    refused = await get("/api/library/sections", { Authorization: bearer(token.slice(0, -2) + "AA"), "X-Device-Key": CONSOLE });
    assert.equal(refused.status, 401);
    assert.equal((await get("/api/session", { Authorization: bearer(token), "X-Device-Key": CONSOLE })).status, 403, "a session never makes another");

    // An address locked out for wrong passwords at pairing stays out, session or not.
    for (let i = 0; i < 6; i++) await get("/api/pair/status", { Authorization: basic("alice", `wrong-${i}`), "X-Device-Key": OTHER });
    assert.equal((await get("/api/library/sections", { Authorization: bearer(token), "X-Device-Key": CONSOLE })).status, 429);
  } finally {
    server.kill("SIGKILL");
  }
});
