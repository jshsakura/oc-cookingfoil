import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// deviceContentGuard only enforces when pairing is the SOLE lane, and that
// decision is frozen at module load — hence child processes per configuration.
//
// The regression this pins down: a client with no device key (stock Tinfoil)
// used to be refused with a generic 403 and NO record anywhere, which is what
// made "the download instantly says Complete" impossible to diagnose.

const VALID_KEY = "A1B2C3D4E5F60718293A4B5C6D7E8F90A1B2C3D4E5F60718293A4B5C6D7E8F90";

const PROBE = `
  import guard from "../../src/security/device-content-guard.js";
  import * as store from "../../src/security/store.js";

  const headers = JSON.parse(process.env.PROBE_HEADERS ?? "{}");
  const req = {
    ip: "192.168.1.77", method: "GET", originalUrl: "/shop.tfl", path: "/shop.tfl",
    headers: {},
    get: (n) => headers[n] ?? undefined,
  };
  const res = {
    statusCode: null, headers: {}, body: null,
    type() { return res; },
    set(k, v) { res.headers[k] = v; return res; },
    status(c) { res.statusCode = c; return res; },
    send(b) { res.body = b; return res; },
  };

  let passedThrough = false;
  guard()(req, res, () => { passedThrough = true; });

  process.stdout.write(JSON.stringify({
    passedThrough,
    status: res.statusCode,
    denyHeader: res.headers["X-CookingFoil-Deny"] ?? null,
    body: res.body,
    denials: store.denialsSnapshot().recent,
    pending: store.devicesSnapshot().pending.map((p) => p.deviceKey),
  }));
`;

function runProbe({ env = {}, headers = {} } = {}) {
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", PROBE], {
    cwd: import.meta.dirname,
    env: {
      ...process.env,
      COOK_DATA_DIR: mkdtempSync(path.join(tmpdir(), "cf-dcg-")),
      COOK_AUTH_USERS: "",
      COOK_DEVICE_PAIRING: "",
      COOK_LOCKOUT_TRUST_LOOPBACK: "false",
      PROBE_HEADERS: JSON.stringify(headers),
      ...env,
    },
    encoding: "utf-8",
  });
  return JSON.parse(out);
}

const PAIRING_ONLY = { COOK_DEVICE_PAIRING: "true", COOK_AUTH_USERS: "" };

test("pairing-only + keyless client: refused as no-device-key, and it is recorded", () => {
  const r = runProbe({ env: PAIRING_ONLY, headers: { "user-agent": "Tinfoil/17.0" } });

  assert.equal(r.passedThrough, false);
  assert.equal(r.status, 403);
  assert.equal(r.denyHeader, "no-device-key");
  assert.equal(r.denials.length, 1, "the refusal must leave a trail for the dashboard");
  assert.equal(r.denials[0].reason, "no-device-key");
  assert.equal(r.denials[0].path, "/shop.tfl");
  assert.equal(r.denials[0].ua, "Tinfoil/17.0");
});

test("the keyless refusal body names the client limitation and the fix", () => {
  const r = runProbe({ env: PAIRING_ONLY });
  assert.match(r.body, /Stock Tinfoil cannot pair/);
  assert.match(r.body, /COOK_AUTH_USERS/);
});

test("pairing-only + unapproved device: distinct reason, and it lands in the pending queue", () => {
  const r = runProbe({ env: PAIRING_ONLY, headers: { "X-Device-Key": VALID_KEY } });

  assert.equal(r.status, 403);
  assert.equal(r.denyHeader, "device-not-approved");
  assert.equal(r.denials[0].reason, "device-not-approved");
  assert.equal(r.denials[0].deviceKey, VALID_KEY);
  assert.deepEqual(r.pending, [VALID_KEY], "so the admin can approve it without the device asking twice");
});

test("basic-auth configured: the guard steps aside entirely (authGuard owns this surface)", () => {
  const r = runProbe({ env: { COOK_DEVICE_PAIRING: "true", COOK_AUTH_USERS: "switch:foil" } });

  assert.equal(r.passedThrough, true);
  assert.equal(r.status, null);
  assert.equal(r.denials.length, 0, "a passthrough must not pollute the denial log");
});

test("pairing off: no enforcement at all", () => {
  const r = runProbe({ env: { COOK_DEVICE_PAIRING: "", COOK_AUTH_USERS: "" } });
  assert.equal(r.passedThrough, true);
  assert.equal(r.status, null);
});
