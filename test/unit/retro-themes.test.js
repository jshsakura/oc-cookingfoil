import { test } from "node:test";
import assert from "node:assert/strict";
import { factsOf, facetsOf, factsFilter, genreSlug, makerOf } from "../../src/retro/themes.js";
import { GENRE_LABELS } from "../../src/meta/categories.js";

const game = (i, over = {}) => ({ id: `g${i}`, work: `g${i}`, system: i % 2 ? "snes" : "gba", genres: ["RPG"], players: 1, year: 1995, korean: false, achievements: false, region: "jp", rating: 50 + (i % 50), ratingCount: 100, addedAt: i, ...over });

test("a game's facts come from its record and its versions, unknowns left empty", () => {
  const record = { genres: ["RPG"], styles: ["beat-em-up"], numberOfPlayers: 2, releaseDate: 19950311, cooperative: true, esrb: "E10+", developer: "Square Co., Ltd.", series: "Mana" };
  const f = factsOf({ id: "a", system: "snes", rating: 90, ratingCount: 3, addedAt: 5, size: 4 }, { record, korean: true, region: "kr", achievements: true });
  assert.deepEqual(f, {
    id: "a", work: "a", system: "snes", genres: ["RPG"], styles: ["beat-em-up"], arcadeStyle: null, players: 2, simultaneous: null,
    cooperative: true, family: true, maker: "Square", series: "Mana", year: 1995, korean: true, achievements: true, region: "kr",
    rating: 90, ratingCount: 3, addedAt: 5, size: 4,
  });
  assert.deepEqual(factsOf({ id: "b", system: "nes" }).genres, []);
  assert.equal(factsOf({ id: "b", system: "nes" }).year, null);
});

test("facets count what a system has and leave out what nobody has", () => {
  const list = [game(1, { genres: ["RPG", "Action"], players: 2, korean: true }), game(2, { players: 4, year: 1988, region: "us" }), game(3, { genres: [], year: null, achievements: true })];
  const f = facetsOf(list, "ko");
  assert.deepEqual(f.genres.map((g) => [g.key, g.count]), [["rpg", 2], ["action", 1]]);
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
  assert.deepEqual(ids({ genre: "rpg,action" }), ["g1", "g2"]);
  assert.deepEqual(ids({ genre: "rpg,action", players: "2" }), ["g1"]);
  assert.deepEqual(ids({ korean: "1" }), ["g3"]);
  assert.deepEqual(ids({ decade: "1980" }), ["g3"]);
  assert.deepEqual(ids({ region: "JP" }), ["g1", "g2", "g3"]);
  assert.equal(factsFilter({ genre: "RPG" })(undefined), false, "a game without facts never matches");
});

test("a maker reads the same however the sources write it", () => {
  assert.equal(makerOf({ publisher: "Sega of America" }), "Sega");
  assert.equal(makerOf({ publisher: "Sega Enterprises" }), "Sega");
  assert.equal(makerOf({ publisher: "Taito Corporation Japan" }, true), "Taito");
  assert.equal(makerOf({ developer: "Capcom; Arika", publisher: "Capcom" }), "Capcom");
  assert.equal(makerOf({ developer: "Nintendo EAD" }), "Nintendo EAD");
  assert.equal(makerOf({ developer: "Capcom", publisher: "Virgin" }, true), "Virgin", "an arcade set goes by who put it out");
  assert.equal(makerOf({}), null);
});

test("every genre key the client receives has the agreed shape", () => {
  for (const key of Object.keys(GENRE_LABELS)) assert.match(genreSlug(key), /^[a-z0-9-]+$/, key);
  assert.equal(genreSlug("Beat 'em Up"), "beat-em-up");
  const list = ["kr", "jp", "us", "Bad Region"].map((region, i) => game(i, { region }));
  assert.deepEqual(facetsOf(list).regions.map((r) => r.value).sort(), ["jp", "kr", "us"]);
  assert.equal(list.filter(factsFilter({ genre: "rpg" })).length, 4);
});
