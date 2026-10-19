import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Which homebrew apps the admin tried on a console: kept with when, and given to the shop.
process.env.COOK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cf-hb-verified-"));
const verified = await import("../../src/meta/homebrew-verified.js");

test("an app marked verified keeps when it was, survives a reload, and can be unmarked", () => {
  const id = "m-0123456789ab";
  assert.equal(verified.verifiedAt(id), null);
  assert.equal(verified.set(id, true, 1_800_000_000_000), true);
  assert.equal(verified.verifiedAt(id), 1_800_000_000_000);
  verified.reset();
  assert.equal(verified.verifiedAt(id), 1_800_000_000_000, "read back from the file");
  assert.equal(verified.set(id, true, 1_900_000_000_000), true);
  assert.equal(verified.verifiedAt(id), 1_800_000_000_000, "marking again keeps the first date");
  assert.equal(verified.set(id, false), true);
  assert.equal(verified.verifiedAt(id), null);
});

test("an id that is not an app's is refused", () => {
  assert.equal(verified.set("../x", true), false);
  assert.equal(verified.set("gh-zz", true), false);
});

test("the shop fields: verified and verified_at, null when not", () => {
  verified.set("gh-aaaaaaaaaaaa", true, 1_800_000_000_000);
  assert.deepEqual(verified.fields("gh-aaaaaaaaaaaa"), { verified: true, verified_at: "2027-01-15T08:00:00.000Z" });
  assert.deepEqual(verified.fields("gh-bbbbbbbbbbbb"), { verified: false, verified_at: null });
});
