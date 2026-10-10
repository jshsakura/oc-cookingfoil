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

test("the gate asks for what the login needs: password, code, or both", () => {
  assert.match(gatePage({ mode: "password" }), /type="password"/);
  assert.doesNotMatch(gatePage({ mode: "password" }), /one-time-code/);
  assert.match(gatePage({}), /one-time-code/);
  assert.doesNotMatch(gatePage({}), /type="password"/);
  const both = gatePage({ mode: "both" });
  assert.match(both, /type="password"/);
  assert.match(both, /one-time-code/);
});
