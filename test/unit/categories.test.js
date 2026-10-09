import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeCategories } from "../../src/meta/categories.js";

test("normalizeCategories keeps distinct trimmed genre names", () => {
  assert.deepEqual(normalizeCategories([" 액션 ", "RPG", "액션"]), ["액션", "RPG"]);
});
test("normalizeCategories drops non-strings, blanks and caps the list", () => {
  assert.deepEqual(normalizeCategories(["a", 3, "", null, "b", "c", "d", "e"]), ["a", "b", "c", "d"]);
  assert.equal(normalizeCategories([]), undefined);
  assert.equal(normalizeCategories("액션"), undefined);
});
