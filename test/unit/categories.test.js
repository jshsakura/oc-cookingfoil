import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeCategories, normalizeGenres } from "../../src/meta/categories.js";

test("normalizeCategories keeps distinct trimmed genre names", () => {
  assert.deepEqual(normalizeCategories([" 액션 ", "RPG", "액션"]), ["액션", "RPG"]);
});
test("normalizeCategories drops non-strings, blanks and caps the list", () => {
  assert.deepEqual(normalizeCategories(["a", 3, "", null, "b", "c", "d", "e"]), ["a", "b", "c", "d"]);
  assert.equal(normalizeCategories([]), undefined);
  assert.equal(normalizeCategories("액션"), undefined);
});

test("normalizeGenres folds English, Japanese and Chinese genres onto the Korean names", () => {
  assert.deepEqual(normalizeGenres(["Action", "アクション", "액션", "動作"]), ["액션"]);
  assert.deepEqual(normalizeGenres(["Party", "パーティー", "派對"]), ["파티"]);
  assert.deepEqual(normalizeGenres(["ロールプレイング", "Role-Playing"]), ["RPG"]);
  assert.deepEqual(normalizeGenres(["platformer", "First-Person Shooter", "Shooter"]), ["플랫포머", "슈팅"]);
  assert.deepEqual(normalizeGenres(["その他", "Other", "기타"]), ["기타"]);
});
test("normalizeGenres drops tags that are not genres before capping the list", () => {
  assert.deepEqual(normalizeGenres(["Multiplayer", "Updates", "Party", "Action", "Puzzle", "Arcade", "Racing"]),
    ["파티", "액션", "퍼즐", "아케이드"]);
  assert.equal(normalizeGenres(["Multiplayer"]), undefined);
});
test("normalizeGenres keeps an unknown genre as written", () => {
  assert.deepEqual(normalizeGenres(["Roguelike", "Action"]), ["Roguelike", "액션"]);
});
