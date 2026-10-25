import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sealedSecret, securityDbFile, seedRecords } from "../support/security-db.js";
import { open } from "../../src/security/secret-box.js";

// The server and this test share one data folder, so sessions sealed here are the server's.
const data = fs.mkdtempSync(path.join(os.tmpdir(), "cf-weblogin-"));
fs.mkdirSync(path.join(data, "games"));
fs.mkdirSync(path.join(data, "security"));
const now = Date.now();
await seedRecords(data, "google-account", {
  ok1: { sub: "ok1", email: "friend@example.com", status: "approved", createdAt: now, approvedAt: now, lastAt: now },
  wait1: { sub: "wait1", email: "new@example.com", status: "pending", createdAt: now, lastAt: now },
});
process.env.COOK_DATA_DIR = data;
process.env.COOK_ADMIN_EMAIL = "owner@example.com";
const oauth = await import("../../src/security/google-oauth.js");
const session = await import("../../src/security/user-session.js");
const accounts = await import("../../src/security/google-accounts.js");

const PORT = 18400 + (process.pid % 500);
const BASE = `http://127.0.0.1:${PORT}`;
const ALICE = "Basic " + Buffer.from("alice:alice-password").toString("base64");
const SECRET = "GOCSPX-test-secret-value";
const googleCookie = (sub) => `${session.SESSION_COOKIE}=${session.seal({ sub }, 60_000)}`;
const PAGE = { Accept: "text/html", "Sec-Fetch-Mode": "navigate" };

test("the ID token must come from Google, for this client, for this attempt, with a verified email", () => {
  const good = { iss: "https://accounts.google.com", aud: "cid", exp: now / 1000 + 300, nonce: "n", sub: "123", email: "A@Example.com", email_verified: true };
  assert.deepEqual(oauth.checkClaims(good, { clientId: "cid", nonce: "n", now }), { sub: "123", email: "a@example.com" });
  assert.equal(oauth.checkClaims({ ...good, iss: "evil" }, { clientId: "cid", nonce: "n", now }).error, "bad-issuer");
  assert.equal(oauth.checkClaims({ ...good, aud: "other" }, { clientId: "cid", nonce: "n", now }).error, "bad-audience");
  assert.equal(oauth.checkClaims({ ...good, exp: now / 1000 - 600 }, { clientId: "cid", nonce: "n", now }).error, "expired");
  assert.equal(oauth.checkClaims(good, { clientId: "cid", nonce: "other", now }).error, "bad-nonce");
  assert.equal(oauth.checkClaims({ ...good, email_verified: false }, { clientId: "cid", nonce: "n", now }).error, "unverified-email");
  assert.deepEqual(oauth.decodeIdToken(["x", Buffer.from(JSON.stringify(good)).toString("base64url"), "s"].join(".")), good);
  assert.equal(oauth.decodeIdToken("nope"), null);
});

test("the code is traded at Google's token endpoint with the PKCE verifier", async () => {
  let sent;
  const fetchImpl = async (url, init) => {
    sent = { url, body: Object.fromEntries(new URLSearchParams(init.body)) };
    return new Response(JSON.stringify({ id_token: `h.${Buffer.from('{"sub":"1"}').toString("base64url")}.s` }), { status: 200 });
  };
  assert.deepEqual(await oauth.exchangeCode({ code: "c", verifier: "v", clientId: "cid", clientSecret: "sec", redirectUri: "https://x/cb", fetchImpl }), { sub: "1" });
  assert.equal(sent.url, oauth.TOKEN_URL);
  assert.deepEqual(sent.body, { code: "c", code_verifier: "v", client_id: "cid", client_secret: "sec", redirect_uri: "https://x/cb", grant_type: "authorization_code" });
  await assert.rejects(oauth.exchangeCode({ code: "c", verifier: "v", clientId: "cid", clientSecret: "s", redirectUri: "r",
    fetchImpl: async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }) }), /invalid_grant/);
});

test("after signing in, the browser only goes to a page of this server", () => {
  for (const ok of ["/", "/pair/" + "a".repeat(32), "/device", "/admin", "/#retro"]) assert.equal(oauth.safeNext(ok), ok);
  for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "/login", "/auth/logout", "x", undefined]) assert.equal(oauth.safeNext(bad), "/", String(bad));
});

