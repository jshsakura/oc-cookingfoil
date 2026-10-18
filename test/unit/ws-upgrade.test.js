import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The /ws/library upgrade: a per-address limit and a same-host Origin check
// before the sign-in check, which takes this site's own signed-in page only.
// A password (Basic) opens nothing here.
process.env.COOK_DATA_DIR = mkdtempSync(path.join(tmpdir(), "cook-ws-upgrade-"));
// Loopback is a real remote here, so the lockout applies to the test client.
process.env.COOK_LOCKOUT_TRUST_LOOPBACK = "false";
const users = await import("../../src/security/users.js");
const store = await import("../../src/security/store.js");
const ws = await import("../../src/realtime/ws-server.js");
const session = await import("../../src/security/user-session.js");
const { clientAddress } = await import("../../src/helpers/trust-proxy.js");

users.add("alice", "alice-password-1");

const server = http.createServer((_req, res) => res.end());
const channel = ws.attach(server);
server.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const port = server.address().port;
after(() => {
  channel.close();
  server.close();
});

beforeEach(() => {
  ws.resetUpgradeLimitForTests();
  store.unlock("127.0.0.1");
});

const basic = (user, pass) => "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
const page = () => ({
  Origin: `http://127.0.0.1:${port}`,
  Cookie: `${session.SESSION_COOKIE}=${session.seal({ user: "alice", s: users.sessionStamp("alice") }, 60_000)}`,
});

function upgrade(headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1", port, path: "/ws/library",
      headers: {
        Connection: "Upgrade", Upgrade: "websocket",
        "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
        ...headers,
      },
    });
    req.on("upgrade", (res, socket) => {
      socket.destroy();
      resolve({ status: res.statusCode, headers: res.headers });
    });
    req.on("response", (res) => {
      res.resume();
      resolve({ status: res.statusCode, headers: res.headers });
    });
    req.on("error", reject);
    req.end();
  });
}

test("this site's signed-in page upgrades; a password, nothing or a stale cookie get 401 with no challenge", async () => {
  assert.equal((await upgrade(page())).status, 101);
  for (const headers of [{ Authorization: basic("alice", "alice-password-1") }, {}, { Origin: `http://127.0.0.1:${port}` }, { Cookie: page().Cookie }]) {
    const r = await upgrade(headers);
    assert.equal(r.status, 401, JSON.stringify(Object.keys(headers)));
    assert.equal(r.headers["www-authenticate"], undefined);
  }
});

test("another site's Origin is refused before the sign-in check", async () => {
  const r = await upgrade({ ...page(), Origin: "https://evil.example.net" });
  assert.equal(r.status, 403);
});

test("too many upgrades from one address get 429 with Retry-After", async () => {
  const statuses = [];
  for (let i = 0; i < 12; i++) statuses.push((await upgrade()).status);
  assert.deepEqual(statuses.slice(0, 10), Array(10).fill(401));
  const r = await upgrade();
  assert.equal(r.status, 429);
  assert.ok(Number(r.headers["retry-after"]) >= 1);
});

test("the limiter answers before credentials are looked at", () => {
  for (let i = 0; i < 10; i++) assert.equal(ws.upgradeWait("203.0.113.7", 1000), 0);
  assert.equal(ws.upgradeWait("203.0.113.7", 1000), 10);
  assert.equal(ws.upgradeWait("203.0.113.7", 11_000), 0, "a new window starts");
});

test("a Basic header is never checked, so it counts nothing toward the lockout", async () => {
  for (let i = 0; i < 6; i++) {
    ws.resetUpgradeLimitForTests();
    assert.equal((await upgrade({ Authorization: basic("alice", `wrong-guess-${i}`) })).status, 401);
  }
  assert.equal(store.getFailure("127.0.0.1"), null);
  assert.equal(store.isLocked("127.0.0.1"), false);
});

test("authorize takes this site's signed-in page and nothing else", () => {
  const req = (headers) => ({ headers, socket: { remoteAddress: "203.0.113.8" } });
  const own = { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}`, cookie: page().Cookie };
  assert.equal(ws.authorize(req(own)), "ok");
  assert.equal(ws.authorize(req({ authorization: basic("alice", "alice-password-1") })), "denied");
  assert.equal(ws.authorize(req({ ...own, origin: "https://evil.example.net" })), "denied");
  assert.equal(ws.authorize(req({})), "denied");
});

test("clientAddress follows X-Forwarded-For only through trusted hops", () => {
  const trustLoopback = (addr) => addr === "127.0.0.1";
  const req = { socket: { remoteAddress: "127.0.0.1" }, headers: { "x-forwarded-for": "198.51.100.1, 203.0.113.4" } };
  assert.equal(clientAddress(req, trustLoopback), "203.0.113.4", "a client-written left value is not believed");
  assert.equal(clientAddress(req, () => false), "127.0.0.1");
  assert.equal(clientAddress({ socket: { remoteAddress: "::ffff:203.0.113.5" }, headers: {} }), "203.0.113.5");
});
