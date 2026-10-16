import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { everything } from "../support/security-db.js";

// CyberFoil and Tinfoil can't scan a QR, so a signed-in user issues each
// console its own ID and password. The login reads the shop only, locks to the
// first console that uses it, and dies with its owner or on revoke.
const CONSOLE_A = "A9B2C3D4E5F60718293A4B5C6D7E8F90A1B2C3D4E5F60718293A4B5C6D7E8F90";
const CONSOLE_B = "B9B2C3D4E5F60718293A4B5C6D7E8F90A1B2C3D4E5F60718293A4B5C6D7E8F90";
const PORT = 14300 + (process.pid % 500);
const BASE = `http://127.0.0.1:${PORT}`;
const basic = (name, password) => "Basic " + Buffer.from(`${name}:${password}`).toString("base64");
const ALICE = basic("alice", "alice-password");
const BOB = basic("bob", "bob-password-1");

function bootServer(data) {
  const games = path.join(data, "games");
  mkdirSync(games, { recursive: true });
  return spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: {
      ...process.env, COOK_CONSOLE_PASSWORDS: "true",
      COOK_PORT: String(PORT),
      COOK_DATA_DIR: data,
      COOK_GAMES_DIR: games,
      COOK_AUTH_USERS: "alice:alice-password,bob:bob-password-1",
      COOK_DEVICE_PAIRING: "true",
      COOK_ADMIN_PASSWORD: "admin-password-123",
      COOK_TITLEDB_AUTO_FETCH: "false",
      COOK_LOCKOUT_TRUST_LOOPBACK: "false",
    },
    stdio: "ignore",
  });
}

async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((res) => setTimeout(res, 250));
  }
  throw new Error("server did not become ready");
}

const asUser = (auth, url, body) =>
  fetch(BASE + url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: auth, Origin: BASE },
    body: JSON.stringify(body ?? {}),
  });
const fromConsole = (login, deviceKey, url = "/api/shop/sections", init = {}) =>
  fetch(BASE + url, {
    ...init,
    headers: { Authorization: basic(login.name, login.password), ...(deviceKey ? { UID: deviceKey } : {}), ...init.headers },
  });

test("a per-device login reads the shop from its own console only", async () => {
  const data = mkdtempSync(path.join(tmpdir(), "cook-devlogin-"));
  const server = bootServer(data);
  try {
    await waitReady();
    assert.ok((await (await fetch(`${BASE}/api/shop/info`, { headers: { Authorization: ALICE } })).json()).features.includes("device-logins"));
    assert.equal((await asUser(ALICE, "/pair/api/logins", { label: "x" }).then((r) => r.status)), 200);
    const cross = await fetch(`${BASE}/pair/api/logins`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: ALICE, Origin: "https://evil.example" }, body: "{}",
    });
    assert.equal(cross.status, 403, "another site can't issue logins with the browser's credentials");

    let r = await asUser(ALICE, "/pair/api/logins", { label: "Living room" });
    const login = await r.json();
    assert.match(login.name, /^cf-[a-z2-9]{6}$/);
    assert.match(login.password, /^[a-z2-9]{12}$/);
    assert.equal(login.shopUrl, `${BASE}/`);
    const stored = everything(data);
    assert.ok(!stored.includes(login.password), "only the hash is kept");

    // First console locks it; another console is refused; no ID is let through.
    assert.equal((await fromConsole(login, CONSOLE_A)).status, 200);
    assert.equal((await fromConsole(login, CONSOLE_A, "/shop.tfl")).status, 200);
    r = await fromConsole(login, CONSOLE_B);
    assert.equal(r.status, 403);
    assert.equal(r.headers.get("x-cookingfoil-deny"), "device-login-other-console");
    assert.equal((await fromConsole(login, null)).status, 200);

    // Shop content only: no web pages that issue logins or reveal credentials, no writes.
    for (const url of ["/pair", "/pair/api/mine", "/admin", "/api/client-config", "/api/connect-url"]) {
      r = await fromConsole(login, CONSOLE_A, url);
      assert.equal(r.status, 403, url);
      assert.equal(r.headers.get("x-cookingfoil-deny"), "device-login-scope");
    }
    r = await fromConsole(login, CONSOLE_A, "/pair/api/logins", { method: "POST", headers: { Origin: BASE } });
    assert.equal(r.status, 403);

    // A password console never sits in the QR approval queue.
    const adminLogin = await fetch(`${BASE}/admin/verify`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: ALICE },
      body: JSON.stringify({ password: "admin-password-123" }),
    });
    const admin = { Authorization: BOB, Cookie: adminLogin.headers.get("set-cookie").split(";")[0], "Content-Type": "application/json" };
    const devices = await (await fetch(`${BASE}/admin/api/devices`, { headers: admin })).json();
    assert.ok(!devices.pending.some((p) => p.deviceKey === CONSOLE_A));
    const stats = await (await fetch(`${BASE}/admin/api/stats`, { headers: admin })).json();
    assert.ok(!stats.denials.recent.some((d) => d.reason === "device-bad-access-key"), "a password console is not a failed key");
    const all = await (await fetch(`${BASE}/admin/api/device-logins`, { headers: admin })).json();
    const row = all.logins.find((l) => l.name === login.name);
    assert.equal(row.owner, "alice");
    assert.equal(row.deviceKey, CONSOLE_A);
    assert.equal(row.label, "Living room");

    // Owners see and revoke only their own.
    const mine = await (await fetch(`${BASE}/pair/api/mine`, { headers: { Authorization: ALICE } })).json();
    assert.ok(mine.logins.some((l) => l.name === login.name && l.locked));
    assert.ok(!JSON.stringify(mine).includes("hash"));
    assert.equal((await (await fetch(`${BASE}/pair/api/mine`, { headers: { Authorization: BOB } })).json()).logins.length, 0);
    assert.equal((await asUser(BOB, `/pair/api/logins/${login.name}/revoke`)).status, 404);

    // Disabling the owner turns the login off; enabling it brings it back.
    r = await fetch(`${BASE}/admin/api/users/alice/enabled`, { method: "POST", headers: admin, body: JSON.stringify({ enabled: false }) });
    assert.equal(r.status, 200);
    assert.equal((await fromConsole(login, CONSOLE_A)).status, 401);
    await fetch(`${BASE}/admin/api/users/alice/enabled`, { method: "POST", headers: admin, body: JSON.stringify({ enabled: true }) });
    assert.equal((await fromConsole(login, CONSOLE_A)).status, 200);

    assert.equal((await asUser(ALICE, `/pair/api/logins/${login.name}/revoke`)).status, 200);
    assert.equal((await fromConsole(login, CONSOLE_A)).status, 401, "a revoked login stops at once");

    // Account names can't shadow device logins.
    r = await fetch(`${BASE}/admin/api/users`, { method: "POST", headers: admin, body: JSON.stringify({ name: "cf-abcdef" }) });
    assert.equal(r.status, 400);

    // The admin issues and revokes too.
    const issued = await (await fetch(`${BASE}/admin/api/device-logins`, { method: "POST", headers: admin, body: JSON.stringify({ label: "TV" }) })).json();
    assert.equal((await fromConsole(issued, CONSOLE_B)).status, 200);
    assert.equal((await fetch(`${BASE}/admin/api/device-logins/${issued.name}/revoke`, { method: "POST", headers: admin, body: "{}" })).status, 200);
    assert.equal((await fromConsole(issued, CONSOLE_B)).status, 401);
  } finally {
    server.kill("SIGKILL");
  }
});
