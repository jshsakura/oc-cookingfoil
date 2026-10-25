import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CONSOLE, seedConsole } from "../support/console.js";

// While the patch catalog is being read for the first time (the real one takes
// most of an hour on spinning disks), the addresses a console connects with
// keep answering at once, and /api/patches answers with what it has so far.
const PORT = 17100 + (process.pid % 500);
const BASE = `http://127.0.0.1:${PORT}`;
// An approved console: the shop takes its keys, never a password.
const AUTH = CONSOLE;
const LIMIT_MS = 1000;
const PATCHES = 12;
const PAUSE_MS = 400; // per patch: the scan lasts about five seconds

function patchesDir(root) {
  const dir = path.join(root, "patches");
  for (let i = 0; i < PATCHES; i++) {
    const tid = (0x0100000000000000n + BigInt(i + 1) * 0x10000n).toString(16).padStart(16, "0").toUpperCase();
    const f = path.join(dir, tid, `Patch ${i}`, "atmosphere", "contents", tid.toLowerCase(), "romfs", "x.bin");
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, `patch ${i}`);
  }
  return dir;
}

async function timed(url, init = {}) {
  const t = Date.now();
  const r = await fetch(BASE + url, { ...init, signal: AbortSignal.timeout(LIMIT_MS * 3) });
  const body = await r.text();
  return { status: r.status, ms: Date.now() - t, body, headers: r.headers };
}

test("a long first patch scan never holds up the addresses consoles connect with", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cf-nostall-"));
  fs.mkdirSync(path.join(root, "games"));
  await seedConsole(path.join(root, "data"));
  const child = spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: { ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: path.join(root, "data"), COOK_GAMES_DIR: path.join(root, "games"),
      COOK_PATCHES_DIR: patchesDir(root), COOK_AUTH_USERS: "alice:alice-password", COOK_DEVICE_PAIRING: "true",
      COOK_TITLEDB_AUTO_FETCH: "false", COOK_RATING_SYNC: "false", COOK_TEST_SLOW_SCAN_MS: String(PAUSE_MS) },
    stdio: "ignore",
  });
  try {
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(`${BASE}/healthz`)).ok) break; } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    let sawScanning = false;
    let sawPartial = false;
    const deadline = Date.now() + PATCHES * PAUSE_MS + 8000;
    let done = false;
    while (!done && Date.now() < deadline) {
      for (const [url, init] of [["/healthz", {}], ["/api/pair/status?code=AAAA", {}], ["/api/library/sections", { headers: AUTH }]]) {
        const r = await timed(url, init);
        assert.ok(r.ms < LIMIT_MS, `${url} answered in ${r.ms} ms`);
        assert.ok(r.status < 500 || r.headers.get("retry-after"), `${url}: ${r.status}`);
      }
      const p = await timed("/api/patches", { headers: AUTH });
      assert.ok(p.ms < LIMIT_MS, `/api/patches answered in ${p.ms} ms`);
      assert.equal(p.status, 200, "a partial listing, never 503");
      const body = JSON.parse(p.body);
      if (body.scanning) {
        sawScanning = true;
        assert.equal(p.headers.get("retry-after"), "30");
        if (body.patches.length > 0 && body.patches.length < PATCHES) sawPartial = true;
      } else {
        done = body.patches.length === PATCHES;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.ok(sawScanning, "the scan was seen running");
    assert.ok(sawPartial, "patches appeared as they were read");
    assert.ok(done, "and then all of them, without `scanning`");
  } finally {
    child.kill();
  }
});
