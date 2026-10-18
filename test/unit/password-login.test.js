import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ID and password sign-in switched off: accounts' own passwords are taken nowhere,
// neither on the sign-in page nor once at pairing, and the page offers Google alone.
const data = fs.mkdtempSync(path.join(os.tmpdir(), "cf-pwlogin-"));
fs.mkdirSync(path.join(data, "games"));
fs.mkdirSync(path.join(data, "security"));
process.env.COOK_DATA_DIR = data;
process.env.COOK_AUTH_USERS = "alice:alice-password";
const users = await import("../../src/security/users.js");
const session = await import("../../src/security/user-session.js");
await users.load?.();
const { seedRecords } = await import("../support/security-db.js");

const PORT = 18900 + (process.pid % 90);
const BASE = `http://127.0.0.1:${PORT}`;
const basic = (u, p) => "Basic " + Buffer.from(`${u}:${p}`).toString("base64");
let nextKey = 0;
/** What a fresh console gets from /api/pair/status when it sends alice's ID and password. */
const pairWithPassword = async () => {
  const key = (++nextKey).toString(16).toUpperCase().padStart(2, "0").repeat(32);
  return (await fetch(`${BASE}/api/pair/status`, { headers: { "X-Device-Key": key, Authorization: basic("alice", "alice-password") } })).json();
};
const children = [];
after(() => { for (const c of children) c.kill("SIGKILL"); });

async function boot(extra) {
  const child = spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: { ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: data, COOK_GAMES_DIR: path.join(data, "games"),
      COOK_AUTH_USERS: "alice:alice-password", COOK_ADMIN_PASSWORD: "admin-password-123", COOK_TITLEDB_AUTO_FETCH: "false",
      COOK_LOCKOUT_TRUST_LOOPBACK: "false", COOK_AUTH_MAX_FAILURES: "50",
      COOK_GOOGLE_CLIENT_ID: "test-client.apps.googleusercontent.com", COOK_GOOGLE_CLIENT_SECRET: "GOCSPX-test-secret-value", ...extra },
    stdio: "ignore",
  });
  children.push(child);
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) return child;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not start");
}

async function stop(child) {
  const gone = new Promise((r) => child.once("exit", r));
  child.kill("SIGKILL");
  await gone;
}

function request(method, p, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${BASE}${p}`, { method, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

test("with ID and password sign-in off but no Google admin yet, passwords keep working (nobody is locked out)", async () => {
  const server = await boot({ COOK_PASSWORD_LOGIN: "false" });
  try {
    const page = await request("GET", "/login", { Accept: "text/html" });
    assert.match(page.body, /name="password"/, "the password form stays");
    assert.equal((await pairWithPassword()).status, "approved", "a password at pairing still approves");
  } finally {
    await stop(server);
  }
});

test("with ID and password sign-in off, a password approves nothing and signs nobody in", async () => {
  const now = Date.now();
  await seedRecords(data, "google-account", { g1: { sub: "g1", email: "owner@example.com", status: "approved", role: "admin", createdAt: now, approvedAt: now, lastAt: now } });
  const server = await boot({ COOK_PASSWORD_LOGIN: "false" });
  try {
    const page = await request("GET", "/login", { Accept: "text/html" });
    assert.equal(page.status, 200);
    assert.doesNotMatch(page.body, /name="password"/, "no password field");
    assert.match(page.body, /auth\/google\/start/, "the Google button");

    const posted = await request("POST", "/login", { "Content-Type": "application/x-www-form-urlencoded", Cookie: `${session.CSRF_COOKIE}=${"a".repeat(43)}` },
      `username=alice&password=alice-password&csrf=${"a".repeat(43)}&next=%2F`);
    assert.equal(posted.status, 403);
    assert.doesNotMatch(posted.headers["set-cookie"]?.join(";") ?? "", new RegExp(`${session.SESSION_COOKIE}=[^;]+`), "no session cookie");

    assert.equal((await pairWithPassword()).status, "pending", "a password at pairing approves nothing");

    // A browser still holding a password session is signed out.
    const cookie = `${session.SESSION_COOKIE}=${session.seal({ user: "alice", s: users.sessionStamp("alice") }, 60_000)}`;
    const me = await request("GET", "/auth/me", { Cookie: cookie });
    assert.equal(me.status, 401);
  } finally {
    await stop(server);
  }
  // A Google outage: the compose switch brings passwords back whatever is saved.
  const forced = await boot({ COOK_PASSWORD_LOGIN: "false", COOK_PASSWORD_LOGIN_FORCE: "true" });
  try {
    assert.equal((await pairWithPassword()).status, "approved");
  } finally {
    await stop(forced);
  }
});
