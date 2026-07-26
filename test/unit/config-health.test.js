import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The auth lanes are read once at module load (helpers/envs.js), so each
// configuration runs in its own child process with the env pinned up front.
//
// The case that matters: pairing on + no basic-auth users means stock Tinfoil
// — which cannot present a device key — is refused every download with nothing
// on screen saying why. Legal, sometimes intended, but it MUST be visible.

const PROBE = `
  import { authLanes, configWarnings } from "../../src/security/config-health.js";
  const lanes = authLanes();
  process.stdout.write(JSON.stringify({ lanes, warnings: configWarnings(lanes) }));
`;

function runProbe(env) {
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", PROBE], {
    cwd: import.meta.dirname,
    env: {
      ...process.env,
      COOK_DATA_DIR: mkdtempSync(path.join(tmpdir(), "cf-cfg-")),
      COOK_AUTH_USERS: "",
      COOK_DEVICE_PAIRING: "",
      COOK_ADMIN_TOTP_SECRET: "",
      ...env,
    },
    encoding: "utf-8",
  });
  return JSON.parse(out);
}

const codes = (r) => r.warnings.map((w) => w.code);

test("pairing-only: warns that stock Tinfoil cannot connect", () => {
  const r = runProbe({ COOK_DEVICE_PAIRING: "true", COOK_AUTH_USERS: "" });

  assert.equal(r.lanes.pairingOnly, true);
  assert.equal(r.lanes.basicAuth.enabled, false);
  assert.ok(codes(r).includes("pairing-only-blocks-tinfoil"));

  const warning = r.warnings.find((w) => w.code === "pairing-only-blocks-tinfoil");
  assert.equal(warning.severity, "warn");
  assert.match(warning.detail, /COOK_AUTH_USERS/, "must name the setting that fixes it");
});

test("both lanes: no pairing-only warning, basic-auth user count reported", () => {
  const r = runProbe({ COOK_DEVICE_PAIRING: "true", COOK_AUTH_USERS: "switch:foil,friend:pass" });

  assert.equal(r.lanes.pairingOnly, false, "content guard must stay out of the way");
  assert.equal(r.lanes.basicAuth.enabled, true);
  assert.equal(r.lanes.basicAuth.userCount, 2);
  assert.ok(!codes(r).includes("pairing-only-blocks-tinfoil"));
  assert.ok(codes(r).includes("both-lanes"));
});

test("basic-auth only: no warnings about lanes at all", () => {
  const r = runProbe({ COOK_AUTH_USERS: "switch:foil" });

  assert.equal(r.lanes.pairing.enabled, false);
  assert.equal(r.lanes.basicAuth.enabled, true);
  assert.ok(!codes(r).includes("pairing-only-blocks-tinfoil"));
  assert.ok(!codes(r).includes("no-auth"));
});

test("no auth configured at all: warns the server is open", () => {
  const r = runProbe({});
  assert.ok(codes(r).includes("no-auth"));
});

test("an auto-provisioned admin secret reports as unenrolled and warns", () => {
  const r = runProbe({ COOK_AUTH_USERS: "switch:foil" });

  assert.equal(r.lanes.admin.enabled, true, "/admin must always exist so approvals are possible");
  assert.equal(r.lanes.admin.secretSource, "generated");
  assert.equal(r.lanes.admin.enrolled, false);
  assert.ok(codes(r).includes("admin-unenrolled"));
});

test("an operator-supplied COOK_ADMIN_TOTP_SECRET counts as already enrolled", () => {
  const r = runProbe({
    COOK_AUTH_USERS: "switch:foil",
    COOK_ADMIN_TOTP_SECRET: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
  });

  assert.equal(r.lanes.admin.secretSource, "env");
  assert.equal(r.lanes.admin.enrolled, true);
  assert.ok(!codes(r).includes("admin-unenrolled"), "no QR nagging when the operator manages the secret");
});
