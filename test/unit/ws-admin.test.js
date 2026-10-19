import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { WebSocket } from "ws";

// The admin page's activity channel (/admin/ws): its own Origin, an admin
// account and the 2FA session, nothing less. It sends the activity snapshot.
process.env.COOK_DATA_DIR = mkdtempSync(path.join(tmpdir(), "cook-ws-admin-"));
process.env.COOK_LOCKOUT_TRUST_LOOPBACK = "false";
const users = await import("../../src/security/users.js");
const ws = await import("../../src/realtime/ws-server.js");
const { issuePasswordSession } = await import("../../src/security/user-session.js");
const { issueSession } = await import("../../src/security/admin-session.js");
const activity = await import("../../src/tasks/activity.js");

users.add("owner", "owner-password-1", "admin");
users.add("guest", "guest-password-1", "user");

const server = http.createServer((_req, res) => res.end());
const channel = ws.attach(server);
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

function upgrade(headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1", port, path: ws.ADMIN_PATH,
      headers: {
        Connection: "Upgrade", Upgrade: "websocket",
        "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
        ...headers,
      },
    });
    req.on("upgrade", (res, socket) => { socket.destroy(); resolve(res.statusCode); });
    req.on("response", (res) => { res.resume(); resolve(res.statusCode); });
    req.on("error", reject);
    req.end();
  });
}

const both = () => `${userCookie("owner")}; ${adminCookie()}`;

test("an ordinary shop user receives activity over the library channel without an admin session", async () => {
  let cancelled = 0;
  const job = activity.begin("nsz", { title: "Public progress", total: 100, cancel: () => cancelled++ });
  const client = new WebSocket(`ws://127.0.0.1:${port}/ws/library`, {
    headers: { Origin: ORIGIN, Cookie: userCookie("guest") },
  });
  try {
    const snapshot = await new Promise((resolve, reject) => {
      client.on("error", reject);
      client.on("message", raw => {
        const message = JSON.parse(raw.toString());
        if (message.type === "activity") resolve(message);
      });
    });
    assert.ok(snapshot.running.some(entry => entry.id === job.id));
    client.send(JSON.stringify({ type: "cancel", id: job.id }));
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(cancelled, 0);
    assert.ok(activity.list().running.some(entry => entry.id === job.id));
  } finally {
    client.terminate();
    job.discard();
  }
});

test("an admin past the second step on this site's page upgrades", async () => {
  assert.equal(await upgrade({ Origin: ORIGIN, Cookie: both() }), 101);
});

test("no Origin, another site's Origin, or a missing cookie is refused", async () => {
  assert.equal(await upgrade({ Cookie: both() }), 403, "scripts without an Origin poll the API instead");
  assert.equal(await upgrade({ Origin: "https://evil.example.net", Cookie: both() }), 403);
  assert.equal(await upgrade({ Origin: ORIGIN, Cookie: userCookie("owner") }), 401, "no 2FA session");
  assert.equal(await upgrade({ Origin: ORIGIN, Cookie: adminCookie() }), 401, "no account session");
});

test("a regular account with a 2FA cookie is refused", async () => {
  assert.equal(await upgrade({ Origin: ORIGIN, Cookie: `${userCookie("guest")}; ${adminCookie()}` }), 401);
});

test("Basic credentials do not open the admin channel", async () => {
  const basic = "Basic " + Buffer.from("owner:owner-password-1").toString("base64");
  assert.equal(await upgrade({ Origin: ORIGIN, Authorization: basic }), 401);
});

test("the channel sends the snapshot, then each change", async () => {
  const sock = new WebSocket(`ws://127.0.0.1:${port}${ws.ADMIN_PATH}`, { headers: { Origin: ORIGIN, Cookie: both() } });
  const messages = [];
  sock.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
  await new Promise((r, j) => { sock.once("open", r); sock.once("error", j); });
  const job = activity.begin("scan:saves", { title: "세이브 폴더를 읽습니다", total: 2 });
  job.step(1);
  await new Promise((r) => setTimeout(r, 400));
  job.done("2개");
  await new Promise((r) => setTimeout(r, 400));
  sock.close();
  assert.equal(messages[0].type, "activity");
  const live = messages.find((m) => m.running.some((e) => e.id === job.id));
  assert.equal(live.running.find((e) => e.id === job.id).current, 1);
  const ended = messages.at(-1);
  assert.equal(ended.running.length, 0);
  assert.equal(ended.recent[0].result, "2개");
});
