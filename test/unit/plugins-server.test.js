import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { adminSession } from "../support/web-session.js";
import { BODIES, manifestOf, writePlugin } from "../support/plugin-fixtures.js";

// The real server with bad plugins in its folder: it listens, answers, and keeps the operator in charge.
const PORT = 27300 + (process.pid % 500);
const BASE = `http://127.0.0.1:${PORT}`;
const LATE_THROW = "export default { async start() { setTimeout(() => { throw new Error('late throw'); }, 100); }, async metadata() {} };";

function boot(data, env = {}) {
  mkdirSync(path.join(data, "games"), { recursive: true });
  const child = spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: {
      ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: data, COOK_GAMES_DIR: path.join(data, "games"),
      COOK_AUTH_USERS: "owner:owner-password-1", COOK_ADMIN_PASSWORD: "admin-password-123", COOK_ADMIN_TOTP_SECRET: "",
      COOK_TITLEDB_AUTO_FETCH: "false", COOK_RATING_SYNC: "false", ...env,
    },
    stdio: "ignore",
  });
  return child;
}
async function waitReady() {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${BASE}/healthz`)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not become ready");
}
async function stop(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await once(child, "exit");
}
async function admin() {
  const headers = { ...(await adminSession(BASE, "owner", "owner-password-1", "admin-password-123")), "Content-Type": "application/json" };
  return async (method, url, body) => {
    const r = await fetch(`${BASE}${url}`, { method, headers, body: body && JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
}
const stateOf = (list, id) => list.plugins.find((p) => p.id === id)?.state;

test("the server answers with bad plugins in the folder; they start off, a crash keeps the culprit off, safe mode holds all", async () => {
  const data = mkdtempSync(path.join(tmpdir(), "cf-plugins-srv-"));
  writePlugin(data, "good");
  writePlugin(data, "brokenjson", { rawManifest: "{" });
  writePlugin(data, "thrower", { body: BODIES.throwsOnStart });
  writePlugin(data, "killer", { body: LATE_THROW, manifest: manifestOf("killer") });
  let child = boot(data);
  try {
    await waitReady();
    let api = await admin();
    let list = (await api("GET", "/admin/api/plugins")).body;
    assert.deepEqual(list.plugins.map((p) => [p.id, p.state]), [["brokenjson", "broken"], ["good", "off"], ["killer", "off"], ["thrower", "off"]], "nothing starts by itself");

    assert.equal((await api("POST", "/admin/api/plugins/good/enabled", { on: true })).body.plugin.state, "on");
    assert.equal((await api("POST", "/admin/api/plugins/thrower/enabled", { on: true })).body.plugin.state, "failed");
    assert.equal((await api("POST", "/admin/api/plugins/brokenjson/enabled", { on: true })).status, 409);
    assert.equal((await fetch(`${BASE}/healthz`)).ok, true, "a failing start does not touch the server");

    // A throw in a timer the plugin left behind takes the process down, as an uncaught error does.
    const gone = once(child, "exit");
    await api("POST", "/admin/api/plugins/killer/enabled", { on: true }).catch(() => {});
    await gone;
    assert.ok(existsSync(path.join(data, "plugins-crash")), "the crash names the plugin");

    child = boot(data);
    await waitReady();
    api = await admin();
    list = (await api("GET", "/admin/api/plugins")).body;
    assert.equal(stateOf(list, "killer"), "crash-disabled");
    assert.equal(stateOf(list, "good"), "on", "the others come back as they were");
    assert.equal(existsSync(path.join(data, "plugins-crash")), false);
    await stop(child);

    child = boot(data, { COOK_PLUGINS_SAFE_MODE: "1" });
    await waitReady();
    api = await admin();
    list = (await api("GET", "/admin/api/plugins")).body;
    assert.equal(list.safeMode, true);
    assert.equal(stateOf(list, "good"), "off");
    assert.equal((await api("POST", "/admin/api/plugins/good/enabled", { on: true })).status, 409);
  } finally {
    await stop(child);
  }
});
