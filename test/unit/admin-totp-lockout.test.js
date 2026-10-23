import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { generate } from "otplib";
import * as guard from "../../src/security/totp-guard.js";

test("five wrong codes in fifteen minutes stop code checks; a correct one starts over", () => {
  guard._clear();
  const t0 = 1_000_000;
  for (let i = 0; i < guard.MAX_FAILURES - 1; i++) guard.recordFailure("admin", "203.0.113.5", t0 + i);
  assert.equal(guard.lockedFor("admin", "203.0.113.5", t0 + 10), 0, "four is not enough");
  guard.recordFailure("admin", "203.0.113.5", t0 + 10);
  assert.ok(guard.lockedFor("admin", "203.0.113.5", t0 + 11) > 0);
  assert.ok(guard.lockedFor("admin", "198.51.100.7", t0 + 11) > 0, "the account is locked from every address");
  assert.equal(guard.lockedFor("admin", "203.0.113.5", t0 + guard.WINDOW_MS + 1), 0, "the window passes");
  for (let i = 0; i < guard.MAX_FAILURES - 1; i++) guard.recordFailure("admin", "203.0.113.5", t0);
  guard.reset("admin", "203.0.113.5");
  guard.recordFailure("admin", "203.0.113.5", t0 + 1);
  assert.equal(guard.lockedFor("admin", "203.0.113.5", t0 + 2), 0, "a correct code cleared the count");
});

const PORT = 13200 + (process.pid % 500);
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

test("wrong admin codes lock even from loopback, where the ordinary lockout doesn't count", async () => {
  const data = mkdtempSync(path.join(tmpdir(), "cook-totp-lock-"));
  mkdirSync(path.join(data, "games"));
  const server = spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: { ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: data, COOK_GAMES_DIR: path.join(data, "games"),
      COOK_AUTH_USERS: "", COOK_ADMIN_PASSWORD: "", COOK_ADMIN_TOTP_SECRET: SECRET,
      COOK_TITLEDB_AUTO_FETCH: "false", COOK_RATING_SYNC: "false", COOK_LOCKOUT_TRUST_LOOPBACK: "true" },
    stdio: "ignore",
  });
  const login = (code) => fetch(`${BASE}/admin/verify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
  try {
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(`${BASE}/healthz`)).ok) break; } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.equal((await login(await generate({ secret: SECRET }))).status, 200, "a correct code opens the page");
    for (let i = 0; i < guard.MAX_FAILURES; i++) assert.equal((await login("000000")).status, 401);
    const locked = await login(await generate({ secret: SECRET }));
    assert.equal(locked.status, 429, "even the right code waits once the count is reached");
    assert.ok(Number(locked.headers.get("retry-after")) > 0);
    const body = await locked.json();
    assert.equal(body.error, "otp-locked");
    assert.match(body.message, /Too many wrong codes/);
  } finally {
    server.kill();
  }
});
