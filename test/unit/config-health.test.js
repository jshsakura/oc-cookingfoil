import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The auth lanes are read once at module load (helpers/envs.js), so each
// configuration runs in its own child process with the env pinned up front.
//
// What must stay visible: a server open to anyone, and both lanes at once.

const PROBE = `
  import { authLanes, configWarnings } from "../../src/security/config-health.js";
  const lanes = authLanes();
  process.stdout.write(JSON.stringify({ lanes, warnings: configWarnings(lanes) }));
`;

function runProbe(env, probe = PROBE) {
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", probe], {
    cwd: import.meta.dirname,
    env: {
      ...process.env,
      COOK_DATA_DIR: mkdtempSync(path.join(tmpdir(), "cf-cfg-")),
      COOK_AUTH_USERS: "",
      COOK_DEVICE_PAIRING: "false",
      COOK_ADMIN_TOTP_SECRET: "",
      ...env,
    },
    encoding: "utf-8",
  });
  return JSON.parse(out);
}

const codes = (r) => r.warnings.map((w) => w.code);

test("both lanes: the account count is reported", () => {
  const r = runProbe({ COOK_DEVICE_PAIRING: "true", COOK_AUTH_USERS: "console:foil,friend:pass" });

  assert.equal(r.lanes.pairingOnly, false, "content guard must stay out of the way");
  assert.equal(r.lanes.accounts.enabled, true);
  assert.equal(r.lanes.accounts.userCount, 2);
  assert.ok(codes(r).includes("both-lanes"));
});

test("accounts only: no warnings about lanes at all", () => {
  const r = runProbe({ COOK_AUTH_USERS: "console:foil" });

  assert.equal(r.lanes.pairing.enabled, false);
  assert.equal(r.lanes.accounts.enabled, true);
  assert.ok(!codes(r).includes("no-auth"));
});

test("no auth configured at all: warns the server is open", () => {
  const r = runProbe({});
  assert.ok(codes(r).includes("no-auth"));
});

test("an auto-provisioned admin secret reports as unenrolled and warns", () => {
  const r = runProbe({ COOK_AUTH_USERS: "console:foil" });

  assert.equal(r.lanes.admin.enabled, true, "/admin must always exist so approvals are possible");
  assert.equal(r.lanes.admin.secretSource, "generated");
  assert.equal(r.lanes.admin.enrolled, false);
  assert.ok(codes(r).includes("admin-unenrolled"));
});

test("a setup that skipped the authenticator warns that the account password alone opens the admin page", () => {
  const probe = `
    import { skip } from "../../src/security/admin-2fa-skip.js";
    skip();
    ${PROBE}
  `;
  const r = runProbe({ COOK_AUTH_USERS: "console:foil" }, probe);
  const w = r.warnings.find((x) => x.code === "admin-2fa-skipped");
  assert.equal(w?.severity, "warn");
  assert.ok(!codes(r).includes("admin-unenrolled"), "one warning, the stronger one");
  const withPassword = runProbe({ COOK_AUTH_USERS: "console:foil", COOK_ADMIN_PASSWORD: "admin-password-123" }, probe);
  assert.ok(!codes(withPassword).includes("admin-2fa-skipped"), "an admin password locks the page again");
});

test("with an admin password, an unenrolled authenticator is a hint, not a warning", () => {
  const r = runProbe({ COOK_AUTH_USERS: "console:foil", COOK_ADMIN_PASSWORD: "admin-password-123" });
  assert.ok(!codes(r).includes("admin-unenrolled"));
  assert.equal(r.warnings.find((w) => w.code === "admin-authenticator-optional").severity, "info");
});

test("COOK_ADMIN_EMAIL becomes the admin identity", () => {
  const r = runProbe({ COOK_ADMIN_EMAIL: "admin@example.com" });
  assert.equal(r.lanes.admin.email, "admin@example.com");
  assert.equal(r.lanes.admin.owner, "admin@example.com");
});

test("an unset admin email falls back to a generic owner, not a crash", () => {
  const r = runProbe({ COOK_ADMIN_EMAIL: "" });
  assert.equal(r.lanes.admin.email, null);
  assert.equal(r.lanes.admin.owner, "admin");
});

test("a malformed admin email is rejected rather than shown as-is", () => {
  // It ends up in the authenticator label and the admin page; garbage in that
  // slot is confusing, and it is never worth failing a boot over.
  for (const bad of ["not-an-email", "@nope.com", "a@b", "two words@x.com"]) {
    const r = runProbe({ COOK_ADMIN_EMAIL: bad });
    assert.equal(r.lanes.admin.email, null, `${bad} should be ignored`);
    assert.equal(r.lanes.admin.owner, "admin");
  }
});

test("an operator-supplied COOK_ADMIN_TOTP_SECRET counts as already enrolled", () => {
  const r = runProbe({
    COOK_AUTH_USERS: "console:foil",
    COOK_ADMIN_TOTP_SECRET: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
  });

  assert.equal(r.lanes.admin.secretSource, "env");
  assert.equal(r.lanes.admin.enrolled, true);
  assert.ok(!codes(r).includes("admin-unenrolled"), "no QR nagging when the operator manages the secret");
});
