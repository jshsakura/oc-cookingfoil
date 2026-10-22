import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

// Every refusal names its reason in X-CookingFoil-Auth, and every response
// carries X-CookingFoil-Server-Id, so a console can route a 401 and tell two
// addresses of one server apart. Runs against a real server process.
const PORT = 19700 + (process.pid % 200);
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = path.join(import.meta.dirname, "../..");
const KEY = "D4".repeat(32);
const OTHER = "E5".repeat(32);
const SECRET_KEY = process.env.COOK_SECRET_KEY || "dGVzdC1rZXktbm90LWEtc2VjcmV0LTAxMjM0NTY3ODk=";
const data = fs.mkdtempSync(path.join(os.tmpdir(), "cf-auth-reason-"));
const env = {
  ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: data, COOK_GAMES_DIR: path.join(data, "games"),
  COOK_SECRET_KEY: SECRET_KEY, COOK_STORAGE_DIR: "", COOK_AUTH_USERS: "alice:alice-password", COOK_DEVICE_PAIRING: "true",
  COOK_DEVICE_AUTO_APPROVE: "false", COOK_TITLEDB_AUTO_FETCH: "false", COOK_LOCKOUT_TRUST_LOOPBACK: "false",
};

// Made before the server starts, in the same data folder: a session that ended
// a day ago, and a download token that was already spent.
const SEED = `
  const session = await import("./src/security/session-token.js");
  const enroll = await import("./src/security/enroll-tokens.js");
  const day = 24 * 3600 * 1000;
  const expired = session.issue({ dev: "${KEY}", paired: true }, Date.now() - day, 60).token;
  const { token } = enroll.issue("alice");
  enroll.spend(token, "${OTHER}");
  console.log(JSON.stringify({ expired, used: token }));
`;

let child;
let seeded;
before(async () => {
  fs.mkdirSync(path.join(data, "games"), { recursive: true });
  seeded = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", SEED], { cwd: ROOT, env }).toString().trim().split("\n").pop());
  child = spawn(process.execPath, ["./src/index.js"], { cwd: ROOT, env, stdio: "ignore" });
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

// A console sends no Sec-Fetch-* headers, which fetch() always adds, so it is
// asked with plain http to get the console's 401 and not a browser's.
function ask(method, url, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const r = http.request(BASE + url, { method, headers }, (res) => {
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode, header: (n) => res.headers[n.toLowerCase()] ?? null }));
    });
    r.on("error", reject);
    r.end(body);
  });
}

const serverId = () => fs.readFileSync(path.join(data, "server-id"), "utf8").trim();

test("a normal 200 carries the server id", async () => {
  const r = await ask("GET", "/healthz");
  assert.equal(r.status, 200);
  assert.match(r.header("x-cookingfoil-server-id") ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-/);
  assert.equal(r.header("x-cookingfoil-server-id"), serverId());
});

test("a device key without an access key is a 401 that says no-access-key, with the server id", async () => {
  const r = await ask("GET", "/api/shop/sections", { "X-Device-Key": KEY });
  assert.equal(r.status, 401);
  assert.equal(r.header("x-cookingfoil-auth"), "no-access-key");
  assert.equal(r.header("x-cookingfoil-server-id"), serverId());
});

test("nothing at all says no-credentials", async () => {
  const r = await ask("GET", "/api/shop/sections");
  assert.equal(r.status, 401);
  assert.equal(r.header("x-cookingfoil-auth"), "no-credentials");
});

test("an expired session says session-expired and keeps the session header", async () => {
  const r = await ask("GET", "/api/shop/sections", { "X-Device-Key": KEY, Authorization: `Bearer ${seeded.expired}` });
  assert.equal(r.status, 401);
  assert.equal(r.header("x-cookingfoil-auth"), "session-expired");
  assert.equal(r.header("x-cookingfoil-session"), "expired");
  assert.equal(r.header("x-cookingfoil-server-id"), serverId());
});

test("an enroll with a spent download says enroll-used and keeps the enroll header", async () => {
  const r = await ask("POST", "/api/pair/enroll", { "Content-Type": "application/json", "X-Device-Key": KEY }, JSON.stringify({ token: seeded.used }));
  assert.equal(r.status, 401);
  assert.equal(r.header("x-cookingfoil-auth"), "enroll-used");
  assert.equal(r.header("x-cookingfoil-enroll"), "used");
  assert.equal(r.header("x-cookingfoil-server-id"), serverId());
});

test("a rejected token says api-token-invalid", async () => {
  const r = await ask("GET", "/shop.json", { Authorization: "Bearer cft_not-a-real-token" });
  assert.equal(r.status, 401);
  assert.equal(r.header("x-cookingfoil-auth"), "api-token-invalid");
});
