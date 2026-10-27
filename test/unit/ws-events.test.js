import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { WebSocket } from "ws";

// Bus events over the two page channels: who receives what. Nothing is replayed to a page that connects later.
process.env.COOK_DATA_DIR = mkdtempSync(path.join(tmpdir(), "cook-ws-events-"));
process.env.COOK_LOCKOUT_TRUST_LOOPBACK = "false";
const users = await import("../../src/security/users.js");
const ws = await import("../../src/realtime/ws-server.js");
const { issuePasswordSession } = await import("../../src/security/user-session.js");
const { issueSession } = await import("../../src/security/admin-session.js");
const { bus } = await import("../../src/realtime/events.js");

users.add("owner", "owner-password-1", "admin");
users.add("guest", "guest-password-1", "user");
users.add("other", "other-password-1", "user");

const server = http.createServer((_req, res) => res.end());
const channel = ws.attach(server, { heartbeatMs: 50 });
server.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const port = server.address().port;
const ORIGIN = `http://127.0.0.1:${port}`;
after(() => {
  channel.close();
  server.close();
});
beforeEach(() => ws.resetUpgradeLimitForTests());

const fakeReq = { secure: false, get: () => undefined, headers: {} };
function userCookie(name) {
  let line = "";
  issuePasswordSession(fakeReq, { append: (_n, v) => { line = v; } }, name);
  return line.split(";")[0];
}
function adminCookie() {
  let line = "";
  issueSession({ setHeader: (_n, v) => { line = v; } });
  return line.split(";")[0];
}

/** A connected page; `got` collects every frame, `next(type)` waits for the next one of that type. */
async function connect(pathName, cookie) {
  const client = new WebSocket(`ws://127.0.0.1:${port}${pathName}`, { headers: { Origin: ORIGIN, Cookie: cookie } });
  const got = [];
  const waiting = [];
  client.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    got.push(m);
    for (const w of [...waiting]) if (w.type === m.type) { waiting.splice(waiting.indexOf(w), 1); w.resolve(m); }
  });
  await new Promise((resolve, reject) => { client.once("open", resolve); client.once("error", reject); });
  // The greeting is sent right after the upgrade; wait for it so the connection is settled.
  const next = (type) => new Promise((resolve) => {
    const seen = got.find((m) => m.type === type && !m.taken);
    if (seen) { seen.taken = true; return resolve(seen); }
    waiting.push({ type, resolve: (m) => { m.taken = true; resolve(m); } });
  });
  await next(pathName === ws.ADMIN_PATH ? "activity" : "hello");
  return { client, got, next, events: () => got.filter((m) => m.type === "event") };
}
const settle = () => new Promise((r) => setTimeout(r, 40));

test("a page gets the events meant for everyone and for its own account, not another's", async () => {
  const guest = await connect("/ws/library", userCookie("guest"));
  const other = await connect("/ws/library", userCookie("other"));
  bus.publish({ topic: "notice", audience: { all: true }, payload: { title: "all" } });
  bus.publish({ topic: "notice", audience: { accounts: ["guest"] }, payload: { title: "guest only" } });
  bus.publish({ topic: "notice", audience: { admin: true }, payload: { title: "admins" } });
  await settle();
  assert.deepEqual(guest.events().map((e) => e.payload.title), ["all", "guest only"]);
  assert.deepEqual(other.events().map((e) => e.payload.title), ["all"]);
  guest.client.close();
  other.client.close();
});

test("an event frame has a topic and a payload, and never the audience", async () => {
  const page = await connect("/ws/library", userCookie("guest"));
  bus.publish({ topic: "notice", audience: { accounts: ["guest"] }, payload: { title: "x" } });
  await settle();
  assert.deepEqual(page.events(), [{ type: "event", topic: "notice", payload: { title: "x" } }]);
  page.client.close();
});

test("the library channel never shows the admin extra, even to an admin account", async () => {
  const page = await connect("/ws/library", userCookie("owner"));
  bus.publish({ topic: "review.queued", audience: { all: true }, payload: { what: "a file" }, adminExtra: { by: "guest" } });
  await settle();
  assert.deepEqual(page.events().at(-1).payload, { what: "a file" });
  page.client.close();
});

test("the admin channel gets admin events with the admin extra", async () => {
  const page = await connect(ws.ADMIN_PATH, `${userCookie("owner")}; ${adminCookie()}`);
  bus.publish({ topic: "review.queued", audience: { admin: true }, payload: { what: "a file" }, adminExtra: { by: "guest" } });
  await settle();
  assert.deepEqual(page.events().at(-1).payload, { what: "a file", by: "guest" });
  page.client.close();
});

test("a page that connects later is not given what it missed", async () => {
  bus.publish({ topic: "notice", audience: { all: true }, payload: { title: "before" } });
  const page = await connect("/ws/library", userCookie("guest"));
  await settle();
  assert.deepEqual(page.events(), []);
  page.client.send(JSON.stringify({ type: "resume", since: 0 }));
  await settle();
  assert.deepEqual(page.events(), [], "there is no resume: a page reads current state from the API");
  page.client.close();
});

const closedWithin = (client, ms) => new Promise((resolve) => {
  const timer = setTimeout(() => resolve(false), ms);
  client.once("close", () => { clearTimeout(timer); resolve(true); });
});

test("a page whose session ended stops receiving at the next heartbeat", async () => {
  users.add("leaver", "leaver-password-1", "user");
  const page = await connect("/ws/library", userCookie("leaver"));
  bus.publish({ topic: "notice", audience: { accounts: ["leaver"] }, payload: { n: 1 } });
  await settle();
  assert.equal(page.events().length, 1);
  users.setPassword("leaver", "leaver-password-2");
  assert.equal(await closedWithin(page.client, 1000), true, "the socket is closed once the session is no longer valid");
});

test("a page whose account was removed also stops receiving", async () => {
  users.add("gone", "gone-password-1", "user");
  const page = await connect("/ws/library", userCookie("gone"));
  users.remove("gone");
  assert.equal(await closedWithin(page.client, 1000), true);
});

test("a page whose session is still valid stays connected across heartbeats", async () => {
  const page = await connect("/ws/library", userCookie("guest"));
  assert.equal(await closedWithin(page.client, 300), false);
  bus.publish({ topic: "notice", audience: { accounts: ["guest"] }, payload: { n: 2 } });
  await settle();
  assert.equal(page.events().length, 1);
  page.client.close();
});
