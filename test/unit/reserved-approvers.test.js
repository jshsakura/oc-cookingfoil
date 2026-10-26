import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// "admin", "auto" and "telegram" are what the server writes for approvals no
// account made. No account may take those names, and an account that has one
// from before still never owns or revokes those consoles. Such a console has
// no account holding it, so any download gives it a new key.
process.env.COOK_DATA_DIR = mkdtempSync(path.join(tmpdir(), "cook-reserved-"));
process.env.COOK_AUTH_USERS = "";
process.env.COOK_DEVICE_PAIRING = "true";
const users = await import("../../src/security/users.js");
const store = await import("../../src/security/store.js");
const { ownsApproval } = await import("../../src/routes/device-pair.js");
const { mayEnroll } = await import("../../src/routes/pair.js");

test("an account cannot be named after a system approver, in any case", () => {
  users.add("owner", "owner-password-1", "admin");
  for (const name of ["admin", "auto", "telegram", "Admin", "TELEGRAM"]) {
    assert.throws(() => users.add(name, "long-enough-pass"), (err) => err.code === "invalid-name", name);
  }
  assert.equal(users.add("alice", "alice-password-1").name, "alice");
});

test("an account named like a system approver owns none of those consoles", () => {
  const account = (user) => ({ auth: { user } });
  for (const marker of ["admin", "auto", "telegram"]) {
    assert.equal(ownsApproval(account(marker), marker, marker), false, marker);
  }
  assert.equal(ownsApproval(account("alice"), "alice", "alice"), true, "an account owns what it approved");
  assert.equal(ownsApproval(account("alice"), "alice", "bob"), false);
  assert.equal(ownsApproval({}, "admin", "admin"), true, "the admin's own session still owns its approvals");
});

test("a console the server approved takes a new key from any download; an account's console stays its own", () => {
  const key = (c) => c.repeat(64);
  store.approveDevice(key("A"), { addedBy: "admin", accessKeyHash: "h" });
  store.approveDevice(key("B"), { addedBy: "alice", accessKeyHash: "h" });
  assert.equal(mayEnroll(key("A"), "alice"), true, "an admin-approved console re-enrolls with an account's download");
  assert.equal(mayEnroll(key("B"), "alice"), true, "the same account enrolls its own console again");
  assert.equal(mayEnroll(key("B"), "owner"), false, "another account's console stays theirs");
  assert.equal(mayEnroll(key("C"), "alice"), true, "a free console enrolls");
});
