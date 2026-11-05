import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Nobody gets shut out of their own server by a typo, a closed window or a wrong password.
process.env.COOK_DATA_DIR = mkdtempSync(path.join(tmpdir(), "cook-lockout-"));
process.env.COOK_PUBLIC_BASE_URL = "https://typo.example.com";
process.env.COOK_ADMIN_EMAIL = "owner@example.com";
const express = (await import("express")).default;
const { mountManageApi } = await import("../../src/routes/admin/manage-api.js");
const users = await import("../../src/security/users.js");
const store = await import("../../src/security/store.js");
const session = await import("../../src/security/user-session.js");
const accounts = await import("../../src/security/google-accounts.js");
const { recordFailure } = await import("../../src/security/auth-guard.js");
const accessGuard = (await import("../../src/security/access-guard.js")).default;
const setupRouter = (await import("../../src/routes/setup.js")).default;

const app = express();
app.use(express.json());
app.post("/signin/:name", (req, res) => {
  session.issuePasswordSession(req, res, req.params.name);
  res.json({ ok: true });
});
app.post("/signin-passkey/:name", (req, res) => {
  session.issuePasskeySession(req, res, req.params.name);
  res.json({ ok: true });
});
app.post("/signin-google/:sub", (req, res) => {
  session.issueUserSession(req, res, req.params.sub);
  res.json({ ok: true });
});
const manage = express.Router();
manage.use((req, _res, next) => {
  req.webUser = session.webUser(req);
  next();
});
mountManageApi(manage, () => true);
app.use("/admin", manage);
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const guarded = express();
guarded.use(accessGuard());
guarded.get("/", (_req, res) => res.send("open"));
const guardedServer = guarded.listen(0, "127.0.0.1");
await new Promise((r) => guardedServer.once("listening", r));
const GUARDED = `http://127.0.0.1:${guardedServer.address().port}`;

const setupApp = express();
setupApp.use(setupRouter());
const setupServer = setupApp.listen(0, "127.0.0.1");
await new Promise((r) => setupServer.once("listening", r));
const SETUP = `http://127.0.0.1:${setupServer.address().port}`;

after(() => {
  server.close();
  guardedServer.close();
  setupServer.close();
});

