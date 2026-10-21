import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { generate } from "otplib";
import { records } from "../support/security-db.js";

// A fresh server: browsers land on /setup, the code from the log unlocks it, the
// first admin account and its authenticator are made there, and the admin page
// then takes outside-service keys without ever showing a secret back.
const PORT = 14300 + (process.pid % 500);
const BASE = `http://127.0.0.1:${PORT}`;

function boot(port = PORT) {
  const data = mkdtempSync(path.join(tmpdir(), "cook-setup-data-"));
  const games = path.join(data, "games");
  mkdirSync(games, { recursive: true });
  const child = spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: {
      ...process.env, COOK_PORT: String(port), COOK_DATA_DIR: data, COOK_GAMES_DIR: games,
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

async function ready(base = BASE) {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${base}/healthz`)).ok) return; } catch { /* not up yet */ }
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

test("before setup is finished /admin neither shows the authenticator secret nor signs anyone in", async () => {
  const port = 22300 + (process.pid % 500);
  const base = `http://127.0.0.1:${port}`;
  const { child } = boot(port);
  try {
    await ready(base);
    for (const accept of [undefined, "application/json", "*/*"]) {
      const r = await fetch(`${base}/admin/`, { headers: accept ? { Accept: accept } : {}, redirect: "manual" });
      const body = await r.text();
      assert.ok(r.status >= 300, `GET /admin/ with Accept ${accept} is refused (${r.status})`);
      assert.doesNotMatch(body, /[A-Z2-7]{32}/, "no authenticator secret before setup");
    }
    let r = await fetch(`${base}/admin/guide`, { headers: { Accept: "text/html" }, redirect: "manual" });
    assert.equal(r.headers.get("location"), "/setup", "every admin page leads to /setup");
    r = await fetch(`${base}/admin/verify`, { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify({ code: "123456" }) });
    assert.ok(r.status >= 400, "no admin sign-in before setup");
    assert.ok(!r.headers.getSetCookie().some((c) => c.startsWith("cf_admin=")), "no admin cookie before setup");
    r = await fetch(`${base}/admin/api/users`, { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify({ name: "intruder", password: "long-enough-pass", role: "admin" }) });
    assert.ok(r.status >= 400, "no admin API before setup");
    r = await fetch(`${base}/setup/api/unlock`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://setup.example.com" }, body: JSON.stringify({ code: "AAAA-0000" }) });
    assert.deepEqual([r.status, (await r.json()).error], [403, "origin"], "a page on another address cannot drive setup");
    const page = await (await fetch(`${base}/setup`, { headers: { Accept: "text/html", "Accept-Language": "en" } })).text();
    assert.match(page, /COOK_TRUST_PROXY/, "the setup page says what to check when the address does not match");
  } finally {
    child.kill();
  }
});

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
    const users = records(data, "user");
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

    // Automation tokens: made from the session, shown once, admin API only, no accounts or sign-in.
    const made = await (await post("/admin/api/tokens", { label: "assistant" })).json();
    assert.match(made.token, /^cft_[a-f0-9]{8}_/);
    const listed = await (await api("/admin/api/tokens")).json();
    assert.equal(listed.tokens[0].label, "assistant");
    assert.ok(!JSON.stringify(listed).includes(made.token.replace(/^cft_[a-f0-9]{8}_/, "")), "the secret is not listed");
    const bearer = (token) => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
    const viaToken = (url, init = {}, token = made.token) => fetch(`${BASE}${url}`, { ...init, headers: bearer(token) });
    assert.equal((await viaToken("/admin/api/integrations")).status, 200);
    const guide = await viaToken("/admin/guide.md");
    assert.equal(guide.status, 200);
    assert.match(await guide.text(), /AI 도우미에게 맡기기/);
    assert.equal((await viaToken("/admin/api/users", { method: "POST", body: JSON.stringify({ name: "x", password: "long-enough-pass" }) })).status, 403);
    assert.equal((await viaToken("/admin/api/tokens", { method: "POST", body: "{}" })).status, 403, "tokens never mint tokens");
    assert.equal((await viaToken("/admin/api/2fa/start", { method: "POST", body: "{}" })).status, 403);
    // Nor who may sign in: console approval, the alerts with approval buttons.
    for (const url of ["/admin/api/devices/approve", "/admin/api/Devices/approve", "/admin/api/integrations/telegram", "/admin/api/alerts", "/admin/api/pair/0123/approve", "/admin/api/clients/01234567/revoke"]) {
      assert.equal((await viaToken(url, { method: "POST", body: JSON.stringify({ code: "ABCD2345", label: "x" }) })).status, 403, url);
    }
    // Nor what every console installs: the client build, homebrew binaries and where releases come from.
    for (const url of ["/admin/api/upload/client", "/admin/api/Upload/Homebrew", "/admin/api/client-release/check", "/admin/api/homebrew", "/admin/api/homebrew/asset"]) {
      assert.equal((await viaToken(url, { method: "POST", body: JSON.stringify({ repo: "someone/app", asset: "x.nro" }) })).status, 403, url);
    }
    // Nor patches consoles install, nor which of them a game requires.
    for (const url of ["/admin/api/upload/patch", "/admin/api/Upload/Patch", "/admin/api/patches/required", "/admin/api/content/patch/move", "/admin/api/content/patch/remove"]) {
      assert.equal((await viaToken(url, { method: "POST", body: JSON.stringify({ id: "x", required: true }) })).status, 403, url);
    }
    assert.equal((await viaToken("/admin/api/patches/x/info", { method: "PUT", body: JSON.stringify({ required: true }) })).status, 403, "editing a patch's info can mark it required");
    assert.equal((await viaToken("/admin/api/patches/info")).status, 200, "patch info still reads");
    // Express decodes route params, so an encoded name must not slip past the block.
    for (const url of ["/admin/api/upload/%63lient", "/admin/api/upload/%68omebrew", "/admin/api/upload/%70atch", "/admin/api/integrations/%74elegram"]) {
      assert.equal((await viaToken(url, { method: "POST", body: JSON.stringify({ chatId: "1" }) })).status, 403, url);
    }
    assert.equal((await viaToken("/admin/api/upload/%E0%A4%A", { method: "POST", body: "{}" })).status, 400, "a malformed encoding is refused");
    assert.equal((await viaToken("/admin/api/client-release")).status, 200, "the release status still reads");
    assert.equal((await viaToken("/admin/api/devices")).status, 200, "reading stays open");
    for (const key of ["deviceApproval", "devicePairing", "publicBaseUrl", "publicDirectBaseUrl", "downloadLinkTtl", "clientSource", "clientReleaseRepo", "clientReleaseTag", "clientReleaseAsset"]) {
      const refused = await viaToken("/admin/api/server-settings", { method: "POST", body: JSON.stringify({ [key]: null, backupDays: 7 }) });
      assert.equal(refused.status, 403, key);
      assert.equal((await refused.json()).field, key);
    }
    const allowed = await viaToken("/admin/api/server-settings", { method: "POST", body: JSON.stringify({ backupDays: 9 }) });
    assert.equal(allowed.status, 200, "other settings still change");
    assert.deepEqual((await allowed.json()).changed, ["backupDays"]);
    assert.equal((await viaToken("/admin/api/library/rescan", { method: "POST", body: "{}" })).status < 400, true, "library work still runs");
    assert.equal((await viaToken("/api/shop/info")).status, 401, "nothing outside the admin API");
    assert.equal((await viaToken("/admin/api/integrations", {}, made.token.slice(0, -2) + "xx")).status, 401);
    await post(`/admin/api/tokens/${made.id}/revoke`, {});
    assert.equal((await viaToken("/admin/api/integrations")).status, 401, "a revoked token stops at once");
  } finally {
    child.kill();
  }
});

