import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 18900 + (process.pid % 500);
const BASE = `http://127.0.0.1:${PORT}`;
const basic = (u, p) => "Basic " + Buffer.from(`${u}:${p}`).toString("base64");
const ALICE = basic("alice", "alice-password");
const KEY = "AB".repeat(32);

async function boot() {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "cf-adminconsole-"));
  fs.mkdirSync(path.join(data, "games"));
  const child = spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: { ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: data, COOK_GAMES_DIR: path.join(data, "games"),
      COOK_AUTH_USERS: "alice:alice-password", COOK_ADMIN_PASSWORD: "admin-password-123", COOK_DEVICE_PAIRING: "true",
      COOK_TITLEDB_AUTO_FETCH: "false" },
    stdio: "ignore",
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) return { child, data };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill("SIGKILL");
  throw new Error("server did not start");
}

function page(p, headers) {
  return new Promise((resolve, reject) => {
    http.get(`${BASE}${p}`, { headers: { Accept: "text/html", "Sec-Fetch-Mode": "navigate", ...headers } }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
  });
}

test("admin accounts run the admin page; nobody locks themselves out; console logs can be read", async () => {
  const { child } = await boot();
  try {
    const verify = await fetch(`${BASE}/admin/verify`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: ALICE }, body: JSON.stringify({ password: "admin-password-123" }) });
    const A = { Authorization: ALICE, Cookie: verify.headers.get("set-cookie").split(";")[0], "Content-Type": "application/json" };
    const call = (method, p, body) => fetch(`${BASE}${p}`, { method, headers: A, body: body === undefined ? undefined : JSON.stringify(body) });

    const bob = await (await call("POST", "/admin/api/users", { name: "bob", password: "bob-password-1" })).json();
    assert.equal(bob.role, "user");
    // A regular account can sign in but not open /admin.
    assert.equal((await fetch(`${BASE}/admin/api/stats`, { headers: { Authorization: basic("bob", "bob-password-1") } })).status, 403);
    const denied = await page("/admin", { Authorization: basic("bob", "bob-password-1") });
    assert.equal(denied.status, 403);
    assert.match(denied.body, /관리자 계정이 아닙니다/);
    assert.equal((await page("/admin", { Authorization: ALICE })).status, 200);

    const stats = await (await call("GET", "/admin/api/stats")).json();
    assert.deepEqual(stats.me, { kind: "password", name: "alice" });
    assert.deepEqual(stats.users.filter((u) => u.configured).map((u) => [u.user, u.role]), [["alice", "admin"], ["bob", "user"]]);

    // Never yourself: disable, demote, delete.
    for (const [method, p, body] of [["POST", "/admin/api/users/alice/enabled", { enabled: false }], ["POST", "/admin/api/users/alice/role", { role: "user" }], ["DELETE", "/admin/api/users/alice"]]) {
      const r = await call(method, p, body);
      assert.equal(r.status, 409, p);
      assert.equal((await r.json()).error, "self");
    }
    assert.equal((await call("POST", "/admin/api/users/bob/role", { role: "admin" })).status, 200);
    assert.equal((await fetch(`${BASE}/admin/api/stats`, { headers: { Authorization: basic("bob", "bob-password-1") } })).status, 401, "promoted: past the role check, now the admin's own login is asked");
    assert.equal((await call("POST", "/admin/api/users/bob/role", { role: "user" })).status, 200);

    // An approved console: renamed, and its last connection shows.
    const pending = await (await fetch(`${BASE}/api/pair/status`, { headers: { "X-Device-Key": KEY } })).json();
    assert.equal((await call("POST", "/admin/api/devices/approve", { code: pending.pairCode, label: "거실" })).status, 200);
    const { accessKey } = await (await fetch(`${BASE}/api/pair/status`, { headers: { "X-Device-Key": KEY } })).json();
    let devices = await (await call("GET", "/admin/api/devices")).json();
    assert.equal(devices.approved[0].lastSeenAt, null);
    assert.equal((await fetch(`${BASE}/api/shop/sections`, { headers: { "X-Device-Key": KEY, "X-Access-Key": accessKey } })).status, 200);
    assert.equal((await call("POST", "/admin/api/devices/label", { deviceKey: KEY, label: "안방" })).status, 200);
    devices = await (await call("GET", "/admin/api/devices")).json();
    assert.equal(devices.approved[0].label, "안방");
    assert.ok(devices.approved[0].lastSeenAt > 0);
    assert.equal((await call("POST", "/admin/api/devices/label", { deviceKey: "CD".repeat(32), label: "x" })).status, 404);

    // The console's error log, read from the admin page.
    const sent = await fetch(`${BASE}/api/client/log`, { method: "POST", headers: { "X-Device-Key": KEY, "X-Access-Key": accessKey, "Content-Type": "text/plain", "X-Log-Reason": "crash" }, body: "boom at line 3\n" });
    assert.equal(sent.status, 204);
    const logs = await (await call("GET", "/admin/api/client-logs")).json();
    assert.equal(logs.consoles.length, 1);
    const [c] = logs.consoles;
    assert.deepEqual([c.prefix, c.label, c.files.length], [KEY.slice(0, 8).toLowerCase(), "안방", 1]);
    const text = await (await call("GET", `/admin/api/client-logs/${c.prefix}/${c.files[0].name}`)).text();
    assert.match(text, /reason crash/);
    assert.match(text, /boom at line 3/);
    assert.equal((await call("GET", `/admin/api/client-logs/${c.prefix}/..%2F..%2Fsecurity%2Fusers.json`)).status, 400);

    // Bug reports the player sent by hand are counted per console; a crash log is not.
    assert.deepEqual(logs.bugReports, []);
    for (const reason of ["bug report", "bug%20report"]) {
      const r = await fetch(`${BASE}/api/client/log`, { method: "POST", headers: { "X-Device-Key": KEY, "X-Access-Key": accessKey, "Content-Type": "text/plain", "X-Log-Reason": reason }, body: "it froze\n" });
      assert.equal(r.status, 204);
    }
    const ranked = (await (await call("GET", "/admin/api/client-logs")).json()).bugReports;
    assert.equal(ranked.length, 1);
    assert.deepEqual([ranked[0].prefix, ranked[0].label, ranked[0].count], [KEY.slice(0, 8).toLowerCase(), "안방", 2]);
    assert.ok(ranked[0].last >= ranked[0].first);
    assert.equal((await call("GET", `/admin/api/client-logs/${c.prefix}/latest.txt`)).status, 200);
    assert.equal((await fetch(`${BASE}/admin/api/client-logs`, { headers: { Authorization: ALICE } })).status, 401, "admin session only");

    // Homebrew the server follows: the recommended list, and refusals that never reach GitHub.
    const hb = await (await call("GET", "/admin/api/homebrew")).json();
    assert.ok(hb.recommended.length >= 15 && hb.recommended.every((r) => r.purpose.ko && r.purpose.en && r.added === false));
    assert.deepEqual([hb.sources, hb.manual], [[], []]);
    assert.equal((await call("POST", "/admin/api/homebrew", { repo: "https://gitlab.com/a/b" })).status, 400);
    assert.equal((await call("POST", "/admin/api/homebrew", { repo: "a/b", asset: "evil.exe" })).status, 400);
    assert.equal((await call("POST", "/admin/api/homebrew/remove", { repo: "nobody/here" })).status, 404);
    assert.equal((await call("POST", "/admin/api/homebrew/check", { repo: "nobody/here" })).status, 404);
    assert.equal((await fetch(`${BASE}/admin/api/homebrew`, { headers: { Authorization: ALICE } })).status, 401, "admin session only");
  } finally {
    child.kill("SIGKILL");
  }
});

test("the recommended homebrew never offers installers or other stores", async () => {
  const { RECOMMENDED } = await import("../../src/meta/homebrew-recommended.js");
  for (const r of RECOMMENDED) assert.doesNotMatch(r.repo, /goldleaf|dbi|hb-appstore/i, r.repo);
});
