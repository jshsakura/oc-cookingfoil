import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { isLoopbackSocket, socketIp } from "../../src/security/net.js";

test("loopback is the socket's address, never X-Forwarded-For", () => {
  assert.equal(isLoopbackSocket({ ip: "127.0.0.1", socket: { remoteAddress: "203.0.113.9" } }), false);
  assert.equal(isLoopbackSocket({ ip: "203.0.113.9", socket: { remoteAddress: "::ffff:127.0.0.1" } }), true);
  assert.equal(isLoopbackSocket({ socket: { remoteAddress: "::1" } }), true);
  assert.equal(isLoopbackSocket({}), false);
  assert.equal(socketIp({ socket: { remoteAddress: "::ffff:10.0.0.4" } }), "10.0.0.4");
});

// The access guard reads its config at load, so it runs in its own process.
const PROBE = `
  import accessGuard from "../../src/security/access-guard.js";
  const req = {
    ip: "127.0.0.1",
    socket: { remoteAddress: process.env.PROBE_SOCKET },
    method: "GET", path: "/.env", originalUrl: "/.env", headers: {},
    get(n) { return this.headers[String(n).toLowerCase()]; },
  };
  const res = { statusCode: 200, headers: {}, set(k, v) { this.headers[k] = v; return this; }, setHeader(k, v) { return this.set(k, v); },
    status(c) { this.statusCode = c; return this; }, type() { return this; }, send() { return this; }, end() { return this; }, json() { return this; } };
  let passed = false;
  accessGuard()(req, res, () => { passed = true; });
  process.stdout.write(JSON.stringify({ passed, status: res.statusCode }));
`;

function probe(socket) {
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", PROBE], {
    cwd: import.meta.dirname,
    env: { ...process.env, COOK_DATA_DIR: mkdtempSync(path.join(tmpdir(), "cf-lb-")), DEBUG: "", PROBE_SOCKET: socket, COOK_TELEGRAM_BOT_TOKEN: "" },
    encoding: "utf-8",
  });
  return JSON.parse(out);
}

test("the access guard's probe check skips only a real loopback socket", () => {
  assert.deepEqual(probe("203.0.113.9"), { passed: false, status: 404 }, "X-Forwarded-For: 127.0.0.1 from outside is still checked");
  assert.equal(probe("127.0.0.1").passed, true);
});
