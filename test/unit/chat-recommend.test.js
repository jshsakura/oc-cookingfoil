import { test } from "node:test";
import assert from "node:assert/strict";

const { rank } = await import("../../src/chat/recommend.js");

const game = (titleId, genres, rating = null, added = 0) => ({ titleId, genres, rating, added });
const LIBRARY = [
  game("A", ["action"], 80, 5),
  game("B", ["puzzle"], 90, 9),
  game("C", ["action", "rpg"], 70, 1),
  game("D", ["rpg"], 95, 3),
  game("E", ["sports"], 60, 7),
];

test("games sharing more weighted genres come first", () => {
  const weights = new Map([["action", 2], ["rpg", 3]]);
  const out = rank(LIBRARY, { weights, taken: new Set(), limit: 5 });
  assert.deepEqual(out.map((g) => g.titleId), ["C", "D", "A"]);
  assert.deepEqual(out[0].shared, ["action", "rpg"]);
});

test("a game the person already took is left out", () => {
  const weights = new Map([["action", 2]]);
  assert.deepEqual(rank(LIBRARY, { weights, taken: new Set(["A"]), limit: 5 }).map((g) => g.titleId), ["C"]);
});

test("equal scores go to the better reviewed, then the newer game", () => {
  const weights = new Map([["action", 1]]);
  const tie = [game("X", ["action"], 70, 1), game("Y", ["action"], 70, 9), game("Z", ["action"], 90, 0)];
  assert.deepEqual(rank(tie, { weights, taken: new Set(), limit: 3 }).map((g) => g.titleId), ["Z", "Y", "X"]);
});

test("with no history the library's best reviewed and newest come first", () => {
  const out = rank(LIBRARY, { weights: new Map(), taken: new Set(), limit: 3 });
  assert.deepEqual(out.map((g) => g.titleId), ["D", "B", "A"]);
});

test("a named genre keeps only that genre, history or not", () => {
  const out = rank(LIBRARY, { weights: new Map([["puzzle", 5]]), taken: new Set(), genre: "rpg", limit: 5 });
  assert.deepEqual(out.map((g) => g.titleId), ["D", "C"]);
});

test("the limit cuts the list", () => {
  assert.equal(rank(LIBRARY, { weights: new Map(), taken: new Set(), limit: 2 }).length, 2);
});
