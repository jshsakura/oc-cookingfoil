import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The limiter reads its budget once at module load, so each configuration runs
// in its own child process.
//
// Why the defaults are what they are: a console install pulls a title in 16MB
// range requests, so one large game is hundreds of requests in a row. Under the
// old 240/min + 60 burst that got throttled, and a throttled range read reaches
// the console as a bare "install failed" with no cause attached.

const PROBE = `
  import rateLimit from "../../src/security/rate-limit.js";
  import * as store from "../../src/security/store.js";

  const headers = JSON.parse(process.env.PROBE_HEADERS ?? "{}");
  const mw = rateLimit();
  const total = Number(process.env.PROBE_REQUESTS ?? 1);

  let allowed = 0, refused = 0, lastRetryAfter = null;
  for (let i = 0; i < total; i++) {
    const req = { ip: "203.0.113.5", method: "GET", originalUrl: "/game.nsp", path: "/game.nsp",
      get: (n) => headers[n.toLowerCase()] ?? undefined };
    const res = { headers: {},
      type() { return res; }, set(k, v) { res.headers[k] = v; return res; },
      status(c) { res.code = c; return res; }, send() { return res; } };
    let passed = false;
    mw(req, res, () => { passed = true; });
    if (passed) allowed++; else { refused++; lastRetryAfter = res.headers["Retry-After"]; }
  }

  process.stdout.write(JSON.stringify({
    allowed, refused, lastRetryAfter,
    denials: store.denialsSnapshot().recent,
  }));
`;

function runProbe({ requests = 1, env = {}, headers = {} } = {}) {
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", PROBE], {
    cwd: import.meta.dirname,
    env: {
      ...process.env,
      COOK_DATA_DIR: mkdtempSync(path.join(tmpdir(), "cf-rl-")),
      COOK_TRUST_PROXY: "",
      COOK_RATE_LIMIT_PER_MIN: "",
      COOK_RATE_LIMIT_BURST: "",
      PROBE_REQUESTS: String(requests),
      PROBE_HEADERS: JSON.stringify(headers),
      ...env,
    },
    encoding: "utf-8",
  });
  return JSON.parse(out);
}

test("the default burst absorbs a full dashboard icon grid without refusing any", () => {
  // 250 titles rendering their icons at once is ordinary, not abuse.
  const r = runProbe({ requests: 250 });
  assert.equal(r.refused, 0, "a normal library view must not be throttled");
  assert.equal(r.allowed, 250);
});

test("the default burst covers a large install's back-to-back range reads", () => {
  // ~300 × 16MB ≈ a 4.7GB title fetched in one go.
  const r = runProbe({ requests: 300 });
  assert.equal(r.refused, 0, "an install must not be throttled mid-transfer");
});

test("a genuine flood is still refused, with a Retry-After hint", () => {
  const r = runProbe({ requests: 400 });
  assert.ok(r.refused > 0, "the limiter must still bite eventually");
  assert.ok(Number(r.lastRetryAfter) >= 1, "clients need a wait hint");
  assert.equal(r.denials[0].reason, "rate-limited");
});

test("an explicit lower limit still wins over the default", () => {
  const r = runProbe({
    requests: 12,
    env: { COOK_RATE_LIMIT_PER_MIN: "60", COOK_RATE_LIMIT_BURST: "10" },
  });
  assert.equal(r.allowed, 10);
  assert.ok(r.refused >= 1);
});

test("a throttled request records the effective budget, so the number is never a mystery", () => {
  const r = runProbe({
    requests: 3,
    env: { COOK_RATE_LIMIT_PER_MIN: "60", COOK_RATE_LIMIT_BURST: "1" },
  });
  assert.match(r.denials[0].detail, /60\/min, burst 1/);
});

test("behind an untrusted proxy the denial blames the shared bucket, not the limit", () => {
  // Everyone collapses onto the proxy's IP, so raising the limit is the wrong
  // fix — the denial row has to say which problem it actually is.
  const r = runProbe({
    requests: 3,
    env: { COOK_RATE_LIMIT_PER_MIN: "60", COOK_RATE_LIMIT_BURST: "1", COOK_TRUST_PROXY: "" },
    headers: { "x-forwarded-for": "198.51.100.7" },
  });
  assert.match(r.denials[0].detail, /COOK_TRUST_PROXY=true/);
});

test("with COOK_TRUST_PROXY=true a forwarded request is not flagged as collapsed", () => {
  const r = runProbe({
    requests: 3,
    env: { COOK_RATE_LIMIT_PER_MIN: "60", COOK_RATE_LIMIT_BURST: "1", COOK_TRUST_PROXY: "true" },
    headers: { "x-forwarded-for": "198.51.100.7" },
  });
  assert.match(r.denials[0].detail, /60\/min/);
});
