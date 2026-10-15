import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The admin switches off consoles that sign in with an ID and password: Basic
// counts for nothing from a console any more, while an access key or a session
// still gets in, and the web and admin pages sign in as before.
const PORT = 19300 + (process.pid % 300);
const BASE = `http://127.0.0.1:${PORT}`;
const ALICE = "Basic " + Buffer.from("alice:alice-password").toString("base64");
const KEY = "D4".repeat(32);

async function boot(data) {
  fs.mkdirSync(path.join(data, "games"), { recursive: true });
  const child = spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: { ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: data, COOK_GAMES_DIR: path.join(data, "games"),
      COOK_AUTH_USERS: "alice:alice-password", COOK_DEVICE_PAIRING: "true", COOK_ADMIN_PASSWORD: "admin-password-123",
      COOK_TITLEDB_AUTO_FETCH: "false", COOK_LOCKOUT_TRUST_LOOPBACK: "false" },
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

test("with console passwords off, a console gets in only with its key or session", async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "cf-consolepw-"));
  const server = await boot(data);
  try {
    // On (the default): a console signs in with its password and gets its access key.
    const paired = await (await fetch(`${BASE}/api/pair/status`, { headers: { Authorization: ALICE, "X-Device-Key": KEY } })).json();
    assert.ok(paired.accessKey);
    assert.equal((await fetch(`${BASE}/api/shop/sections`, { headers: { Authorization: ALICE } })).status, 200);

    const login = await fetch(`${BASE}/admin/verify`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: ALICE }, body: JSON.stringify({ password: "admin-password-123" }),
    });
    const admin = { Authorization: ALICE, Cookie: login.headers.get("set-cookie").split(";")[0], "Content-Type": "application/json", Origin: BASE };
    const saved = await fetch(`${BASE}/admin/api/server-settings`, { method: "POST", headers: admin, body: JSON.stringify({ consolePasswords: false }) });
    assert.equal(saved.status, 200, await saved.clone().text());
    assert.equal((await saved.json()).settings.consolePasswords.value, false);

    // Off (this test's own machine is not trusted: COOK_LOCKOUT_TRUST_LOOPBACK=false).
    const r = await fetch(`${BASE}/api/shop/sections`, { headers: { Authorization: ALICE } });
    assert.equal(r.status, 401);
    assert.equal(r.headers.get("x-cookingfoil-deny"), "console-passwords-off");
    assert.equal(r.headers.get("www-authenticate"), null, "no password prompt");
    const knock = await (await fetch(`${BASE}/api/pair/status`, { headers: { Authorization: ALICE, "X-Device-Key": "E5".repeat(32) } })).json();
    assert.equal(knock.status, "pending", "a password approves no console");
    const session = await fetch(`${BASE}/api/session`, { headers: { "X-Device-Key": KEY, "X-Access-Key": paired.accessKey } });
    assert.equal(session.status, 200, "the access key still trades for a session");
    assert.equal((await fetch(`${BASE}/api/shop/sections`, { headers: { "X-Device-Key": KEY, "X-Access-Key": paired.accessKey } })).status, 200, "the access key still gets in");
    const info = await (await fetch(`${BASE}/api/shop/info`, { headers: { "X-Device-Key": KEY, "X-Access-Key": paired.accessKey } })).json();
    assert.ok(!info.features.includes("device-logins"), "no device logins to hand out");
  } finally {
    server.kill("SIGKILL");
  }
});