test("setup can skip the authenticator: the admin account's sign-in then opens the admin page, with a warning", async () => {
  const port = 22900 + (process.pid % 500);
  const base = `http://127.0.0.1:${port}`;
  const { child, log } = boot(port);
  const own = new Map();
  const jarLine = () => [...own].map(([k, v]) => `${k}=${v}`).join("; ");
  const keepOwn = (r) => { for (const c of r.headers.getSetCookie()) { const [kv] = c.split(";"); const i = kv.indexOf("="); own.set(kv.slice(0, i), kv.slice(i + 1)); } return r; };
  const send = async (url, body) => keepOwn(await fetch(`${base}${url}`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: base, Cookie: jarLine() }, body: JSON.stringify(body),
  }));
  try {
    await ready(base);
    const code = log().match(/setup code: ([A-Z0-9]{4}-[A-Z0-9]{4})/)?.[1];
    assert.equal((await send("/setup/api/otp/skip", {})).status, 401, "not before the setup code");
    assert.equal((await send("/setup/api/unlock", { code })).status, 200);
    assert.equal((await send("/setup/api/otp/skip", {})).status, 409, "not before the admin account exists");
    assert.equal((await send("/setup/api/account", { name: "boss", password: "long-enough-pass" })).status, 200);
    assert.deepEqual(await (await send("/setup/api/otp/skip", {})).json(), { ok: true, next: "done" });
    assert.equal((await send("/setup/api/unlock", { code })).status, 410, "setup is closed");

    let r = await fetch(`${base}/admin/`, { headers: { Accept: "text/html" }, redirect: "manual" });
    assert.ok(r.status >= 300, "a stranger still has to sign in first");
    r = await fetch(`${base}/admin/`, { headers: { Accept: "text/html", Cookie: jarLine() }, redirect: "manual" });
    assert.equal(r.status, 200, "the admin account's sign-in opens the admin page");
    assert.match(await r.text(), /CookingFoil 서버 관리/);
    const lock = await (await fetch(`${base}/admin/api/2fa`, { headers: { Accept: "application/json", Cookie: jarLine() } })).json();
    assert.equal(lock.skipped, true, "the settings card can warn about it");
  } finally {
    child.kill();
  }
});

test("the setup page warns before skipping the authenticator, in every language", async () => {
  const { setupPage } = await import("../../src/routes/setup-page.js");
  for (const lang of ["ko", "en", "ja", "zh"]) {
    const page = setupPage({ step: "otp", lang });
    assert.match(page, /data-api="otp\/skip" data-confirm="[^"]+"/, lang);
    assert.match(page, /class="warn">[^<]{40,}</, lang);
  }
});
