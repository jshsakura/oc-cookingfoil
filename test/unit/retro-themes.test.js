import { test } from "node:test";
import assert from "node:assert/strict";
import { factsOf, facetsOf, factsFilter, pickThemes } from "../../src/retro/themes.js";

const game = (i, over = {}) => ({ id: `g${i}`, system: i % 2 ? "snes" : "gba", genres: ["RPG"], players: 1, year: 1995, korean: false, achievements: false, region: "jp", rating: 50 + (i % 50), ratingCount: 100, addedAt: i, ...over });

test("a game's facts come from its record and its versions, unknowns left empty", () => {
  const f = factsOf({ id: "a", system: "snes", rating: 90, ratingCount: 3, addedAt: 5 }, { record: { genres: ["RPG"], numberOfPlayers: 2, releaseDate: 19950311 }, korean: true, region: "kr", achievements: true });
  assert.deepEqual(f, { id: "a", system: "snes", genres: ["RPG"], players: 2, year: 1995, korean: true, achievements: true, region: "kr", rating: 90, ratingCount: 3, addedAt: 5 });
  assert.deepEqual(factsOf({ id: "b", system: "nes" }).genres, []);
  assert.equal(factsOf({ id: "b", system: "nes" }).year, null);
});

test("facets count what a system has and leave out what nobody has", () => {
  const list = [game(1, { genres: ["RPG", "Action"], players: 2, korean: true }), game(2, { players: 4, year: 1988, region: "us" }), game(3, { genres: [], year: null, achievements: true })];
  const f = facetsOf(list, "ko");
  assert.deepEqual(f.genres.map((g) => [g.key, g.count]), [["RPG", 2], ["Action", 1]]);
  assert.equal(f.genres[1].name, "액션", "names in the asked language");
  assert.deepEqual(f.players, [{ value: 2, count: 2 }, { value: 3, count: 1 }, { value: 4, count: 1 }]);
  assert.deepEqual(f.decades, [{ value: 1980, count: 1 }, { value: 1990, count: 1 }]);
  assert.deepEqual(f.regions, [{ value: "jp", count: 2 }, { value: "us", count: 1 }]);
  assert.equal(f.korean, 1);
  assert.equal(f.achievements, 1);
  assert.deepEqual(facetsOf([game(1, { genres: [], players: 1, year: null, region: null })]), {});
});

test("the filters combine with AND, genres within one filter with OR", () => {
  const list = [game(1, { genres: ["RPG"], players: 2 }), game(2, { genres: ["Action"], players: 1 }), game(3, { genres: ["Puzzle"], korean: true, year: 1988 })];
  const ids = (q) => list.filter(factsFilter(q)).map((f) => f.id);
  assert.equal(factsFilter({}), null, "no filter asked, none applied");
  assert.deepEqual(ids({ genre: "RPG,Action" }), ["g1", "g2"]);
  assert.deepEqual(ids({ genre: "RPG,Action", players: "2" }), ["g1"]);
  assert.deepEqual(ids({ korean: "1" }), ["g3"]);
  assert.deepEqual(ids({ decade: "1980" }), ["g3"]);
  assert.deepEqual(ids({ region: "JP" }), ["g1", "g2", "g3"]);
  assert.equal(factsFilter({ genre: "RPG" })(undefined), false, "a game without facts never matches");
});

test("theme rows: at most six, twelve each, no game twice, none under eight, genres and the rest mixed", () => {
  const genres = ["RPG", "Action", "Platformer", "Shooter", "Fighting", "Sports", "Puzzle"];
  const list = Array.from({ length: 400 }, (_, i) => game(i, {
    genres: [genres[i % genres.length]], players: i % 3 ? 1 : 2, korean: i % 5 === 0, achievements: i % 4 === 0,
    year: 1980 + (i % 30), ratingCount: i % 7 ? 500 : 5, rating: 60 + (i % 40),
  }));
  const rows = pickThemes(list, { day: 20000, lang: "ko" });
  assert.equal(rows.length, 6);
  const seen = new Set();
  for (const r of rows) {
    assert.ok(r.games.length >= 8 && r.games.length <= 12, r.id);
    for (const g of r.games) {
      assert.ok(!seen.has(g.id), `${g.id} shows up twice`);
      seen.add(g.id);
    }
  }
  const kinds = rows.map((r) => (r.id.startsWith("genre:") ? "genre" : "other"));
  assert.ok(kinds.includes("genre") && kinds.includes("other"), kinds.join());
  for (let i = 2; i < kinds.length; i++) assert.ok(!(kinds[i] === kinds[i - 1] && kinds[i] === kinds[i - 2]), "no three of a kind in a row");
  assert.deepEqual(pickThemes(list, { day: 20000, lang: "ko" }), rows, "one day, one answer");
  assert.notDeepEqual(pickThemes(list, { day: 20001, lang: "ko" }).map((r) => r.id), rows.map((r) => r.id), "another day, other rows");
});

test("a decade and a genre make one theme, named in the asked language", () => {
  const list = Array.from({ length: 10 }, (_, i) => game(i, { genres: ["RPG"], year: 1993 }));
  const rows = pickThemes(list, { day: 3, lang: "ko", rows: 20, per: 1, min: 1 });
  const combo = rows.find((r) => r.id === "decade:1990:genre:RPG");
  assert.ok(combo, rows.map((r) => r.id).join());
  assert.match(combo.name, /^90년대 /);
});

test("a theme with fewer than eight games is left out", () => {
  const list = Array.from({ length: 7 }, (_, i) => game(i, { genres: ["Racing"] }));
  assert.deepEqual(pickThemes(list, { day: 1 }), []);
});
