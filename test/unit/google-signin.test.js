import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The server and this test share one data folder, so sessions sealed here are the server's.
const data = fs.mkdtempSync(path.join(os.tmpdir(), "cf-google-"));
fs.mkdirSync(path.join(data, "games"));
fs.mkdirSync(path.join(data, "security"));
const now = Date.now();
fs.writeFileSync(path.join(data, "security", "google-accounts.json"), JSON.stringify({ version: 1, accounts: {
  ok1: { sub: "ok1", email: "friend@example.com", status: "approved", createdAt: now, approvedAt: now, lastAt: now },
  wait1: { sub: "wait1", email: "new@example.com", status: "pending", createdAt: now, lastAt: now },
} }));
process.env.COOK_DATA_DIR = data;
process.env.COOK_ADMIN_EMAIL = "owner@example.com";
const oauth = await import("../../src/security/google-oauth.js");
const session = await import("../../src/security/user-session.js");
const accounts = await import("../../src/security/google-accounts.js");

const PORT = 18400 + (process.pid % 500);
const BASE = `http://127.0.0.1:${PORT}`;
const ALICE = "Basic " + Buffer.from("alice:alice-password").toString("base64");
const cookieOf = (sub) => `${session.SESSION_COOKIE}=${session.seal({ sub }, 60_000)}`;

test("the ID token must come from Google, for this client, for this attempt, with a verified email", () => {
  const good = { iss: "https://accounts.google.com", aud: "cid", exp: now / 1000 + 300, nonce: "n", sub: "123", email: "A@Example.com", email_verified: true };
  assert.deepEqual(oauth.checkClaims(good, { clientId: "cid", nonce: "n", now }), { sub: "123", email: "a@example.com" });
  assert.equal(oauth.checkClaims({ ...good, iss: "evil" }, { clientId: "cid", nonce: "n", now }).error, "bad-issuer");
  assert.equal(oauth.checkClaims({ ...good, aud: "other" }, { clientId: "cid", nonce: "n", now }).error, "bad-audience");
  assert.equal(oauth.checkClaims({ ...good, exp: now / 1000 - 600 }, { clientId: "cid", nonce: "n", now }).error, "expired");
  assert.equal(oauth.checkClaims(good, { clientId: "cid", nonce: "other", now }).error, "bad-nonce");
  assert.equal(oauth.checkClaims({ ...good, email_verified: false }, { clientId: "cid", nonce: "n", now }).error, "unverified-email");
  const token = ["x", Buffer.from(JSON.stringify(good)).toString("base64url"), "sig"].join(".");
  assert.deepEqual(oauth.decodeIdToken(token), good);
  assert.equal(oauth.decodeIdToken("nope"), null);
});

test("the code is traded at Google's token endpoint with the PKCE verifier", async () => {
  let sent;
  const claims = { sub: "1" };
  const fetchImpl = async (url, init) => {
    sent = { url, body: Object.fromEntries(new URLSearchParams(init.body)) };
    return new Response(JSON.stringify({ id_token: `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s` }), { status: 200 });
  };
  const out = await oauth.exchangeCode({ code: "c", verifier: "v", clientId: "cid", clientSecret: "sec", redirectUri: "https://x/cb", fetchImpl });
  assert.deepEqual(out, claims);
  assert.equal(sent.url, oauth.TOKEN_URL);
  assert.deepEqual(sent.body, { code: "c", code_verifier: "v", client_id: "cid", client_secret: "sec", redirect_uri: "https://x/cb", grant_type: "authorization_code" });
  await assert.rejects(oauth.exchangeCode({ code: "c", verifier: "v", clientId: "cid", clientSecret: "s", redirectUri: "r",
    fetchImpl: async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }) }), /invalid_grant/);
});

test("after signing in, the browser only ever goes back to this server's approval pages", () => {
  const t = "a".repeat(32);
  assert.equal(oauth.safeNext(`/pair/${t}`), `/pair/${t}`);
  assert.equal(oauth.safeNext(`/admin/pair/${t}`), `/admin/pair/${t}`);
  for (const bad of ["https://evil.example", "//evil.example", "/admin", `/pair/${t}?x`, undefined]) assert.equal(oauth.safeNext(bad), "/device", String(bad));
});

test("sessions are sealed: a forged or expired one names nobody", () => {
  const sealed = session.seal({ sub: "ok1" }, 1000, now);
  assert.deepEqual(session.unseal(sealed, now), { sub: "ok1" });
  assert.equal(session.unseal(sealed, now + 2000), null);
  assert.equal(session.unseal(sealed.slice(0, -2) + "xx", now), null);
  assert.equal(session.unseal("garbage", now), null);
});

test("a new account waits for approval; the owner's address doesn't", () => {
  assert.equal(accounts.signIn({ sub: "t-new", email: "someone@example.com" }).status, "pending");
  assert.equal(accounts.signIn({ sub: "t-owner", email: "Owner@example.com" }).status, "approved");
  assert.equal(accounts.signIn({ sub: "t-new", email: "someone@example.com" }).status, "pending", "signing in again changes nothing");
  assert.ok(accounts.remove("t-new") && accounts.remove("t-owner"));
});

