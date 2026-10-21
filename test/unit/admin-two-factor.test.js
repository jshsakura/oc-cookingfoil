import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { generate } from "otplib";

// Admin login set up from the admin page: an operator who signs in with the
// admin password enrolls an authenticator, after which either one opens the page, and
// can turn it off again. A real server process, so the session cookie, the
// same-origin guard and the persisted secret are all exercised.
const PORT = 13700 + (process.pid % 500);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = "a-long-admin-password";

function boot() {
  const data = mkdtempSync(path.join(tmpdir(), "cook-2fa-data-"));
  const games = path.join(data, "games");
  mkdirSync(games, { recursive: true });
  return spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: {
      ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: data, COOK_GAMES_DIR: games,
      COOK_AUTH_USERS: "", COOK_ADMIN_PASSWORD: PASSWORD, COOK_ADMIN_TOTP_SECRET: "",
      COOK_TITLEDB_AUTO_FETCH: "false", COOK_RATING_SYNC: "false", COOK_LOCKOUT_TRUST_LOOPBACK: "false",
    },
    stdio: "ignore",
  });
}

async function ready() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/healthz`)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not become ready");
}

const json = { "Content-Type": "application/json" };
const login = (body) => fetch(`${BASE}/admin/verify`, { method: "POST", headers: json, body: JSON.stringify(body) });
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];

test("enroll an authenticator from the admin page, then either the password or a code opens it, and it can be turned off", async () => {
  const server = boot();
  try {
    await ready();
    let r = await login({ password: PASSWORD });
    assert.equal(r.status, 200, "password alone opens the page before enrollment");
    const cookie = cookieOf(r);
    const as = (extra = {}) => ({ headers: { ...json, Cookie: cookie, Origin: BASE, ...extra } });

    let status = await (await fetch(`${BASE}/admin/api/2fa`, as())).json();
    assert.deepEqual(status, { password: true, passwordSaved: false, passwordEnv: true, authenticator: false, manageable: true, skipped: false });

    const start = await (await fetch(`${BASE}/admin/api/2fa/start`, { method: "POST", body: "{}", ...as() })).json();
    assert.match(start.secret, /^[A-Z2-7]{32}$/);
    assert.match(start.qr, /^<svg/);
    assert.match(start.uri, /^otpauth:\/\/totp\//);

    r = await fetch(`${BASE}/admin/api/2fa/confirm`, { method: "POST", body: JSON.stringify({ code: "000000" }), ...as() });
    assert.equal(r.status, 400, "a wrong code does not enroll");
    r = await fetch(`${BASE}/admin/api/2fa/start`, { method: "POST", body: "{}", ...as({ Origin: "https://evil.example" }) });
    assert.equal(r.status, 403, "a cross-origin request is refused");

    const code = await generate({ secret: start.secret });
    status = await (await fetch(`${BASE}/admin/api/2fa/confirm`, { method: "POST", body: JSON.stringify({ code }), ...as() })).json();
    assert.equal(status.authenticator, true);

    assert.equal((await login({ password: PASSWORD })).status, 200, "the password still opens it");
    const used = await generate({ secret: start.secret });
    assert.equal((await login({ code: used })).status, 200, "so does a code alone");
    assert.equal((await login({ password: "wrong-password-xx" })).status, 401);
    assert.equal((await login({ code: "000000" })).status, 401);
    const gate = await (await fetch(`${BASE}/admin`)).text();
    assert.match(gate, /id="pw"/);
    assert.match(gate, /id="code"/);
    assert.equal((await login({ code: used })).status, 401, "a code that opened it once does not open it again");
    r = await login({ password: PASSWORD });
    assert.equal(r.status, 200);

    status = await (await fetch(`${BASE}/admin/api/2fa/disable`, { method: "POST", body: "{}", ...as({ Cookie: cookieOf(r) }) })).json();
    assert.equal(status.authenticator, false);
    assert.equal((await login({ password: PASSWORD })).status, 200, "after turning it off the password is enough again");
  } finally {
    server.kill();
  }
});