test("sessions are sealed: a forged or expired one names nobody", () => {
  const sealed = session.seal({ sub: "ok1" }, 1000, now);
  assert.deepEqual(session.unseal(sealed, now), { sub: "ok1" });
  assert.equal(session.unseal(sealed, now + 2000), null);
  assert.equal(session.unseal(sealed.slice(0, -2) + "xx", now), null);
});

test("a new Google account waits for approval; the owner's address doesn't", () => {
  assert.equal(accounts.signIn({ sub: "t-new", email: "someone@example.com" }).status, "pending");
  assert.equal(accounts.signIn({ sub: "t-owner", email: "Owner@example.com" }).status, "approved");
  assert.ok(accounts.remove("t-new") && accounts.remove("t-owner"));
});

async function boot() {
  const child = spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: { ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: data, COOK_GAMES_DIR: path.join(data, "games"),
      COOK_AUTH_USERS: "alice:alice-password", COOK_ADMIN_PASSWORD: "admin-password-123", COOK_DEVICE_PAIRING: "true",
      COOK_AUTH_MAX_FAILURES: "3", COOK_TITLEDB_AUTO_FETCH: "false", COOK_LOCKOUT_TRUST_LOOPBACK: "false" },
    stdio: "ignore",
  });
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

// fetch() always sends Sec-Fetch-Mode: cors; a page load needs a plain request.
function get(p, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get(`${BASE}${p}`, { headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        const h = new Headers();
        for (const [k, v] of Object.entries(res.headers)) for (const one of [].concat(v)) h.append(k, one);
        resolve({ status: res.statusCode, headers: h, text: async () => body, json: async () => JSON.parse(body) });
      });
    }).on("error", reject);
  });
}
const setCookie = (r, name) => r.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
const status = async (key) => (await fetch(`${BASE}/api/pair/status`, { headers: { "X-Device-Key": key } })).json();

/** A browser: a cookie jar and the CSRF token its pages carry. */
async function browser() {
  const page = await get("/login", PAGE);
  const csrfCookie = setCookie(page, "cf_csrf").split(";")[0];
  const csrf = csrfCookie.split("=")[1];
  assert.ok((await page.text()).includes(`value="${csrf}"`), "the form carries the token");
  const jar = { csrf: csrfCookie };
  const cookie = () => Object.values(jar).join("; ");
  const login = (username, password, next = "/", token = csrf) => fetch(`${BASE}/login`, {
    method: "POST", redirect: "manual", headers: { Cookie: cookie(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password, csrf: token, next }),
  });
  const post = (p, body, extra = {}) => fetch(`${BASE}${p}`, {
    method: "POST", headers: { Cookie: cookie(), "Content-Type": "application/json", Origin: BASE, "X-CSRF-Token": csrf, ...extra }, body: JSON.stringify(body),
  });
  return { jar, csrf, cookie, login, post, page: (p) => get(p, { ...PAGE, Cookie: cookie() }) };
}

