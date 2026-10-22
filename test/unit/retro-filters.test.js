import { test } from "node:test";
import assert from "node:assert/strict";
import { filtersOf, SORTS } from "../../src/retro/filters.js";
import { factsFilter } from "../../src/retro/themes.js";

const MB = 1024 * 1024;
const fact = (id, over = {}) => ({ id, genres: [], styles: [], arcadeStyle: null, players: null, year: null, region: null, korean: false, achievements: false, rating: null, ...over });
const FACTS = [
  fact("a", { genres: ["Beat 'em Up"], styles: ["beat-em-up"], players: 2, year: 1991, region: "jp", rating: 85, korean: true }),
  fact("b", { genres: ["Shooter"], arcadeStyle: "vertical-shmup", players: 2, year: 1994, region: "us", rating: 92 }),
  fact("c", { genres: ["Shooter"], players: 1, year: 1987, region: "jp", achievements: true }),
];
const GAMES = [{ id: "a", size: 5 * MB, bezel: { generic: false } }, { id: "b", size: 50 * MB, bezel: { generic: true } }, { id: "c", size: 2 * MB, bezel: null }];
const byId = new Map(FACTS.map((f) => [f.id, f]));
const groupOf = (out, key) => out.groups.find((g) => g.key === key);

test("every group the console's games can fill, worded in four languages, with options no game has left out", () => {
  const out = filtersOf(GAMES, (id) => byId.get(id));
  assert.deepEqual(out.groups.map((g) => [g.key, g.pick]), [["genre", "many"], ["players", "one"], ["decade", "many"], ["region", "many"], ["rating", "one"], ["size", "one"], ["features", "many"]]);
  const genre = groupOf(out, "genre");
  assert.equal(genre.ko, "장르");
  assert.deepEqual(genre.options.map((o) => [o.key, o.ko, o.count]), [["shooter", "슈팅", 2], ["beat-em-up", "벨트스크롤 액션", 1], ["vertical-shmup", "종스크롤 슈팅", 1]],
    "genres and play styles by count, a genre and a style of one name once");
  assert.deepEqual(genre.options[1].params, { genre: "beat-em-up" });
  assert.deepEqual(groupOf(out, "players").options.map((o) => [o.ko, o.count, o.params.players]), [["2인 이상", 2, "2"]]);
  assert.deepEqual(groupOf(out, "decade").options.map((o) => [o.ko, o.count]), [["1980년대", 1], ["1990년대", 2]]);
  assert.deepEqual(groupOf(out, "region").options.map((o) => [o.key, o.en, o.count]), [["jp", "Japan", 2], ["us", "North America", 1]]);
  assert.deepEqual(groupOf(out, "rating").options.map((o) => [o.ko, o.count, o.params.minRating]), [["평점 90 이상", 1, "90"], ["평점 80 이상", 2, "80"]]);
  assert.deepEqual(groupOf(out, "size").options.map((o) => [o.ko, o.count]), [["10MB 이하", 2], ["100MB 이하", 3], ["1GB 이하", 3]]);
  assert.deepEqual(groupOf(out, "features").options.map((o) => [o.ko, o.count, o.params]), [["한국어", 1, { korean: "1" }], ["업적", 1, { achievements: "1" }], ["전용 베젤", 1, { bezel: "1" }]]);
  for (const g of out.groups) for (const l of ["en", "ko", "ja", "zh"]) assert.ok(g[l] && g.options.every((o) => o[l]), `${g.key} ${l}`);
  assert.deepEqual(out.sorts.map((s) => s.key), ["rating", "name", "added", "size"]);
  assert.equal(SORTS[0].ko, "평점순");
});

test("a console with no metadata sends only what it knows", () => {
  const out = filtersOf([{ id: "x", size: MB, bezel: null }], () => fact("x"));
  assert.deepEqual(out.groups.map((g) => g.key), ["size"]);
});

test("the list filter takes comma lists for genre, decade and region, and finds play styles by genre", () => {
  const keep = (q) => FACTS.filter(factsFilter(q)).map((f) => f.id);
  assert.deepEqual(keep({ genre: "beat-em-up" }), ["a"]);
  assert.deepEqual(keep({ genre: "vertical-shmup" }), ["b"], "an arcade style is a genre key too");
  assert.deepEqual(keep({ genre: "beat-em-up,vertical-shmup" }), ["a", "b"]);
  assert.deepEqual(keep({ decade: "1980,1990" }), ["a", "b", "c"]);
  assert.deepEqual(keep({ decade: "1990", region: "jp,us" }), ["a", "b"]);
  assert.deepEqual(keep({ region: "JP", players: "2" }), ["a"]);
});
