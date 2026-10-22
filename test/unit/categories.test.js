import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeCategories, normalizeGenres, genreLabel, GENRE_LABELS } from "../../src/meta/categories.js";
import { LANGS } from "../../src/meta/langs.js";

test("normalizeCategories keeps distinct trimmed genre names", () => {
  assert.deepEqual(normalizeCategories([" 액션 ", "RPG", "액션"]), ["액션", "RPG"]);
});
test("normalizeCategories drops non-strings, blanks and caps the list", () => {
  assert.deepEqual(normalizeCategories(["a", 3, "", null, "b", "c", "d", "e"]), ["a", "b", "c", "d"]);
  assert.equal(normalizeCategories([]), undefined);
  assert.equal(normalizeCategories("액션"), undefined);
});

test("normalizeGenres folds every language onto one English key", () => {
  assert.deepEqual(normalizeGenres(["Action", "アクション", "액션", "動作"]), ["Action"]);
  assert.deepEqual(normalizeGenres(["파티", "パーティー", "派對"]), ["Party"]);
  assert.deepEqual(normalizeGenres(["ロールプレイング", "Role-Playing"]), ["RPG"]);
  assert.deepEqual(normalizeGenres(["platformer", "First-Person Shooter", "슈팅"]), ["Platformer", "Shooter"]);
  assert.deepEqual(normalizeGenres(["その他", "Other", "기타"]), ["Other"]);
  assert.deepEqual(normalizeGenres(["テーブル", "보드", "Board Game"]), ["Board Game"]);
});
test("normalizeGenres drops tags that are not genres before capping the list", () => {
  assert.deepEqual(normalizeGenres(["Multiplayer", "Updates", "Party", "Action", "Puzzle", "Arcade", "Racing"]),
    ["Party", "Action", "Puzzle", "Arcade"]);
  assert.equal(normalizeGenres(["Multiplayer"]), undefined);
});
test("normalizeGenres leaves out a name that is no known genre", () => {
  assert.deepEqual(normalizeGenres(["Roguelike", "액션", "Shop"]), ["Action"]);
  assert.equal(normalizeGenres(["Shop"]), undefined);
});
test("normalizeGenres folds simplified Chinese and store-specific names", () => {
  assert.deepEqual(normalizeGenres(["体育", "训练", "家庭", "生活方式"]), ["Sports", "Training", "Party", "Utility"]);
  assert.deepEqual(normalizeGenres(["System Tool", "动作", "冒险"]), ["Utility", "Action", "Adventure"]);
});
test("every genre key has a label in every language", () => {
  for (const labels of Object.values(GENRE_LABELS)) {
    for (const lang of LANGS) assert.ok(labels[lang], JSON.stringify(labels));
  }
  assert.equal(genreLabel("Party", "ko"), "파티");
  assert.equal(genreLabel("Action", "zh"), "动作", "zh is simplified");
  assert.equal(genreLabel("Action", "zh-Hant"), "動作");
  assert.deepEqual(normalizeGenres(["Abenteuer", "Réflexion", "Гонки"]), ["Adventure", "Puzzle", "Racing"], "a European region's genres fold onto the keys");
  assert.equal(genreLabel("Party", "ja"), "パーティー");
  assert.equal(genreLabel("Roguelike", "ko"), "Roguelike");
});