test("people sign in with a form; a password alone opens nothing else; Google is an optional extra", async () => {
  const server = await boot();
  try {
    // No popup for a browser: pages go to /login, a page's own fetches get a bare 401.
    const home = await get("/", PAGE);
    assert.equal(home.status, 302);
    assert.equal(home.headers.get("location"), "/login?next=%2F");
    assert.equal(home.headers.get("www-authenticate"), null);
    const xhr = await get("/api/shop/sections", { "Sec-Fetch-Mode": "cors" });
    assert.equal(xhr.status, 401);
    assert.equal(xhr.headers.get("www-authenticate"), null);
    const stale = await get("/api/shop/sections", { "Sec-Fetch-Mode": "cors", Authorization: "Basic " + Buffer.from("alice:old").toString("base64") });
    assert.equal(stale.headers.get("www-authenticate"), null, "nor with stale saved credentials");
    // Nobody is ever asked for Basic, and a right password alone is no credential.
    assert.equal((await get("/api/shop/sections")).headers.get("www-authenticate"), null);
    const basicOnly = await get("/api/shop/sections", { Authorization: ALICE });
    assert.equal(basicOnly.status, 401);
    assert.equal(basicOnly.headers.get("www-authenticate"), null);

    const b = await browser();
    const form = await (await get("/login", PAGE)).text();
    assert.match(form, /name="username"/);
    assert.doesNotMatch(form, /auth\/google\/start/, "no Google button while Google sign-in is off");
    assert.equal((await b.login("alice", "alice-password", "/", "x".repeat(43))).status, 403, "a wrong CSRF token");
    assert.equal((await b.login("alice", "wrong")).status, 401);
    const ok = await b.login("alice", "alice-password", "/#retro");
    assert.equal(ok.status, 303);
    assert.equal(ok.headers.get("location"), "/#retro");
    const userCookie = setCookie(ok, "cf_user");
    assert.match(userCookie, /HttpOnly; SameSite=Lax; Path=\//);
    b.jar.user = userCookie.split(";")[0];
    assert.equal((await b.page("/")).status, 200);
    const me = await (await get("/auth/me", { Cookie: b.cookie() })).json();
    assert.equal(me.user, "alice");

    // The console's QR, with the ID and password only.
    const KEY = "E1".repeat(32);
    const pending = await status(KEY);
    const token = new URL(pending.pairUrl).pathname.split("/").pop();
    assert.equal((await get(`/pair/${token}`, PAGE)).headers.get("location"), `/login?next=${encodeURIComponent(`/pair/${token}`)}`);
    const confirm = await b.page(`/pair/${token}`);
    assert.equal(confirm.status, 200);
    assert.ok((await confirm.text()).includes(pending.pairCode));
    assert.equal((await b.post("/auth/device/approve", { token }, { "X-CSRF-Token": "nope" })).status, 403);
    assert.equal((await b.post("/auth/device/approve", { token, label: "거실" })).status, 200);
    assert.equal((await status(KEY)).status, "approved");
    const KEY2 = "F2".repeat(32);
    const second = await status(KEY2);
    assert.equal((await b.page("/device")).status, 200);
    assert.equal((await b.post("/auth/device/approve", { code: second.pairCode })).status, 200, "the 8-character code works too");

    // The admin turns Google sign-in on from /admin; the secret never comes back.
    const web = { Cookie: b.cookie(), Origin: BASE, "X-CSRF-Token": b.csrf, "Content-Type": "application/json" };
    const admin = await fetch(`${BASE}/admin/verify`, { method: "POST", headers: web, body: JSON.stringify({ password: "admin-password-123" }) });
    const A = { ...web, Cookie: `${b.cookie()}; ${setCookie(admin, "cf_admin").split(";")[0]}` };
    const adminPost = (p, body) => fetch(`${BASE}${p}`, { method: "POST", headers: A, body: JSON.stringify(body) });
    let g = await (await fetch(`${BASE}/admin/api/google`, { headers: A })).json();
    assert.deepEqual([g.enabled, g.active, g.hasSecret, g.redirectUri], [false, false, false, `${BASE}/auth/google/callback`]);
    assert.equal((await adminPost("/admin/api/google", { enabled: true, clientId: "test-client.apps.googleusercontent.com" })).status, 400, "on needs a secret");
    const saved = await adminPost("/admin/api/google", { enabled: true, clientId: "test-client.apps.googleusercontent.com", clientSecret: SECRET });
    const savedText = await saved.text();
    assert.equal(saved.status, 200);
    assert.ok(!savedText.includes(SECRET), "the secret is not echoed");
    assert.equal(JSON.parse(savedText).active, true);
    assert.match(await (await get("/login", PAGE)).text(), /auth\/google\/start/, "now the login page has the Google button");
    const start = await get("/auth/google/start?next=/device");
    const to = new URL(start.headers.get("location"));
    assert.equal(to.origin + to.pathname, oauth.AUTH_URL);
    assert.equal(to.searchParams.get("client_id"), "test-client.apps.googleusercontent.com");
    assert.equal(to.searchParams.get("code_challenge_method"), "S256");
    assert.match((await get("/auth/google/callback?state=x&code=y")).headers.get("location"), /^\/login\?error=1/, "no attempt cookie, no sign-in");
    g = await (await adminPost("/admin/api/google", { enabled: true, clientId: "test-client.apps.googleusercontent.com", clientSecret: "" })).json();
    assert.equal(g.active, true, "an empty secret field keeps the saved secret");
    assert.ok(!open(sealedSecret(data, "google-oauth")).toString("utf8").includes("undefined"));
    assert.equal((fs.statSync(securityDbFile(data)).mode & 0o777), 0o600);

    // Google accounts: approved ones sign in to the web; waiting ones are told so.
    assert.equal((await get("/", { ...PAGE, Cookie: googleCookie("ok1") })).status, 200);
    assert.match(await (await get("/login", { ...PAGE, Cookie: googleCookie("wait1") })).text(), /기다리고 있습니다|waiting/);
    assert.equal((await get("/", { ...PAGE, Cookie: googleCookie("wait1") })).status, 302);
    const listed = await (await fetch(`${BASE}/admin/api/accounts`, { headers: A })).json();
    assert.deepEqual(listed.accounts.map((a) => [a.email, a.status]), [["new@example.com", "pending"], ["friend@example.com", "approved"]]);
    assert.equal((await adminPost("/admin/api/accounts/status", { sub: "wait1", status: "approved" })).status, 200);
    assert.equal((await get("/", { ...PAGE, Cookie: googleCookie("wait1") })).status, 200);

    const off = await (await adminPost("/admin/api/google/clear", {})).json();
    assert.deepEqual([off.active, off.hasSecret, off.clientId], [false, false, ""]);
    assert.doesNotMatch(await (await get("/login", PAGE)).text(), /auth\/google\/start/);
    assert.equal((await fetch(`${BASE}/admin/api/google`, { headers: { Authorization: ALICE } })).status, 401, "admin session only");

    // Sign out, then a lockout after repeated wrong passwords.
    assert.equal((await b.post("/auth/logout", {}, { "X-CSRF-Token": "nope" })).status, 403);
    const out = await b.post("/auth/logout", {});
    assert.equal(out.status, 200);
    assert.match(setCookie(out, "cf_user"), /Max-Age=0/);
    for (let i = 0; i < 3; i++) await b.login("alice", "wrong");
    const locked = await b.login("alice", "alice-password");
    assert.equal(locked.status, 429, "locked: even the right password waits for the admin");
  } finally {
    server.kill("SIGKILL");
  }
});

/** Open /ws/library: the status, and any WWW-Authenticate challenge in the answer. */
function upgrade(headers) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${BASE}/ws/library`, { headers: {
      Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==", ...headers,
    } });
    req.on("upgrade", (res, socket) => { socket.destroy(); resolve({ status: 101, challenge: null }); });
    req.on("response", (res) => { res.resume(); resolve({ status: res.statusCode, challenge: res.headers["www-authenticate"] ?? null }); });
    req.on("error", reject);
    req.end();
  });
}

test("a signed-in page's live updates need no password, and a password opens none", async () => {
  const server = await boot();
  try {
    assert.deepEqual(await upgrade({ Origin: BASE, Cookie: googleCookie("ok1") }), { status: 101, challenge: null }, "Google sign-in is enough");
    assert.deepEqual(await upgrade({ Origin: BASE }), { status: 401, challenge: null }, "a page is never challenged");
    assert.equal((await upgrade({ Origin: "https://evil.example", Cookie: googleCookie("ok1") })).status, 403, "another site's page is refused before any check");
    assert.equal((await upgrade({ Origin: BASE, Cookie: googleCookie("nobody") })).status, 401, "no such account");
    assert.deepEqual(await upgrade({ Authorization: ALICE }), { status: 401, challenge: null }, "Basic opens nothing");
    assert.equal((await upgrade({})).challenge, null, "nobody is asked for it");
  } finally {
    server.kill("SIGKILL");
  }
});

test("a Google admin opens /admin without the admin password; other Google accounts still need it", async () => {
  // The owner's address is made admin when it first signs in.
  accounts.signIn({ sub: "t-boss", email: "Owner@example.com" });
  assert.equal(accounts.isAdmin("t-boss"), true);
  const server = await boot();
  try {
    const page = await get("/admin", { ...PAGE, Cookie: googleCookie("t-boss") });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /id="tab-overview"/, "the administration overview itself, not the password gate");
    assert.equal((await fetch(`${BASE}/admin/api/stats`, { headers: { Cookie: googleCookie("t-boss") } })).status, 200);
    assert.ok([401, 403].includes((await fetch(`${BASE}/admin/api/stats`, { headers: { Cookie: googleCookie("ok1") } })).status), "an approved non-admin account is turned away");
    assert.doesNotMatch(await (await get("/admin", { ...PAGE, Cookie: googleCookie("ok1") })).text(), /id="tab-overview"/);
  } finally {
    server.kill("SIGKILL");
    accounts.remove("t-boss");
  }
});
