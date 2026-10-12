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

test("the gate asks for what the server has: password, code, or a choice of the two", () => {
  assert.match(gatePage({ mode: "password" }), /type="password"/);
  assert.doesNotMatch(gatePage({ mode: "password" }), /one-time-code/);
  assert.match(gatePage({}), /one-time-code/);
  assert.doesNotMatch(gatePage({}), /type="password"/);
  const either = gatePage({ mode: "either" });
  assert.match(either, /type="password"/);
  assert.match(either, /one-time-code/);
  assert.match(either, /data-use="code"[^>]*>인증 앱 코드<\/button><button[^>]*data-use="pw"/, "a switch between the two");
  assert.match(either, /COOK_ADMIN_PASSWORD/, "says which password it means");
});
