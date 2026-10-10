import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCategories, normalizeGenres, genreLabel, requestLang, GENRE_LABELS, GENRE_LANGS,
} from "../../src/meta/categories.js";

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
test("normalizeGenres keeps an unknown genre as written", () => {
  assert.deepEqual(normalizeGenres(["Roguelike", "액션"]), ["Roguelike", "Action"]);
});
test("every genre key has a label in every language", () => {
  for (const labels of Object.values(GENRE_LABELS)) {
    for (const lang of GENRE_LANGS) assert.ok(labels[lang], JSON.stringify(labels));
  }
  assert.equal(genreLabel("Party", "ko"), "파티");
  assert.equal(genreLabel("Party", "ja"), "パーティー");
  assert.equal(genreLabel("Roguelike", "ko"), "Roguelike");
});
test("requestLang prefers ?lang=, then Accept-Language, then English", () => {
  const req = (query, header) => ({ query, get: () => header });
  assert.equal(requestLang(req({ lang: "ko" }, "ja-JP")), "ko");
  assert.equal(requestLang(req({}, "ja-JP,ja;q=0.9")), "ja");
  assert.equal(requestLang(req({}, "fr-FR")), "en");
  assert.equal(requestLang(req({}, undefined)), "en");
});