async function boot() {
  const child = spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: { ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: data, COOK_GAMES_DIR: path.join(data, "games"),
      COOK_AUTH_USERS: "alice:alice-password", COOK_ADMIN_PASSWORD: "admin-password-123", COOK_DEVICE_PAIRING: "true",
      COOK_GOOGLE_CLIENT_ID: "test-client.apps.googleusercontent.com", COOK_GOOGLE_CLIENT_SECRET: "test-secret",
      COOK_TITLEDB_AUTO_FETCH: "false", COOK_LOCKOUT_TRUST_LOOPBACK: "false" },
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

const get = (p, cookie) => fetch(`${BASE}${p}`, { redirect: "manual", headers: cookie ? { Cookie: cookie } : {} });
const approve = (body, cookie, origin = BASE) => fetch(`${BASE}/auth/device/approve`, {
  method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie, ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body),
});
const status = async (key) => (await fetch(`${BASE}/api/pair/status`, { headers: { "X-Device-Key": key } })).json();

test("a phone scans the QR, signs in with Google and approves the console with one button", async () => {
  const server = await boot();
  try {
    const login = await get("/login");
    assert.equal(login.status, 200, "no shop password on the phone");
    assert.match(await login.text(), /Google/);

    const start = await get("/auth/google/start?next=/device");
    assert.equal(start.status, 302);
    const to = new URL(start.headers.get("location"));
    assert.equal(to.origin + to.pathname, oauth.AUTH_URL);
    assert.equal(to.searchParams.get("redirect_uri"), `${BASE}/auth/google/callback`);
    assert.equal(to.searchParams.get("code_challenge_method"), "S256");
    assert.match(start.headers.get("set-cookie"), /cf_oauth=.+; HttpOnly; SameSite=Lax; Path=\/auth\/google/);
    const forged = await get("/auth/google/callback?state=x&code=y");
    assert.match(forged.headers.get("location"), /^\/login\?error=1/, "no attempt cookie, no sign-in");

    const KEY = "E1".repeat(32);
    const pending = await status(KEY);
    assert.equal(pending.status, "pending");
    const token = new URL(pending.pairUrl).pathname.split("/").pop();
    for (const p of [`/pair/${token}`, `/admin/pair/${token}`]) {
      const r = await get(p);
      assert.equal(r.status, 302, p);
      assert.equal(r.headers.get("location"), `/login?next=${encodeURIComponent(p)}`);
    }
    const waiting = await get(`/login?next=/pair/${token}`, cookieOf("wait1"));
    assert.match(await waiting.text(), /승인을 기다립니다|Waiting for approval/);
    assert.equal((await get(`/pair/${token}`, cookieOf("wait1"))).status, 302, "a pending account can't approve");
    assert.equal((await approve({ token }, cookieOf("wait1"))).status, 401);

    const page = await get(`/pair/${token}`, cookieOf("ok1"));
    assert.equal(page.status, 200);
    assert.ok((await page.text()).includes(pending.pairCode), "the console's code is shown to compare");
    assert.equal((await get(`/login?next=/pair/${token}`, cookieOf("ok1"))).headers.get("location"), `/pair/${token}`, "an approved account goes straight back");
    assert.equal((await approve({ token }, cookieOf("ok1"), null)).status, 403, "the browser's own origin only");
    assert.equal((await approve({ token, label: "거실" }, cookieOf("ok1"))).status, 200);
    assert.equal((await approve({ token }, cookieOf("ok1"))).status, 409);
    const approved = await status(KEY);
    assert.equal(approved.status, "approved");
    assert.ok(approved.accessKey);

    const KEY2 = "F2".repeat(32);
    const second = await status(KEY2);
    assert.equal((await approve({ code: "ZZZZZZZZ" }, cookieOf("ok1"))).status, 404);
    assert.equal((await approve({ code: second.pairCode.toLowerCase() }, cookieOf("ok1"))).status, 200, "the 8-character code works too");
    assert.equal((await status(KEY2)).status, "approved");

    assert.equal((await get(`/admin/pair/${token}?admin=1`)).status, 401, "the admin's own page stays behind the shop sign-in");

    const admin = await fetch(`${BASE}/admin/verify`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: ALICE }, body: JSON.stringify({ password: "admin-password-123" }) });
    const adminHeaders = { Authorization: ALICE, Cookie: admin.headers.get("set-cookie").split(";")[0], "Content-Type": "application/json" };
    const listed = await (await fetch(`${BASE}/admin/api/accounts`, { headers: adminHeaders })).json();
    assert.equal(listed.enabled, true);
    assert.deepEqual(listed.accounts.map((a) => [a.email, a.status]), [["new@example.com", "pending"], ["friend@example.com", "approved"]]);
    const devices = await (await fetch(`${BASE}/admin/api/devices`, { headers: adminHeaders })).json();
    assert.ok(devices.approved.some((d) => d.addedBy === "google:friend@example.com" && d.label === "거실"));
    const ok = await fetch(`${BASE}/admin/api/accounts/status`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ sub: "wait1", status: "approved" }) });
    assert.equal(ok.status, 200);
    assert.equal((await get("/device", cookieOf("wait1"))).status, 200, "approved by the admin, the account can approve consoles now");
    assert.equal((await fetch(`${BASE}/admin/api/accounts`, { headers: { Authorization: ALICE } })).status, 401, "admin session only");
  } finally {
    server.kill("SIGKILL");
  }
});
