import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CONSOLE, CONSOLE_KEY, seedConsole } from "../support/console.js";
import { adminSession } from "../support/web-session.js";

// The waiting list's reject button drops a request and nothing else. The admin's list can be
// stale: a console approved meanwhile (QR, auto approval) keeps its approval and its access.
const PORT = 26800 + (process.pid % 500);
const BASE = `http://127.0.0.1:${PORT}`;
const WAITING_KEY = "CD".repeat(32);

function boot(data) {
  const games = path.join(data, "games");
  mkdirSync(games, { recursive: true });
  return spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: {
      ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: data, COOK_GAMES_DIR: games,
      COOK_AUTH_USERS: "owner:owner-password-1,alice:alice-password-1",
      COOK_DEVICE_PAIRING: "true", COOK_DEVICE_AUTO_APPROVE: "false", COOK_TRUST_PROXY: "loopback",
      COOK_ADMIN_PASSWORD: "admin-password-123", COOK_ADMIN_TOTP_SECRET: "",
      COOK_TITLEDB_AUTO_FETCH: "false", COOK_RATING_SYNC: "false", COOK_LOCKOUT_TRUST_LOOPBACK: "false",
    },
    stdio: "ignore",
  });
}

async function waitReady() {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${BASE}/healthz`)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not become ready");
}

test("rejecting a waiting console drops only the request; an approved console keeps its access", async () => {
  const data = mkdtempSync(path.join(tmpdir(), "cook-dismiss-"));
  await seedConsole(data, { addedBy: "alice" });
  const server = boot(data);
  try {
    await waitReady();
    const admin = { ...(await adminSession(BASE, "owner", "owner-password-1", "admin-password-123")), "Content-Type": "application/json" };
    const call = async (method, url, body) => {
      const r = await fetch(`${BASE}${url}`, { method, headers: admin, body: body && JSON.stringify(body) });
      assert.equal(r.status, 200, `${method} ${url}`);
      return r.json();
    };

    // Approved before the admin pressed reject on an old row of it.
    assert.deepEqual(await call("POST", "/admin/api/devices/dismiss", { deviceKey: CONSOLE_KEY }), { ok: true, dismissed: 0, approved: true });
    assert.equal((await fetch(`${BASE}/api/library/sections`, { headers: CONSOLE })).status, 200, "the approved console still gets in");
    assert.ok((await call("GET", "/admin/api/devices")).approved.some((d) => d.deviceKey === CONSOLE_KEY));

    // A console that is really waiting is dropped from the list.
    await fetch(`${BASE}/api/pair/status`, { headers: { "X-Device-Key": WAITING_KEY } });
    assert.ok((await call("GET", "/admin/api/devices")).pending.some((d) => d.deviceKey === WAITING_KEY));
    assert.deepEqual(await call("POST", "/admin/api/devices/dismiss", { deviceKey: WAITING_KEY }), { ok: true, dismissed: 1, approved: false });
    assert.ok(!(await call("GET", "/admin/api/devices")).pending.some((d) => d.deviceKey === WAITING_KEY));

    const bad = await fetch(`${BASE}/admin/api/devices/dismiss`, { method: "POST", headers: admin, body: JSON.stringify({ deviceKey: "nope" }) });
    assert.equal(bad.status, 400);
  } finally {
    if (server.exitCode === null) { server.kill("SIGTERM"); await once(server, "exit"); }
  }
});
