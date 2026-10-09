import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// authGuard reads its config at module load, so each configuration needs its
// own child process — same pattern as device-content-guard.test.js.
//
// The regression this pins down (shipped in v0.8.2): auth-guard.js called
// isLoopbackIp() without importing it from net.js. Under ESM that is a runtime
// ReferenceError, and because authGuard sits on EVERY request path the shop
// answered 500 to everything.
//
// Nothing caught it, and the reason matters for these cases: authGuard's first
// branch short-circuits when COOK_AUTH_USERS is empty, and the pre-commit smoke
// test booted the server without it — so the broken line was unreachable there.
// "auth configured" is therefore the condition worth testing, not an edge case.

const CREDS = "probe:secret";
const BASIC_OK = `Basic ${Buffer.from(CREDS).toString("base64")}`;
const BASIC_BAD = `Basic ${Buffer.from("probe:wrong").toString("base64")}`;

const PROBE = `
  import authGuard from "../../src/security/auth-guard.js";
  import * as store from "../../src/security/store.js";

  const req = {
    ip: process.env.PROBE_IP,
    method: "GET",
    originalUrl: "/",
    path: "/",
    headers: process.env.PROBE_AUTH ? { authorization: process.env.PROBE_AUTH } : {},
    get(n) { return this.headers[String(n).toLowerCase()]; },
  };
  const res = {
    statusCode: null, headers: {}, body: null,
    type() { return res; },
    set(k, v) { res.headers[String(k).toLowerCase()] = v; return res; },
    setHeader(k, v) { return res.set(k, v); },
    status(c) { res.statusCode = c; return res; },
    send(b) { res.body = b; finish(); return res; },
    end(b) { res.body = b ?? res.body; finish(); return res; },
    json(b) { res.body = b; finish(); return res; },
  };

  // Password checks are async, so wait for either next() or a response.
  let finish;
  const done = new Promise((resolve) => { finish = resolve; });
  let passedThrough = false;
  let error = null;
  try {
    authGuard()(req, res, (err) => { passedThrough = !err; finish(); });
    await Promise.race([done, new Promise((r) => setTimeout(r, 5000))]);
  } catch (err) {
    error = err?.message ?? String(err);
  }

  process.stdout.write(JSON.stringify({
    passedThrough,
    error,
    status: res.statusCode,
    failures: store.getFailure(process.env.PROBE_IP)?.count ?? 0,
  }));
`;

function runProbe({ ip = "127.0.0.1", authUsers = CREDS, authHeader = "", env = {} } = {}) {
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", PROBE], {
    cwd: import.meta.dirname,
    env: {
      ...process.env,
      COOK_DATA_DIR: mkdtempSync(path.join(tmpdir(), "cf-ag-")),
      COOK_AUTH_USERS: authUsers,
      COOK_DEVICE_PAIRING: "",
      DEBUG: "",
      PROBE_IP: ip,
      PROBE_AUTH: authHeader,
      ...env,
    },
    encoding: "utf-8",
  });
  return JSON.parse(out);
}

test("loopback caller with auth configured does not blow up the request", () => {
  // Pre-fix this threw "isLoopbackIp is not defined" and express turned it
  // into a 500 — for every single request, not just loopback ones.
  const r = runProbe({ ip: "127.0.0.1" });
  assert.equal(r.error, null, `guard threw: ${r.error}`);
  assert.equal(r.passedThrough, false, "no credentials must not pass");
  assert.equal(r.status, 401, "expected a basic-auth challenge");
});

test("non-loopback caller with auth configured does not blow up either", () => {
  const r = runProbe({ ip: "192.168.1.50" });
  assert.equal(r.error, null, `guard threw: ${r.error}`);
  assert.equal(r.status, 401);
});

test("loopback bypass still enforces the password", () => {
  // The bypass exempts loopback from LOCKOUT tracking, not from auth itself.
  const r = runProbe({ ip: "127.0.0.1", authHeader: BASIC_BAD });
  assert.equal(r.error, null);
  assert.equal(r.passedThrough, false);
  assert.equal(r.status, 401);
});

test("valid credentials pass", () => {
  const r = runProbe({ ip: "127.0.0.1", authHeader: BASIC_OK });
  assert.equal(r.error, null);
  assert.equal(r.passedThrough, true);
});

test("trust-loopback disabled still reaches isLoopbackIp without throwing", () => {
  // trustLoopback=false short-circuits `trustLoopback && isLoopbackIp(ip)`,
  // which is exactly how a broken import could hide again. Pin both sides.
  const r = runProbe({ ip: "127.0.0.1", env: { COOK_LOCKOUT_TRUST_LOOPBACK: "false" } });
  assert.equal(r.error, null);
  assert.equal(r.status, 401);
});

test("no auth configured short-circuits — the smoke test's blind spot", () => {
  // Documents WHY the outage shipped: with COOK_AUTH_USERS empty the guard
  // returns a pass-through before it ever touches the loopback helper.
  const r = runProbe({ authUsers: "" });
  assert.equal(r.error, null);
  assert.equal(r.passedThrough, true);
});

test("a browser's first request without credentials is a challenge, not a failed login", () => {
  // Browsers send the first requests with no Authorization header and only
  // add credentials after the 401. Counting those locked out every user that
  // shares the proxy's address in one page load.
  const r = runProbe({ ip: "192.168.1.50" });
  assert.equal(r.status, 401);
  assert.equal(r.failures, 0);
});

test("a wrong password still counts toward the lockout", () => {
  const r = runProbe({ ip: "192.168.1.50", authHeader: BASIC_BAD });
  assert.equal(r.status, 401);
  assert.equal(r.failures, 1);
});
