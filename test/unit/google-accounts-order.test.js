import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.COOK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cf-gorder-"));
const accounts = await import("../../src/security/google-accounts.js");

test("the account list puts waiting accounts first, then the most recently approved", () => {
  for (const [sub, at] of [["a", 100], ["b", 200], ["c", 300], ["d", 400], ["e", 500]]) {
    accounts.signIn({ sub, email: `${sub}@example.com` }, at);
  }
  accounts.setStatus("a", "approved", 1000);
  accounts.setStatus("c", "approved", 3000);
  accounts.setStatus("b", "approved", 2000);
  accounts.setStatus("e", "approved", 600);
  accounts.setStatus("e", "disabled", 700);
  assert.deepEqual(accounts.list().map((a) => a.sub), ["d", "c", "b", "a", "e"]);
});