const PROXIED = { "X-Forwarded-For": "198.51.100.7" };
const send = (method, url, { origin = BASE, cookie, body } = {}) => fetch(`${BASE}${url}`, {
  method,
  headers: { "Content-Type": "application/json", Origin: origin, ...(cookie ? { Cookie: cookie } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});
const cookieOf = (r) => r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
const signedInAs = async (name) => cookieOf(await fetch(`${BASE}/signin/${name}`, { method: "POST" }));
const whoIs = (cookie) => session.webUser({ headers: { cookie }, get: () => undefined });

beforeEach(() => {
  const everyone = users.list().sort((a, b) => Number(a.role === "admin") - Number(b.role === "admin"));
  for (const u of everyone) users.remove(u.name, { allowEmpty: true });
  store.unlock("127.0.0.1");
  store.clearFailure("127.0.0.1");
});

test("a wrong public address does not refuse the save that fixes it", async () => {
  users.add("owner", "owner-password-1", "admin");
  const r = await send("POST", "/admin/api/users", { body: { name: "second", password: "second-password-1" } });
  assert.equal(r.status, 201);
});

test("the pinned public address still counts as this site, another site does not", async () => {
  users.add("owner", "owner-password-1", "admin");
  const pinned = await send("POST", "/admin/api/users", { origin: "https://typo.example.com", body: { name: "third", password: "third-password-1" } });
  assert.equal(pinned.status, 201);
  const other = await send("POST", "/admin/api/users", { origin: "https://evil.example.net", body: { name: "fourth", password: "fourth-password-1" } });
  assert.equal(other.status, 403);
  assert.ok(!users.list().some((u) => u.name === "fourth"));
});

test("resetting your own password keeps this browser signed in and ends the old session", async () => {
  users.add("owner", "owner-password-1", "admin");
  const before = await signedInAs("owner");
  assert.equal(whoIs(before)?.name, "owner");
  const r = await send("POST", "/admin/api/users/owner/password", { cookie: before });
  assert.equal(r.status, 200);
  assert.equal(whoIs(before), null, "the old cookie no longer works");
  assert.equal(whoIs(cookieOf(r))?.name, "owner", "the new cookie does");
});

test("resetting someone else's password does not sign you in as them", async () => {
  users.add("owner", "owner-password-1", "admin");
  users.add("friend", "friend-password-1", "user");
  const r = await send("POST", "/admin/api/users/friend/password", { cookie: await signedInAs("owner") });
  assert.equal(r.status, 200);
  assert.equal(cookieOf(r), "");
});

test("making the first account signs its maker in, and it is an admin whatever role was sent", async () => {
  const r = await send("POST", "/admin/api/users", { body: { name: "first", password: "first-password-1", role: "user" } });
  assert.equal(r.status, 201);
  assert.equal(whoIs(cookieOf(r))?.name, "first");
  assert.ok(users.isAdmin("first"));
  const second = await send("POST", "/admin/api/users", { cookie: cookieOf(r), body: { name: "second", password: "second-password-1" } });
  assert.equal(cookieOf(second), "");
});

test("resetting your own password from a passkey session keeps it a passkey session", async () => {
  users.add("owner", "owner-password-1", "admin");
  const before = cookieOf(await fetch(`${BASE}/signin-passkey/owner`, { method: "POST" }));
  const r = await send("POST", "/admin/api/users/owner/password", { cookie: before });
  assert.equal(r.status, 200);
  const sealed = cookieOf(r).split("=").slice(1).join("=");
  assert.equal(session.unseal(sealed)?.pk, 1);
});

test("a Google admin making the first account stays themselves", async () => {
  accounts.signIn({ sub: "google-owner", email: "owner@example.com" });
  const cookie = cookieOf(await fetch(`${BASE}/signin-google/google-owner`, { method: "POST" }));
  assert.equal(whoIs(cookie)?.kind, "google");
  const r = await send("POST", "/admin/api/users", { cookie, body: { name: "friend", password: "friend-password-1" } });
  assert.equal(r.status, 201);
  assert.equal(cookieOf(r), "");
});

test("the last account cannot be deleted, even when asked to empty the server", async () => {
  users.add("owner", "owner-password-1", "admin");
  const r = await send("DELETE", "/admin/api/users/owner?allowEmpty=1");
  assert.equal(r.status, 409);
  assert.equal((await r.json()).code, "account.last");
  assert.ok(users.list().some((u) => u.name === "owner"));
});

test("a lock from failed sign-ins ends by itself within the hour", () => {
  for (let i = 0; i < 5; i += 1) recordFailure("127.0.0.1", { headers: {}, socket: { remoteAddress: "127.0.0.1" } });
  assert.ok(store.isLocked("127.0.0.1"));
  const left = store.lockRemainingMs("127.0.0.1");
  assert.ok(left > 0 && left <= 60 * 60 * 1000, `remaining ${left}`);
});

test("a finished lock starts the count over, so one typo does not lock again", async () => {
  store.setFailure("127.0.0.1", { count: 5, firstAt: Date.now(), lastAt: Date.now() });
  store.lock("127.0.0.1", { reason: "test", ttlMs: 1 });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(store.isLocked("127.0.0.1"), false);
  recordFailure("127.0.0.1", { headers: {}, socket: { remoteAddress: "127.0.0.1" } });
  assert.equal(store.isLocked("127.0.0.1"), false);
});

test("a lock from probing ends by itself too", async () => {
  for (let i = 0; i < 5 && !store.isLocked("127.0.0.1"); i += 1) {
    await fetch(`${GUARDED}/.env`, { headers: PROXIED });
  }
  assert.ok(store.isLocked("127.0.0.1"));
  const left = store.lockRemainingMs("127.0.0.1");
  assert.ok(left > 0 && left <= 60 * 60 * 1000, `remaining ${left}`);
});

test("a browser at a locked address reads when it opens, in its own language", async () => {
  store.lock("127.0.0.1", { reason: "test", ttlMs: 10 * 60 * 1000 });
  const r = await fetch(GUARDED, { headers: { ...PROXIED, Accept: "text/html", "Accept-Language": "ko" } });
  assert.equal(r.status, 429);
  assert.match(r.headers.get("content-type"), /html/);
  const page = await r.text();
  assert.match(page, /이 주소가 잠겼습니다/);
  assert.match(page, /10분 뒤에 풀립니다/);
});

test("a lock with no end says who can open it instead of a time", async () => {
  store.lock("127.0.0.1", { reason: "test" });
  const r = await fetch(GUARDED, { headers: { ...PROXIED, Accept: "text/html", "Accept-Language": "en" } });
  const page = await r.text();
  assert.match(page, /An admin has to open it/);
  assert.doesNotMatch(page, /opens again/);
});

test("a console at a locked address keeps the plain line and the wait", async () => {
  store.lock("127.0.0.1", { reason: "test", ttlMs: 10 * 60 * 1000 });
  const r = await new Promise((resolve, reject) => {
    http.get(GUARDED, { headers: PROXIED }, resolve).on("error", reject);
  });
  r.resume();
  assert.equal(r.statusCode, 429);
  assert.match(r.headers["content-type"], /text\/plain/);
  assert.ok(Number(r.headers["retry-after"]) > 0);
});

test("the machine reading the log is not locked out of setup, and a wrong code does not lock it", async () => {
  store.lock("127.0.0.1", { reason: "test" });
  const post = (headers = {}) => fetch(`${SETUP}/setup/api/unlock`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ code: "WRONG-CODE" }),
  });
  const own = await post();
  assert.equal(own.status, 401);
  assert.equal(store.lockRemainingMs("127.0.0.1"), null);
  const elsewhere = await post({ ...PROXIED, "Accept-Language": "en" });
  assert.equal(elsewhere.status, 429);
  assert.match((await elsewhere.json()).message, /locked/);
});
