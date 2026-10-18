import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { envRaw, envString, envNumber, envBool } from "../../src/helpers/env-read.js";

// The bug this module exists to kill: `process.env.X ?? 12` only catches
// undefined, so an EMPTY value became Number("") === 0. docker-compose writes
// exactly that — `${COOK_FOO:-}` sets the variable to "" whenever the operator
// hasn't defined it — so "leave it unset for the default" silently produced a
// 1-request/minute rate limit and a lockout after a single typo.

function withEnv(name, value, fn) {
  const had = Object.prototype.hasOwnProperty.call(process.env, name);
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return fn();
  } finally {
    if (had) process.env[name] = previous;
    else delete process.env[name];
  }
}

test("an empty value is treated as unset, not as zero", () => {
  withEnv("COOK_TEST_N", "", () => {
    assert.equal(envRaw("COOK_TEST_N"), undefined);
    assert.equal(envNumber("COOK_TEST_N", 1200), 1200);
    assert.equal(envString("COOK_TEST_N", "fallback"), "fallback");
    assert.equal(envBool("COOK_TEST_N", true), true);
  });
});

test("a whitespace-only value is also unset (a stray space in .env)", () => {
  withEnv("COOK_TEST_N", "   ", () => {
    assert.equal(envNumber("COOK_TEST_N", 5), 5);
    assert.equal(envString("COOK_TEST_N", "x"), "x");
  });
});

test("a real value still wins, and is trimmed", () => {
  withEnv("COOK_TEST_N", " 42 ", () => {
    assert.equal(envNumber("COOK_TEST_N", 5), 42);
    assert.equal(envString("COOK_TEST_N", "x"), "42");
  });
});

test("an unparseable number falls back to the documented default", () => {
  withEnv("COOK_TEST_N", "1o0", () => {
    assert.equal(envNumber("COOK_TEST_N", 7), 7, "must not become NaN");
  });
});

test("min/max/integer constrain the parsed value", () => {
  withEnv("COOK_TEST_N", "0", () => assert.equal(envNumber("COOK_TEST_N", 5, { min: 1 }), 1));
  withEnv("COOK_TEST_N", "999", () => assert.equal(envNumber("COOK_TEST_N", 5, { max: 10 }), 10));
  withEnv("COOK_TEST_N", "2.7", () =>
    assert.equal(envNumber("COOK_TEST_N", 5, { integer: true }), 3));
});

test("envBool accepts the usual spellings and rejects nonsense", () => {
  for (const yes of ["true", "TRUE", "1", "yes", "on"]) {
    withEnv("COOK_TEST_B", yes, () => assert.equal(envBool("COOK_TEST_B", false), true, yes));
  }
  for (const no of ["false", "0", "no", "off"]) {
    withEnv("COOK_TEST_B", no, () => assert.equal(envBool("COOK_TEST_B", true), false, no));
  }
  withEnv("COOK_TEST_B", "maybe", () => assert.equal(envBool("COOK_TEST_B", true), true));
});

// ── the regression itself, through the real modules ────────────────────────
// docker-compose's `${VAR:-}` passthrough sets these to "" when the operator
// hasn't defined them. Every one of these settings must still land on its
// documented default.

const PROBE = `
  import { maxAuthFailures, trustLoopback } from "../../src/security/limits.js";
  import { adminSessionHours, extractPaceMs, uploadMaxBytes } from "../../src/helpers/envs.js";
  process.stdout.write(JSON.stringify({
    maxAuthFailures, trustLoopback, adminSessionHours, extractPaceMs, uploadMaxBytes,
  }));
`;

test("compose-style empty passthrough leaves every documented default intact", () => {
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", PROBE], {
    cwd: import.meta.dirname,
    env: {
      ...process.env,
      COOK_DATA_DIR: mkdtempSync(path.join(tmpdir(), "cf-env-")),
      // Exactly what `${VAR:-}` produces for an undefined variable.
      COOK_AUTH_MAX_FAILURES: "",
      COOK_LOCKOUT_TRUST_LOOPBACK: "",
      COOK_ADMIN_SESSION_HOURS: "",
      COOK_EXTRACT_PACE_MS: "",
      COOK_UPLOAD_MAX_BYTES: "",
    },
    encoding: "utf-8",
  });
  const r = JSON.parse(out);

  assert.equal(r.maxAuthFailures, 5, "an empty value must not mean 'lock out after 1 failure'");
  assert.equal(r.trustLoopback, true);
  assert.equal(r.adminSessionHours, 8);
  assert.equal(r.extractPaceMs, 250);
  assert.equal(r.uploadMaxBytes, 32 * 1024 ** 3);
});
