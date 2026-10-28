import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// A token is an admin one unless it is made as "catalog"; tokens from before scopes stay admin.
process.env.COOK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cook-token-scope-"));
const tokens = await import("../../src/security/api-tokens.js");

test("a token is made with a scope, listed with it, and an unknown scope is refused", () => {
  const admin = tokens.create("alice", "ops");
  const catalog = tokens.create("alice", "scraper", { scope: "catalog" });
  const listed = Object.fromEntries(tokens.list().map((t) => [t.id, t.scope]));
  assert.equal(listed[admin.id], "admin");
  assert.equal(listed[catalog.id], "catalog");
  assert.equal(tokens.scopeOf(tokens.verify(`Bearer ${catalog.token}`)), "catalog");
  assert.throws(() => tokens.create("alice", "x", { scope: "root" }), (e) => e.code === "token.scope");
  assert.equal(tokens.scopeOf({ id: "old" }), "admin", "a token from before scopes");
});
