import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

// Every refusal names its reason in X-CookingFoil-Auth, so a console can route
// a 401. X-CookingFoil-Server-Id goes only to a caller holding a credential
// this server made (let in, or refused for a session or download that was
// ours): handed to anyone, it would tie the tunnel to the home address.
// Runs against a real server process.
const PORT = 19700 + (process.pid % 200);
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = path.join(import.meta.dirname, "../..");
const KEY = "D4".repeat(32);
const OTHER = "E5".repeat(32);
const APPROVED = "A1".repeat(32);
const STRANGER = "F6".repeat(32);
const DIRECT_HOST = "direct.example.com";
const EDGE = "edge-secret-for-tests";
const SECRET_KEY = process.env.COOK_SECRET_KEY || "dGVzdC1rZXktbm90LWEtc2VjcmV0LTAxMjM0NTY3ODk=";
const data = fs.mkdtempSync(path.join(os.tmpdir(), "cf-auth-reason-"));
const env = {
  ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: data, COOK_GAMES_DIR: path.join(data, "games"),
  COOK_SECRET_KEY: SECRET_KEY, COOK_STORAGE_DIR: "", COOK_AUTH_USERS: "alice:alice-password", COOK_DEVICE_PAIRING: "true",
  COOK_DEVICE_AUTO_APPROVE: "false", COOK_TITLEDB_AUTO_FETCH: "false", COOK_LOCKOUT_TRUST_LOOPBACK: "false",
  COOK_PUBLIC_DIRECT_BASE_URL: `https://${DIRECT_HOST}`, COOK_DIRECT_EDGE_SECRET: EDGE,
};

// Made before the server starts, in the same data folder: a session that ended
// a day ago, a download token that was already spent, and an approved console.
const SEED = `
  const session = await import("./src/security/session-token.js");
  const enroll = await import("./src/security/enroll-tokens.js");
  const store = await import("./src/security/store.js");
  const pairing = await import("./src/security/pairing.js");
  const day = 24 * 3600 * 1000;
  const expired = session.issue({ dev: "${KEY}", paired: true }, Date.now() - day, 60).token;
  const { token } = enroll.issue("alice");
  enroll.spend(token, "${OTHER}");
  await store.load();
  const accessKey = pairing.generateAccessKey();
  store.approveDevice("${APPROVED}", { label: "test", addedBy: "admin", accessKeyHash: pairing.hashAccessKey(accessKey) });
  await store.shutdown();
  console.log(JSON.stringify({ expired, used: token, accessKey }));
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
const ID = "x-cookingfoil-server-id";

test("an approved console's 200 carries the server id and no refusal reason", async () => {
  const r = await ask("GET", "/api/shop/sections", { "X-Device-Key": APPROVED, "X-Access-Key": seeded.accessKey });
  assert.equal(r.status, 200);
  assert.match(r.header(ID) ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-/);
  assert.equal(r.header(ID), serverId());
  assert.equal(r.header("x-cookingfoil-auth"), null);
});

test("/healthz answers without the server id", async () => {
  const r = await ask("GET", "/healthz");
  assert.equal(r.status, 200);
  assert.equal(r.header(ID), null);
});

test("/healthz through the direct address's proxy is a 404 without the server id", async () => {
  const r = await ask("GET", "/healthz", { Host: DIRECT_HOST });
  assert.equal(r.status, 404);
  assert.equal(r.header(ID), null);
});

test("a made-up download token on the direct address is refused without the server id", async () => {
  const r = await ask("GET", "/game.nsp", { Host: DIRECT_HOST, "X-CookingFoil-Edge": EDGE, "X-Forwarded-For": "203.0.113.5", Authorization: "Bearer not-a-token" });
  assert.equal(r.status, 401);
  assert.equal(r.header("x-cookingfoil-token"), "invalid");
  assert.equal(r.header(ID), null);
});

test("a device key without an access key is a 401 that says no-access-key, without the server id", async () => {
  const r = await ask("GET", "/api/shop/sections", { "X-Device-Key": KEY });
  assert.equal(r.status, 401);
  assert.equal(r.header("x-cookingfoil-auth"), "no-access-key");
  assert.equal(r.header(ID), null);
});

test("nothing at all says no-credentials, without the server id", async () => {
  const r = await ask("GET", "/api/shop/sections");
  assert.equal(r.status, 401);
  assert.equal(r.header("x-cookingfoil-auth"), "no-credentials");
  assert.equal(r.header(ID), null);
});

test("an approved console with a wrong access key says access-key-wrong, with the server id", async () => {
  const r = await ask("GET", "/api/shop/sections", { "X-Device-Key": APPROVED, "X-Access-Key": "0".repeat(64) });
  assert.equal(r.status, 401);
  assert.equal(r.header("x-cookingfoil-auth"), "access-key-wrong");
  assert.equal(r.header(ID), serverId());
});

test("a console the server never approved says device-not-approved, without the server id", async () => {
  const r = await ask("GET", "/api/shop/sections", { "X-Device-Key": STRANGER, "X-Access-Key": "0".repeat(64) });
  assert.equal(r.status, 401);
  assert.equal(r.header("x-cookingfoil-auth"), "device-not-approved");
  assert.equal(r.header(ID), null);
});

test("a session token that is not ours says session-invalid, without the server id", async () => {
  const r = await ask("GET", "/api/shop/sections", { "X-Device-Key": KEY, Authorization: `Bearer ${seeded.expired.slice(0, -4)}AAAA` });
  assert.equal(r.status, 401);
  assert.equal(r.header("x-cookingfoil-auth"), "session-invalid");
  assert.equal(r.header(ID), null);
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

test("a rejected token says api-token-invalid, without the server id", async () => {
  const r = await ask("GET", "/shop.json", { Authorization: "Bearer cft_not-a-real-token" });
  assert.equal(r.status, 401);
  assert.equal(r.header("x-cookingfoil-auth"), "api-token-invalid");
  assert.equal(r.header(ID), null);
});

test("an enroll with a made-up download token says enroll-invalid, without the server id", async () => {
  const r = await ask("POST", "/api/pair/enroll", { "Content-Type": "application/json", "X-Device-Key": KEY }, JSON.stringify({ token: "not-a-download" }));
  assert.equal(r.status, 401);
  assert.equal(r.header("x-cookingfoil-auth"), "enroll-invalid");
  assert.equal(r.header(ID), null);
});
