import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// tokenReach() decides whether a capability is offered to automation tokens. It must agree with
// what the server does to a real request made with a real token, including routes whose pattern
// looks open (/content/:kind/move) while some values of the parameter are blocked (patch), and
// reads that a token may not make (the token list, the admin login's second step).
const data = fs.mkdtempSync(path.join(os.tmpdir(), "cook-token-reach-"));
fs.mkdirSync(path.join(data, "games"));
process.env.COOK_DATA_DIR = data;
const { tokenReach } = await import("../../src/capabilities/define.js");
const { adminSession } = await import("../support/web-session.js");

const PORT = 25300 + (process.pid % 500);
const BASE = `http://127.0.0.1:${PORT}`;
let child;
let token;

before(async () => {
  child = spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    stdio: "ignore",
    env: { ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: data, COOK_GAMES_DIR: path.join(data, "games"),
      COOK_AUTH_USERS: "alice:alice-password", COOK_ADMIN_PASSWORD: "admin-password-123", COOK_TITLEDB_AUTO_FETCH: "false",
      COOK_HOMEBREW_REPOS: "", COOK_RETRO_META: "false", COOK_UPLOADS_ENABLED: "true" },
  });
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) break;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const admin = { ...(await adminSession(BASE, "alice", "alice-password", "admin-password-123")), "Content-Type": "application/json" };
  const made = await (await fetch(`${BASE}/admin/api/tokens`, { method: "POST", headers: admin, body: JSON.stringify({ label: "reach" }) })).json();
  token = made.token;
  assert.ok(token, "the admin page made a token");
});

after(() => {
  child?.kill("SIGKILL");
  fs.rmSync(data, { recursive: true, force: true });
});

/** Whether the server refuses this request because it was made with a token. */
async function refusedForToken(method, url) {
  const res = await fetch(BASE + url, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: method === "GET" ? undefined : "{}",
  });
  return res.status === 401 || res.status === 403;
}

// [method, route pattern, a concrete path the token is refused on, a concrete path it gets through to]
const CASES = [
  ["POST", "/admin/api/content/:kind/move", "/admin/api/content/patch/move", "/admin/api/content/homebrew/move"],
  ["POST", "/admin/api/content/:kind/remove", "/admin/api/content/patch/remove", "/admin/api/content/homebrew/remove"],
  ["POST", "/admin/api/integrations/:service", "/admin/api/integrations/telegram", "/admin/api/integrations/github"],
  ["POST", "/admin/api/integrations/:service/clear", "/admin/api/integrations/telegram/clear", null],
  ["POST", "/admin/api/integrations/:service/test", "/admin/api/integrations/telegram/test", null],
  ["POST", "/admin/api/upload/:kind", "/admin/api/upload/client", null],
  ["GET", "/admin/api/tokens", "/admin/api/tokens", null],
  ["GET", "/admin/api/2fa", "/admin/api/2fa", null],
];

for (const [method, pattern, blocked, open] of CASES) {
  test(`${method} ${pattern} is closed to tokens, as the server says`, async () => {
    assert.equal(await refusedForToken(method, blocked), true, `the server refuses ${method} ${blocked}`);
    assert.equal(tokenReach({ method, path: blocked }), false, `tokenReach(${blocked})`);
    assert.equal(tokenReach({ method, path: pattern }), false, `tokenReach(${pattern}): one value of it is blocked`);
    if (!open) return;
    assert.equal(await refusedForToken(method, open), false, `the server lets ${method} ${open} through`);
    assert.equal(tokenReach({ method, path: open }), true, `tokenReach(${open})`);
  });
}

test("open routes stay open and the shop list is for tokens only", async () => {
  for (const [method, url, reach] of [["GET", "/admin/api/stats", true], ["GET", "/games.json", true], ["GET", "/api/library/info", false]]) {
    assert.equal(await refusedForToken(method, url), !reach, `${method} ${url}`);
    assert.equal(tokenReach({ method, path: url }), reach, `tokenReach(${url})`);
  }
});

test("an input enum that leaves out every blocked value opens the route; one that keeps one does not", () => {
  const http = { method: "POST", path: "/admin/api/content/:kind/move" };
  const kind = (values) => ({ type: "object", properties: { kind: { type: "string", enum: values } } });
  assert.equal(tokenReach(http, kind(["homebrew", "save"])), true);
  assert.equal(tokenReach(http, kind(["homebrew", "patch"])), false);
  assert.equal(tokenReach(http, kind(["homebrew", "PATCH"])), false, "the server matches case-insensitively");
  assert.equal(tokenReach(http, { type: "object", properties: { kind: { type: "string" } } }), false, "no enum means any value");
});

test("a route that enumerates its own parameter values is judged on those values", () => {
  assert.equal(tokenReach({ method: "POST", path: "/admin/api/content/:kind(homebrew|save)/move" }), true);
  assert.equal(tokenReach({ method: "POST", path: "/admin/api/content/:kind(homebrew|patch)/move" }), false);
});
