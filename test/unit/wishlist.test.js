import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.COOK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cf-wish-unit-"));
const wishlist = await import("../../src/security/wishlist.js");

const TID = (n) => `01000000000${String(n).padStart(5, "0")}`;

test("title ids are 16 hex digits, cleaned to upper case", () => {
  assert.equal(wishlist.cleanTitleId(" 0100abcdef012000 "), "0100ABCDEF012000");
  for (const bad of ["0100", "zz00000000000000", 5, null, "0100000000010000x"]) assert.equal(wishlist.cleanTitleId(bad), null, String(bad));
});

test("a list holds at most MAX_WISHES and keeps the name short", () => {
  wishlist.resetForTests();
  for (let i = 0; i < wishlist.MAX_WISHES; i++) assert.ok(wishlist.add("alice", TID(i), "g").wish);
  assert.deepEqual(wishlist.add("alice", TID(99999), "g"), { refused: "full" });
  assert.equal(wishlist.add("alice", TID(0), "g").existing, true, "a wish already there is still answered when full");
  assert.equal(wishlist.add("bob", TID(1), "n".repeat(500)).wish.name.length, 200);
});

test("removing the last wish leaves an empty list, and a second remove says nothing went", () => {
  wishlist.resetForTests();
  wishlist.add("alice", TID(1), "a");
  assert.equal(wishlist.remove("alice", TID(1)), true);
  assert.equal(wishlist.remove("alice", TID(1)), false);
  assert.deepEqual(wishlist.list("alice"), []);
});
