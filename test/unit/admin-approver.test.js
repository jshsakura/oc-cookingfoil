import { test } from "node:test";
import assert from "node:assert/strict";
import { adminApprover } from "../../src/security/admin-actor.js";

// A console approved from /admin is recorded under the account that approved it,
// so a Google-only shop never files consoles under "관리자".
test("an approval from /admin is recorded under the signed-in Google account", () => {
  const req = { webUser: { kind: "google", sub: "1", email: "admin@example.com", approver: "google:admin@example.com" } };
  assert.equal(adminApprover(req), "google:admin@example.com");
});

test("an approval from /admin by a password account is recorded under its name", () => {
  assert.equal(adminApprover({ webUser: { kind: "password", name: "ops" } }), "ops");
});

test("an approval with only the admin's own code or password stays recorded as admin", () => {
  assert.equal(adminApprover({}), "admin");
});
