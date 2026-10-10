import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyPassword } from "../../src/security/admin-session.js";
import { gatePage } from "../../src/routes/admin/gate-page.js";

test("the admin password matches only itself", () => {
  const expected = "correct horse battery";
  assert.equal(verifyPassword("correct horse battery", expected), true);
  assert.equal(verifyPassword("correct horse batter", expected), false);
  assert.equal(verifyPassword("", expected), false);
  assert.equal(verifyPassword(undefined, expected), false);
  assert.equal(verifyPassword("anything", null), false);
});

test("the gate asks for a password field in password mode and a code otherwise", () => {
  assert.match(gatePage({ password: true }), /type="password"/);
  assert.doesNotMatch(gatePage({ password: true }), /one-time-code/);
  assert.match(gatePage({}), /one-time-code/);
});
