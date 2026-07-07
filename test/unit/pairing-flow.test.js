import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { generate } from "otplib";

// End-to-end HTTP exercise of the pairing lane against a real server process,
// BEFORE the CyberFoil app exists. Drives the whole arc: a device knocks →
// admin (real TOTP session) approves → device polls and receives its one-time
// accessKey → device pulls content with (UID + X-Access-Key) → revoke locks it
// back out. Runs pairing as the SOLE lane (COOK_AUTH_USERS empty) so
// deviceContentGuard enforcement is what's under test.

const TOTP_SECRET = "KRSXG5CTMVRXEZLUKRSXG5CTMVRXEZLU"; // valid base32, 20 bytes (≥16)
const DEVICE_KEY = "A1B2C3D4E5F60718293A4B5C6D7E8F90A1B2C3D4E5F60718293A4B5C6D7E8F90";
const PORT = 13100 + (process.pid % 500);
const BASE = `http://127.0.0.1:${PORT}`;

function bootServer() {
  const data = mkdtempSync(path.join(tmpdir(), "cook-flow-data-"));
  const games = path.join(data, "games");
  mkdirSync(games, { recursive: true });
  const child = spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: {
      ...process.env,
      COOK_PORT: String(PORT),
      COOK_DATA_DIR: data,
      COOK_GAMES_DIR: games,
      COOK_AUTH_USERS: "", // no basic-auth → pairing is the sole lane
      COOK_DEVICE_PAIRING: "true",
      COOK_ADMIN_TOTP_SECRET: TOTP_SECRET,
      COOK_TITLEDB_AUTO_FETCH: "false",
      // Treat 127.0.0.1 as a real remote so the content guard actually enforces
      // (loopback is trusted by default for dev/docker-host convenience).
      COOK_LOCKOUT_TRUST_LOOPBACK: "false",
    },
    stdio: "ignore",
  });
  return child;
}

async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/healthz`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((res) => setTimeout(res, 250));
  }
  throw new Error("server did not become ready");
}

test("pairing lane: request → approve → deliver key → access → revoke", async () => {
  const server = bootServer();
  try {
    await waitReady();

    // 1) Device knocks → pending.
    let r = await fetch(`${BASE}/api/pair/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceKey: DEVICE_KEY }),
    });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { status: "pending" });

    // 2) Content is locked before approval (sole lane, no creds) → 403.
    r = await fetch(`${BASE}/shop.tfl`, { headers: { UID: DEVICE_KEY } });
    assert.equal(r.status, 403);

    // 3) Admin mints a real TOTP session cookie.
    const code = await generate({ secret: TOTP_SECRET });
    r = await fetch(`${BASE}/admin/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    assert.equal(r.status, 200, "TOTP verify should succeed");
    const setCookie = r.headers.get("set-cookie") || "";
    const cookie = setCookie.split(";")[0];
    assert.match(cookie, /^cf_admin=/, "should mint cf_admin cookie");

    // 4) Admin approves the device.
    r = await fetch(`${BASE}/admin/api/devices/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ deviceKey: DEVICE_KEY, label: "friend switch" }),
    });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).ok, true);

    // 5) Device polls status → receives its one-time accessKey.
    r = await fetch(`${BASE}/api/pair/status?deviceKey=${DEVICE_KEY}`);
    const status = await r.json();
    assert.equal(status.status, "approved");
    assert.ok(status.accessKey, "accessKey delivered once");
    const accessKey = status.accessKey;

    // 6) Second poll no longer leaks the key (one-time delivery).
    r = await fetch(`${BASE}/api/pair/status?deviceKey=${DEVICE_KEY}`);
    assert.equal((await r.json()).accessKey, undefined);

    // 7) Device pulls content with (UID + accessKey) → allowed.
    r = await fetch(`${BASE}/shop.tfl`, {
      headers: { UID: DEVICE_KEY, "X-Access-Key": accessKey },
    });
    assert.equal(r.status, 200, "approved device passes the content guard");

    // 8) Wrong accessKey → blocked.
    r = await fetch(`${BASE}/shop.tfl`, {
      headers: { UID: DEVICE_KEY, "X-Access-Key": "wrong" },
    });
    assert.equal(r.status, 403);

    // 9) Revoke → the same key no longer works.
    r = await fetch(`${BASE}/admin/api/devices/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ deviceKey: DEVICE_KEY }),
    });
    assert.equal(r.status, 200);
    r = await fetch(`${BASE}/shop.tfl`, {
      headers: { UID: DEVICE_KEY, "X-Access-Key": accessKey },
    });
    assert.equal(r.status, 403, "revoked device is locked back out");
  } finally {
    server.kill("SIGKILL");
  }
});
