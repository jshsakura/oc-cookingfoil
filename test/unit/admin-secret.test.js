import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync as run } from "node:child_process";
import { mkdtempSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// /admin used to 404 unless COOK_ADMIN_TOTP_SECRET was set by hand, so a server
// running device pairing could end up with no way to approve any device. The
// secret is now auto-provisioned; these tests pin that down.

function freshDataDir() {
  return mkdtempSync(path.join(tmpdir(), "cf-adminsec-"));
}

function probe(script, env = {}) {
  const out = run(process.execPath, ["--input-type=module", "-e", script], {
    cwd: import.meta.dirname,
    env: { ...process.env, COOK_ADMIN_TOTP_SECRET: "", ...env },
    encoding: "utf-8",
  });
  return JSON.parse(out);
}

const REPORT = `
  import { adminSecret, isEnrolled, secretSource, markEnrolled } from "../../src/security/admin-secret.js";
  const before = { secret: adminSecret(), source: secretSource(), enrolled: isEnrolled() };
  if (process.env.PROBE_ENROLL === "1") markEnrolled();
  process.stdout.write(JSON.stringify({ ...before, enrolledAfter: isEnrolled() }));
`;

test("first boot generates a usable base32 secret and reports it as unenrolled", () => {
  const r = probe(REPORT, { COOK_DATA_DIR: freshDataDir() });

  assert.equal(r.source, "generated");
  assert.equal(r.enrolled, false, "the QR must still be offered until a code proves adoption");
  assert.match(r.secret, /^[A-Z2-7]{32}$/, "160-bit RFC 4226 secret in base32");
});

test("the generated secret persists across restarts (a restart must not orphan the authenticator)", () => {
  const dataDir = freshDataDir();
  const first = probe(REPORT, { COOK_DATA_DIR: dataDir });
  const second = probe(REPORT, { COOK_DATA_DIR: dataDir });

  assert.equal(second.secret, first.secret);
  assert.equal(second.source, "file");
});

test("the secret file is written owner-only", () => {
  const dataDir = freshDataDir();
  probe(REPORT, { COOK_DATA_DIR: dataDir });
  const file = path.join(dataDir, "security", "admin-totp.json");

  assert.ok(existsSync(file));
  assert.equal(statSync(file).mode & 0o777, 0o600);
});

test("enrollment survives a restart, so the QR is served exactly once", () => {
  const dataDir = freshDataDir();
  const enrolling = probe(REPORT, { COOK_DATA_DIR: dataDir, PROBE_ENROLL: "1" });
  assert.equal(enrolling.enrolled, false);
  assert.equal(enrolling.enrolledAfter, true);

  const after = probe(REPORT, { COOK_DATA_DIR: dataDir });
  assert.equal(after.enrolled, true, "a restart must not re-expose the enrollment key");
});

test("COOK_ADMIN_TOTP_SECRET wins and is never persisted to disk", () => {
  const dataDir = freshDataDir();
  const r = probe(REPORT, {
    COOK_DATA_DIR: dataDir,
    COOK_ADMIN_TOTP_SECRET: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
  });

  assert.equal(r.secret, "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP");
  assert.equal(r.source, "env");
  assert.equal(r.enrolled, true, "an operator-set secret is adopted by definition");
  assert.ok(
    !existsSync(path.join(dataDir, "security", "admin-totp.json")),
    "we must not copy an operator-managed secret into the data dir"
  );
});

test("the generated secret actually drives TOTP verification end to end", () => {
  const script = `
    import { generate } from "otplib";
    import { adminSecret } from "../../src/security/admin-secret.js";
    import { verifyTotp, adminTotpEnabled } from "../../src/security/admin-session.js";
    const code = await generate({ secret: adminSecret() });
    process.stdout.write(JSON.stringify({
      enabled: adminTotpEnabled(),
      good: await verifyTotp(code),
      bad: await verifyTotp("000000" === code ? "111111" : "000000"),
    }));
  `;
  const r = probe(script, { COOK_DATA_DIR: freshDataDir() });

  assert.equal(r.enabled, true, "/admin must always be reachable");
  assert.equal(r.good, true);
  assert.equal(r.bad, false);
});
