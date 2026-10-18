import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Outside Docker NODE_ENV is unset, and Express's own error page then shows the
// stack with this machine's paths. The server answers errors itself instead.
const PORT = 16900 + (process.pid % 90);
const BASE = `http://127.0.0.1:${PORT}`;
const data = fs.mkdtempSync(path.join(tmpdir(), "cook-error-responses-"));
fs.mkdirSync(path.join(data, "games"));

async function boot() {
  const env = { ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: data, COOK_GAMES_DIR: path.join(data, "games"),
    COOK_AUTH_USERS: "alice:alice-password-1", COOK_ADMIN_PASSWORD: "admin-password-123", COOK_TITLEDB_AUTO_FETCH: "false" };
  delete env.NODE_ENV;
  const child = spawn(process.execPath, ["./src/index.js"], { cwd: path.join(import.meta.dirname, "../.."), env, stdio: "ignore" });
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

test("a request the server cannot parse gets its status without a stack or paths", async () => {
  const server = await boot();
  try {
    const res = await fetch(`${BASE}/auth/logout`, { method: "POST", headers: { "content-type": "application/json" }, body: "{bad" });
    const body = await res.text();
    assert.equal(res.status, 400, "the client's mistake stays a 400");
    assert.doesNotMatch(body, /\bat \S+ \(|node_modules|\/src\//, "no stack trace");
    assert.doesNotMatch(body, new RegExp(path.join(import.meta.dirname, "../..").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "no server path");
  } finally {
    server.kill("SIGKILL");
    fs.rmSync(data, { recursive: true, force: true });
  }
});
