import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Every 429 says when to come back: the client pauses its image requests (and
// its downloads) for exactly Retry-After, so a 429 without one leaves it guessing.
process.env.COOK_DATA_DIR = mkdtempSync(path.join(tmpdir(), "cook-retry-after-"));
process.env.COOK_DROPBOX_APP_KEY = "test-app-key";
const store = await import("../../src/security/store.js");
const { tooManyRequests, lockoutRetryAfter, LOCKOUT_RETRY_AFTER_SEC } = await import("../../src/security/retry-after.js");
const { default: express } = await import("express");
const bridge = await import("../../src/routes/dropbox-bridge.js");

function fakeRes() {
  const headers = {};
  return { headers, statusCode: 200, set(k, v) { headers[k.toLowerCase()] = v; return this; }, status(c) { this.statusCode = c; return this; } };
}

test("tooManyRequests sets 429 and a whole number of seconds, at least one", () => {
  const res = fakeRes();
  assert.equal(tooManyRequests(res, 0.2), res, "chains like res.status()");
  assert.equal(res.statusCode, 429);
  assert.equal(res.headers["retry-after"], "1");
  assert.equal(tooManyRequests(fakeRes(), 61.1).headers["retry-after"], "62");
});

test("a lockout's Retry-After is what is left of it; a lockout with no end gets the fallback", () => {
  store.lock("198.51.100.1", { reason: "t", ttlMs: 90_000 });
  const left = lockoutRetryAfter("198.51.100.1");
  assert.ok(left > 85 && left <= 90, `about 90 s left, got ${left}`);
  store.lock("198.51.100.2", { reason: "t" });
  assert.equal(lockoutRetryAfter("198.51.100.2"), LOCKOUT_RETRY_AFTER_SEC);
  assert.equal(store.lockRemainingMs("198.51.100.3"), 0, "not locked");
  assert.equal(store.lockRemainingMs("198.51.100.2"), null, "locked for good");
});

test("too many Dropbox sign-ins at once answers 429 with Retry-After", async () => {
  const app = express();
  app.use(bridge.BRIDGE_PATH, bridge.dropboxSessionsRouter());
  const server = app.listen(0);
  after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}${bridge.BRIDGE_PATH}/v1/sessions/start`;
  const start = () => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  let r;
  for (let i = 0; i <= bridge.MAX_SESSIONS; i++) r = await start();
  assert.equal(r.status, 429);
  const wait = Number(r.headers.get("retry-after"));
  assert.ok(wait >= 1 && wait <= 15 * 60, `until the oldest sign-in expires, got ${wait}`);
});

// The routes that answer 429 all go through the helper, so none can forget the header.
test("denyResponse gives a 429 a Retry-After, its own or the lockout fallback", async () => {
  const { denyResponse } = await import("../../src/security/deny.js");
  const req = { ip: "203.0.113.5", path: "/x", method: "GET", get: () => "", headers: {}, socket: {} };
  const res = { ...fakeRes(), type() { return this; }, send() { return this; } };
  denyResponse(req, res, { reason: "ip-locked", status: 429 });
  assert.equal(res.headers["retry-after"], String(LOCKOUT_RETRY_AFTER_SEC));
  const timed = { ...fakeRes(), type() { return this; }, send() { return this; } };
  denyResponse(req, timed, { reason: "ip-locked", status: 429, retryAfter: 42 });
  assert.equal(timed.headers["retry-after"], "42");
  const other = { ...fakeRes(), type() { return this; }, send() { return this; } };
  denyResponse(req, other, { reason: "ip-locked", status: 403 });
  assert.equal(other.headers["retry-after"], undefined, "only a 429");
});

test("no route answers 429 except through tooManyRequests", () => {
  const root = path.join(import.meta.dirname, "../../src");
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".js")) files.push(p);
    }
  };
  walk(root);
  const offenders = [];
  for (const f of files) {
    if (f.endsWith("retry-after.js")) continue;
    const lines = readFileSync(f, "utf8").split("\n");
    lines.forEach((line, i) => {
      // denyResponse() sets it itself for a 429 (see deny.js); recordDeny() only writes the row.
      const inDeny = lines.slice(Math.max(0, i - 3), i + 1).some((l) => l.includes("denyResponse(") || l.includes("recordDeny("));
      if (/status\(\s*429\s*\)|status:\s*429/.test(line) && !inDeny && !/tooManyRequests|retryAfter/.test(line)) {
        offenders.push(`${path.relative(root, f)}:${i + 1}`);
      }
    });
  }
  assert.deepEqual(offenders, []);
});
