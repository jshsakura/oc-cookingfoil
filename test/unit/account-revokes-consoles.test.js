import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { webSession, adminSession } from "../support/web-session.js";

// A console an account approved keeps its own access key. When the account is
// removed, disabled or given a new password, the consoles it approved go with it.
const PORT = 23300 + (process.pid % 500);
const BASE = `http://127.0.0.1:${PORT}`;
const PEOPLE = { alice: "alice-password-1", bob: "bob-password-1", carol: "carol-password-1" };
const deviceKey = (c) => c.repeat(64);

function bootServer() {
  const data = mkdtempSync(path.join(tmpdir(), "cook-revoke-"));
  const games = path.join(data, "games");
  mkdirSync(games, { recursive: true });
  return spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: {
      ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: data, COOK_GAMES_DIR: games,
      COOK_AUTH_USERS: ["owner:owner-password-1", ...Object.entries(PEOPLE).map(([n, p]) => `${n}:${p}`)].join(","),
      COOK_DEVICE_PAIRING: "true", COOK_ADMIN_PASSWORD: "admin-password-123", COOK_ADMIN_TOTP_SECRET: "",
      COOK_TITLEDB_AUTO_FETCH: "false", COOK_RATING_SYNC: "false", COOK_LOCKOUT_TRUST_LOOPBACK: "false",
    },
    stdio: "ignore",
  });
}

async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/healthz`)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not become ready");
}

const knock = async (key) => (await fetch(`${BASE}/api/pair/status`, { headers: { "X-Device-Key": key } })).json();

/** `auth` (a signed-in page's headers) approves a waiting console by its code; returns its access key. */
async function pairAs(auth, key) {
  const { pairCode } = await knock(key);
  const r = await fetch(`${BASE}/pair/approve`, {
    method: "POST", headers: { "Content-Type": "application/json", ...auth }, body: JSON.stringify({ code: pairCode }),
  });
  assert.equal(r.status, 200);
  return (await knock(key)).accessKey;
}

const library = async (key, accessKey) =>
  (await fetch(`${BASE}/api/library/sections`, { headers: { "X-Device-Key": key, "X-Access-Key": accessKey } })).status;

test("removing, disabling or re-passwording an account revokes the consoles it approved", async () => {
  const server = bootServer();
  try {
    await waitReady();
    const consoles = {};
    for (const [i, name] of ["owner", ...Object.keys(PEOPLE)].entries()) {
      const key = deviceKey("ABCD"[i]);
      const auth = await webSession(BASE, name, name === "owner" ? "owner-password-1" : PEOPLE[name]);
      consoles[name] = { key, accessKey: await pairAs(auth, key) };
      assert.equal(await library(key, consoles[name].accessKey), 200, `${name}'s console opens the library`);
    }

    const admin = { ...(await adminSession(BASE, "owner", "owner-password-1", "admin-password-123")), "Content-Type": "application/json" };
    const call = (method, url, body) => fetch(`${BASE}${url}`, { method, headers: admin, body: body && JSON.stringify(body) });

    assert.equal((await call("DELETE", "/admin/api/users/alice")).status, 200);
    assert.equal((await call("POST", "/admin/api/users/bob/enabled", { enabled: false })).status, 200);
    assert.equal((await call("POST", "/admin/api/users/carol/password", {})).status, 200);

    for (const name of Object.keys(PEOPLE)) {
      assert.equal(await library(consoles[name].key, consoles[name].accessKey), 401, `${name}'s console is revoked`);
    }
    const refused = await fetch(`${BASE}/api/library/sections`, { headers: { "X-Device-Key": consoles.bob.key, "X-Access-Key": consoles.bob.accessKey } });
    assert.equal(refused.headers.get("x-cookingfoil-session"), "revoked", "a revoked console's access key is told to pair again");
    const wrongKey = await fetch(`${BASE}/api/library/sections`, { headers: { "X-Device-Key": consoles.owner.key, "X-Access-Key": "f".repeat(64) } });
    assert.equal(wrongKey.status, 401);
    assert.equal(wrongKey.headers.get("x-cookingfoil-session"), null, "a wrong key for an approved console says nothing more");
    assert.equal(await library(consoles.owner.key, consoles.owner.accessKey), 200, "consoles of other accounts stay");
    const devices = await (await call("GET", "/admin/api/devices")).json();
    assert.deepEqual(devices.approved.map((d) => d.addedBy), ["owner"]);
  } finally {
    server.kill("SIGKILL");
  }
});

test("the new-password confirmation says the account's consoles must pair again", async () => {
  const { DASHBOARD_SCRIPT } = await import("../../src/routes/admin/dashboard-script.js");
  const ask = DASHBOARD_SCRIPT.match(/async function resetPassword\(name\)\{if\(!await ask\(([^;]*)\)\)return;/)?.[1];
  assert.ok(ask, "resetPassword asks before it acts");
  assert.match(ask, /topFill\('pp.resetAsk',\{name\}\)/);
  const { TOP_WORDS } = await import("../../src/routes/admin/top-i18n.js");
  assert.match(TOP_WORDS.ko["pp.resetAsk"], /기기/);
  assert.match(TOP_WORDS.ko["pp.resetAsk"], /다시 승인/);
  assert.match(TOP_WORDS.en["pp.resetAsk"], /approved again/);
  assert.match(TOP_WORDS.ja["pp.resetAsk"], /再承認/);
  assert.match(TOP_WORDS.zh["pp.resetAsk"], /重新批准/);
});
