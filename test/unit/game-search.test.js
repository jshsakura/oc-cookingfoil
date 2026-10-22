import { test } from "node:test";
import assert from "node:assert/strict";
import { searchGames, choseong } from "../../src/meta/game-search.js";

const GAMES = [
  { titleId: "0100000000010000", name: "Super Mario Odyssey", names: { ko: "슈퍼 마리오 오디세이", en: "Super Mario Odyssey", ja: "スーパーマリオ オデッセイ" } },
  { titleId: "01006F8002326000", name: "Animal Crossing: New Horizons", names: { ko: "모여봐요 동물의 숲", en: "Animal Crossing: New Horizons" } },
  { titleId: "0100A3D008C5C000", name: "포켓몬스터 스칼렛", names: { ko: "포켓몬스터 스칼렛", en: "Pokémon Scarlet" } },
  { titleId: "0100ABF008968000", name: "Pokémon Sword", names: null },
];
const ids = (r) => r.items.map((g) => g.titleId);

test("a partial Korean name finds the game, spaces in the name or query aside", () => {
  assert.deepEqual(ids(searchGames(GAMES, "마리오")), ["0100000000010000"]);
  assert.deepEqual(ids(searchGames(GAMES, "동물의숲")), ["01006F8002326000"]);
});

test("the English name finds a game listed under its Korean name, case-insensitively", () => {
  const r = searchGames(GAMES, "SCARLET");
  assert.deepEqual(ids(r), ["0100A3D008C5C000"]);
  // The name that matched is handed back when it is not the one shown.
  assert.equal(r.items[0].name, "포켓몬스터 스칼렛");
  assert.equal(r.items[0].matched, "Pokémon Scarlet");
});

test("other languages the server has are searched too", () => {
  assert.deepEqual(ids(searchGames(GAMES, "オデッセイ")), ["0100000000010000"]);
});

test("a full or partial title ID finds the game, in either case", () => {
  assert.deepEqual(ids(searchGames(GAMES, "01006f8002326000")), ["01006F8002326000"]);
  assert.deepEqual(ids(searchGames(GAMES, "6f80023")), ["01006F8002326000"]);
});

test("Korean initial consonants find a game", () => {
  assert.equal(choseong("동물의 숲"), "ㄷㅁㅇㅅ");
  assert.deepEqual(ids(searchGames(GAMES, "ㅁㅇㅂㅇ")), ["01006F8002326000"]);
  assert.deepEqual(ids(searchGames(GAMES, "ㅍㅋㅁ")), ["0100A3D008C5C000"]);
});

test("better matches come first: a name that starts with the query before one that contains it", () => {
  const games = [
    { titleId: "0100000000020000", name: "New Pokémon Snap", names: null },
    { titleId: "0100000000030000", name: "Pokémon Legends", names: null },
  ];
  assert.deepEqual(ids(searchGames(games, "pokémon")), ["0100000000030000", "0100000000020000"]);
});

test("results are capped and the total says how many matched", () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ titleId: `01000000000${String(i).padStart(2, "0")}000`.padEnd(16, "0").slice(0, 16), name: `Game ${i}`, names: null }));
  const r = searchGames(many, "game", { limit: 20 });
  assert.equal(r.items.length, 20);
  assert.equal(r.total, 30);
});

test("an empty query lists games by name, and a query that matches nothing returns none", () => {
  assert.equal(searchGames(GAMES, "").total, GAMES.length);
  assert.deepEqual(searchGames(GAMES, "zzzz"), { total: 0, items: [] });
});
