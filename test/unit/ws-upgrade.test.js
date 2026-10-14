import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The /ws/library upgrade: a per-address limit and a same-host Origin check
// before any credential check, the async password check, and wrong passwords
// counted toward the HTTP lockout.
process.env.COOK_DATA_DIR = mkdtempSync(path.join(tmpdir(), "cook-ws-upgrade-"));
// Loopback is a real remote here, so the lockout applies to the test client.
process.env.COOK_LOCKOUT_TRUST_LOOPBACK = "false";
const users = await import("../../src/security/users.js");
const store = await import("../../src/security/store.js");
const ws = await import("../../src/realtime/ws-server.js");
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

test("good Basic credentials upgrade; none or wrong ones get 401", async () => {
  assert.equal((await upgrade({ Authorization: basic("alice", "alice-password-1") })).status, 101);
  const none = await upgrade();
  assert.equal(none.status, 401);
  assert.match(none.headers["www-authenticate"], /Basic/);
  assert.equal((await upgrade({ Authorization: basic("alice", "wrong-1") })).status, 401);
});

test("another site's Origin is refused before the credential check", async () => {
  const r = await upgrade({ Origin: "https://evil.example.net", Authorization: basic("alice", "alice-password-1") });
  assert.equal(r.status, 403);
  assert.equal(store.getFailure("127.0.0.1"), null, "nothing was checked, nothing counted");
});

test("this site's own Origin with good credentials still upgrades", async () => {
  const r = await upgrade({ Origin: `http://127.0.0.1:${port}`, Authorization: basic("alice", "alice-password-1") });
  assert.equal(r.status, 101);
});

test("a page's socket gets no Basic challenge", async () => {
  const r = await upgrade({ Origin: `http://127.0.0.1:${port}` });
  assert.equal(r.status, 401);
  assert.equal(r.headers["www-authenticate"], undefined);
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

test("wrong passwords count toward the HTTP lockout", async () => {
  for (let i = 0; i < 5; i++) {
    ws.resetUpgradeLimitForTests();
    assert.equal((await upgrade({ Authorization: basic("alice", `wrong-guess-${i}`) })).status, 401);
  }
  assert.ok(store.isLocked("127.0.0.1"), "five wrong guesses lock the address");
  ws.resetUpgradeLimitForTests();
  assert.equal((await upgrade({ Authorization: basic("alice", "alice-password-1") })).status, 403);
});

test("the same wrong credentials again count once", async () => {
  for (let i = 0; i < 3; i++) await upgrade({ Authorization: basic("alice", "stale-saved-password") });
  assert.equal(store.getFailure("127.0.0.1")?.count, 1);
});

test("authorize is async and uses the password lane's verdicts", async () => {
  const req = (authorization) => ({ headers: authorization ? { authorization } : {}, socket: { remoteAddress: "203.0.113.8" } });
  const pending = ws.authorize(req(basic("alice", "alice-password-1")));
  assert.ok(pending instanceof Promise);
  assert.equal(await pending, "ok");
  assert.equal(await ws.authorize(req(basic("alice", "nope"))), "bad-credentials");
  assert.equal(await ws.authorize(req()), "denied");
});

test("clientAddress follows X-Forwarded-For only through trusted hops", () => {
  const trustLoopback = (addr) => addr === "127.0.0.1";
  const req = { socket: { remoteAddress: "127.0.0.1" }, headers: { "x-forwarded-for": "198.51.100.1, 203.0.113.4" } };
  assert.equal(clientAddress(req, trustLoopback), "203.0.113.4", "a client-written left value is not believed");
  assert.equal(clientAddress(req, () => false), "127.0.0.1");
  assert.equal(clientAddress({ socket: { remoteAddress: "::ffff:203.0.113.5" }, headers: {} }), "203.0.113.5");
});
