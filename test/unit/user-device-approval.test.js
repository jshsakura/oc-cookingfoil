import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// A shop user signed in on their phone approves a console by scanning its QR
// (or typing its code); the console then gets its access key with no password.
const DEVICE_A = "C1B2C3D4E5F60718293A4B5C6D7E8F90A1B2C3D4E5F60718293A4B5C6D7E8F90";
const DEVICE_B = "D1B2C3D4E5F60718293A4B5C6D7E8F90A1B2C3D4E5F60718293A4B5C6D7E8F90";
const PORT = 13700 + (process.pid % 500);
const BASE = `http://127.0.0.1:${PORT}`;
const BASIC = "Basic " + Buffer.from("alice:alice-password").toString("base64");

function bootServer() {
  const data = mkdtempSync(path.join(tmpdir(), "cook-userpair-"));
  const games = path.join(data, "games");
  mkdirSync(games, { recursive: true });
  return spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: {
      ...process.env,
      COOK_PORT: String(PORT),
      COOK_DATA_DIR: data,
      COOK_GAMES_DIR: games,
      COOK_AUTH_USERS: "alice:alice-password",
      COOK_DEVICE_PAIRING: "true",
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

const knock = async (deviceKey) =>
  (await fetch(`${BASE}/api/pair/status`, { headers: { "X-Device-Key": deviceKey } })).json();
const approve = (body, headers = {}) =>
  fetch(`${BASE}/pair/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: BASIC, Origin: BASE, ...headers },
    body: JSON.stringify(body),
  });

test("a signed-in user approves a console from the QR or its code", async () => {
  const server = bootServer();
  try {
    await waitReady();
    const pendingA = await knock(DEVICE_A);
    assert.equal(pendingA.status, "pending");
    assert.match(pendingA.pairUrl, new RegExp(`^${BASE}/pair/[a-f0-9]{32}$`));
    const token = pendingA.pairUrl.split("/").pop();

    // The page sits behind the shop's sign-in and may use the camera.
    assert.equal((await fetch(`${BASE}/pair`)).status, 401);
    const scan = await fetch(`${BASE}/pair`, { headers: { Authorization: BASIC, "Accept-Language": "ko" } });
    assert.equal(scan.status, 200);
    assert.match(scan.headers.get("permissions-policy"), /camera=\(self\)/);
    const scanHtml = await scan.text();
    assert.ok(scanHtml.includes('id="scan"') && scanHtml.includes('id="code"'));
    assert.ok(scanHtml.includes("alice"));
    assert.equal((await fetch(`${BASE}/pair/qr.js`, { headers: { Authorization: BASIC } })).status, 200);

    const confirm = await (await fetch(pendingA.pairUrl, { headers: { Authorization: BASIC } })).text();
    assert.ok(confirm.includes(pendingA.pairCode));
    assert.ok(!confirm.includes(DEVICE_A));

    // Cross-site and origin-less posts never approve, even with the browser's credentials.
    assert.equal((await approve({ token }, { Origin: "https://evil.example" })).status, 403);
    const noOrigin = await fetch(`${BASE}/pair/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: BASIC },
      body: JSON.stringify({ token }),
    });
    assert.equal(noOrigin.status, 403);

    let r = await approve({ token, label: "Living room" });
    assert.equal(r.status, 200);
    assert.equal((await approve({ token })).status, 409, "a replayed QR must not rotate the key");
    const deliveredA = await knock(DEVICE_A);
    assert.ok(deliveredA.accessKey);
    r = await fetch(`${BASE}/api/shop/sections`, {
      headers: { "X-Device-Key": DEVICE_A, "X-Access-Key": deliveredA.accessKey },
    });
    assert.equal(r.status, 200, "the console signs in with its key, no password");

    // A paired console cannot approve another console.
    const pendingB = await knock(DEVICE_B);
    r = await fetch(`${BASE}/pair/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: BASE, "X-Device-Key": DEVICE_A, "X-Access-Key": deliveredA.accessKey },
      body: JSON.stringify({ code: pendingB.pairCode }),
    });
    assert.equal(r.status, 401);

    // Typing the code works when the QR can't be scanned; dashes and case don't matter.
    assert.equal((await approve({ code: "00000000" })).status, 404);
    const typed = pendingB.pairCode.toLowerCase().replace(/^(.{4})/, "$1-");
    assert.equal((await approve({ code: typed })).status, 200);
    assert.ok((await knock(DEVICE_B)).accessKey);

    const done = await (await fetch(pendingA.pairUrl, { headers: { Authorization: BASIC } })).text();
    assert.ok(done.includes("Device connected."));
  } finally {
    server.kill("SIGKILL");
  }
});
