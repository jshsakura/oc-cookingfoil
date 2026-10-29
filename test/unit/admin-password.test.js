import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { everything, records, securityDbFile } from "../support/security-db.js";

// The admin password set on the admin page: hashed on disk, works beside the compose one.
const dir = mkdtempSync(path.join(tmpdir(), "cook-adminpw-"));
process.env.COOK_DATA_DIR = dir;
process.env.COOK_ADMIN_PASSWORD = "";
const saved = await import("../../src/security/admin-password.js");
const session = await import("../../src/security/admin-session.js");

test("no password at first; a saved one opens the admin page and is stored only as a hash", async () => {
  assert.equal(session.adminPasswordMode(), false);
  assert.throws(() => saved.set("short"), /12/);
  saved.set("long-enough-pass");
  assert.equal(session.adminPasswordMode(), true);
  assert.equal(await session.verifyPassword("long-enough-pass"), true);
  assert.equal(await session.verifyPassword("long-enough-pasS"), false);
  assert.ok(records(dir, "admin-password").admin.hash, "a hash is kept");
  assert.doesNotMatch(everything(dir), /long-enough-pass/);
  assert.equal(statSync(securityDbFile(dir)).mode & 0o777, 0o600);
});

test("the compose password keeps working beside it, and clearing leaves only that", async () => {
  assert.equal(await session.verifyPassword("compose-secret-1", "compose-secret-1"), true);
  assert.equal(await session.verifyPassword("long-enough-pass", "compose-secret-1"), true);
  saved.clear();
  assert.equal(await session.verifyPassword("long-enough-pass", "compose-secret-1"), false);
  assert.equal(session.adminPasswordMode(), false);
});
