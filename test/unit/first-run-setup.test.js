import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { generate } from "otplib";

// A fresh server: browsers land on /setup, the code from the log unlocks it, the
// first admin account and its authenticator are made there, and the admin page
// then takes outside-service keys without ever showing a secret back.
const PORT = 14300 + (process.pid % 500);
const BASE = `http://127.0.0.1:${PORT}`;

function boot() {
  const data = mkdtempSync(path.join(tmpdir(), "cook-setup-data-"));
  const games = path.join(data, "games");
  mkdirSync(games, { recursive: true });
  const child = spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: {
      ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: data, COOK_GAMES_DIR: games,
      COOK_AUTH_USERS: "", COOK_ADMIN_PASSWORD: "", COOK_ADMIN_TOTP_SECRET: "", COOK_FIRST_RUN_SETUP: "true",
      COOK_TITLEDB_AUTO_FETCH: "false", COOK_RATING_SYNC: "false", COOK_LOCKOUT_TRUST_LOOPBACK: "false",
      COOK_STEAMGRIDDB_KEY: "",
    },
    stdio: ["ignore", "pipe", "ignore"],
  });
  let out = "";
  child.stdout.on("data", (b) => { out += b; });
  return { child, data, log: () => out };
}

async function ready() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/healthz`)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not become ready");
}

const jar = new Map();
const keep = (r) => { for (const c of r.headers.getSetCookie()) { const [kv] = c.split(";"); const i = kv.indexOf("="); jar.set(kv.slice(0, i), kv.slice(i + 1)); } return r; };
const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
const post = async (url, body, { withCookies = true } = {}) => keep(await fetch(`${BASE}${url}`, {
  method: "POST", headers: { "Content-Type": "application/json", Origin: BASE, ...(withCookies ? { Cookie: cookie() } : {}) }, body: JSON.stringify(body),
}));

test("first run: setup code, admin account, authenticator, then keys from the admin page", async () => {
  const { child, data, log } = boot();
  try {
    await ready();
    const html = { Accept: "text/html" };
    let r = await fetch(`${BASE}/`, { headers: html, redirect: "manual" });
    assert.equal(r.status, 302);
    assert.equal(r.headers.get("location"), "/setup");
    r = await fetch(`${BASE}/`, { redirect: "manual" });
    assert.notEqual(r.headers.get("location"), "/setup", "clients that don't ask for HTML are left alone");

    const code = log().match(/setup code: ([A-Z0-9]{4}-[A-Z0-9]{4})/)?.[1];
    assert.ok(code, "the setup code is in the log");

    assert.equal((await post("/setup/api/account", { name: "boss", password: "long-enough-pass" })).status, 401, "locked until the code");
    assert.equal((await post("/setup/api/unlock", { code: "AAAA-AAAA" })).status, 401);
    r = await post("/setup/api/unlock", { code: code.toLowerCase() });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).next, "account");

    assert.equal((await post("/setup/api/account", { name: "boss", password: "short" })).status, 400);
    r = await post("/setup/api/account", { name: "boss", password: "long-enough-pass" });
    assert.deepEqual(await r.json(), { ok: true, next: "otp" });
    const users = JSON.parse(readFileSync(path.join(data, "security", "users.json"), "utf8")).users;
    assert.equal(users.boss.role, "admin");
    assert.ok(!JSON.stringify(users).includes("long-enough-pass"), "only a hash is stored");

    const start = await (await post("/setup/api/otp/start", {})).json();
    assert.match(start.secret, /^[A-Z2-7]{32}$/);
    assert.match(start.qr, /^<svg/);
    assert.equal((await post("/setup/api/otp/confirm", { code: "000000" })).status, 400);
    r = await post("/setup/api/otp/confirm", { code: await generate({ secret: start.secret }) });
    assert.deepEqual(await r.json(), { ok: true, next: "done" });

    r = await fetch(`${BASE}/setup`, { headers: html, redirect: "manual" });
    assert.equal(r.headers.get("location"), "/admin", "setup closes once done");
    assert.equal((await post("/setup/api/unlock", { code })).status, 410);

    // The admin page now opens and takes keys; secrets come back only as set / not set.
    const api = (url) => fetch(`${BASE}${url}`, { headers: { Cookie: cookie(), Accept: "application/json" } });
    let all = await (await api("/admin/api/integrations")).json();
    assert.equal(all.steamgriddb.configured, false);
    assert.match(all.dropboxRedirectUri, /\/api\/dropbox\/oauth\/dropbox\/callback$/);
    const KEY = "abcdef0123456789abcdef0123456789";
    assert.equal((await post("/admin/api/integrations/steamgriddb", { apiKey: "bad key!" })).status, 400);
    r = await post("/admin/api/integrations/steamgriddb", { apiKey: KEY });
    assert.equal(r.status, 200);
    all = await (await api("/admin/api/integrations")).json();
    assert.deepEqual(all.steamgriddb, { configured: true, source: "admin", fields: { apiKey: { set: true } } });
    assert.ok(!JSON.stringify(all).includes(KEY), "the key is never shown back");
    await post("/admin/api/integrations/steamgriddb", { apiKey: "" });
    assert.equal((await (await api("/admin/api/integrations")).json()).steamgriddb.configured, true, "an empty secret keeps the saved one");
    await post("/admin/api/integrations/steamgriddb/clear", {});
    assert.equal((await (await api("/admin/api/integrations")).json()).steamgriddb.configured, false);
  } finally {
    child.kill();
  }
});
