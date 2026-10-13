import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The admin password set on the admin page: hashed on disk, works beside the compose one.
const dir = mkdtempSync(path.join(tmpdir(), "cook-adminpw-"));
process.env.COOK_DATA_DIR = dir;
process.env.COOK_ADMIN_PASSWORD = "";
const saved = await import("../../src/security/admin-password.js");
const session = await import("../../src/security/admin-session.js");

test("no password at first; a saved one opens the admin page and is stored only as a hash", () => {
  assert.equal(session.adminPasswordMode(), false);
  assert.throws(() => saved.set("short"), /12/);
  saved.set("long-enough-pass");
  assert.equal(session.adminPasswordMode(), true);
  assert.equal(session.verifyPassword("long-enough-pass"), true);
  assert.equal(session.verifyPassword("long-enough-pasS"), false);
  const file = path.join(dir, "security", "admin-password.json");
  assert.doesNotMatch(readFileSync(file, "utf8"), /long-enough-pass/);
  assert.equal(statSync(file).mode & 0o777, 0o600);
});

test("the compose password keeps working beside it, and clearing leaves only that", () => {
  assert.equal(session.verifyPassword("compose-secret-1", "compose-secret-1"), true);
  assert.equal(session.verifyPassword("long-enough-pass", "compose-secret-1"), true);
  saved.clear();
  assert.equal(session.verifyPassword("long-enough-pass", "compose-secret-1"), false);
  assert.equal(session.adminPasswordMode(), false);
});
