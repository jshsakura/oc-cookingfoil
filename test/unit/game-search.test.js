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
  assert.deepEqual(searchGames(GAMES, "zzzz"), { total: 0, offset: 0, items: [] });
});

// Words caught halfway by the Korean input method: the list must not go empty between keystrokes.
const KOREAN = [
  { titleId: "0100000000040000", name: "젤다의 전설", names: { ko: "젤다의 전설", en: "The Legend of Zelda" } },
  { titleId: "01006F8002326000", name: "모여봐요 동물의 숲", names: { en: "Animal Crossing: New Horizons" } },
  { titleId: "0100000000050000", name: "달걀 공장", names: null },
];

test("a trailing consonant typed on its own still finds the word it starts", () => {
  assert.deepEqual(ids(searchGames(KOREAN, "젤ㄷ")), ["0100000000040000"]);
  assert.deepEqual(ids(searchGames(KOREAN, "모ㅇ")), ["01006F8002326000"]);
});

test("a consonant the input method stuck on as a final still finds the next syllable", () => {
  assert.deepEqual(ids(searchGames(KOREAN, "모엽")), ["01006F8002326000"]);
  assert.deepEqual(ids(searchGames(KOREAN, "닭")), ["0100000000050000"]);
});

test("a vowel still being built (보 on the way to 봐) finds the game", () => {
  assert.deepEqual(ids(searchGames(KOREAN, "모여보")), ["01006F8002326000"]);
});

test("every prefix of a Korean name typed key by key finds that game", () => {
  const steps = ["ㅁ", "모", "몽", "모여", "모엽", "모여보", "모여봐", "모여봥", "모여봐요"];
  for (const q of steps) assert.ok(ids(searchGames(KOREAN, q)).includes("01006F8002326000"), q);
});

test("Japanese voiced marks are kept: ハ, バ and パ are different letters", () => {
  const games = [
    { titleId: "0100000000060000", name: "パンダ", names: null },
    { titleId: "0100000000070000", name: "バンダイ", names: null },
    { titleId: "0100000000080000", name: "ハンター", names: null },
  ];
  assert.deepEqual(ids(searchGames(games, "ハンタ")), ["0100000000080000"]);
  assert.deepEqual(ids(searchGames(games, "パンダ")), ["0100000000060000"]);
});

test("width and case fold: halfwidth katakana and fullwidth Latin find the usual forms", () => {
  const games = [
    { titleId: "0100000000060000", name: "パンダ", names: null },
    { titleId: "0100000000090000", name: "Zelda", names: null },
  ];
  assert.deepEqual(ids(searchGames(games, "ﾊﾟﾝﾀﾞ")), ["0100000000060000"]);
  assert.deepEqual(ids(searchGames(games, "ＺＥＬＤＡ")), ["0100000000090000"]);
});

test("a filled-in \"name [ID]\" finds that game, also with the closing bracket deleted", () => {
  for (const q of ["Super Mario Odyssey [0100000000010000]", "Super Mario Odyssey [0100000000010000", "아무 이름 [0100000000010000]"]) {
    assert.deepEqual(ids(searchGames(GAMES, q)), ["0100000000010000"], q);
  }
});

test("a number in a title does not match title IDs by chance", () => {
  const games = [
    { titleId: "0100000001945000", name: "Strikers 1945", names: null },
    { titleId: "0100194500010000", name: "Other", names: null },
  ];
  const r = searchGames(games, "1945");
  assert.deepEqual(ids(r), ["0100000001945000"]);
  assert.equal(r.total, 1);
});

test("results carry whether the admin wrote about the game", () => {
  const r = searchGames([{ titleId: "0100000000010000", name: "A", edited: true }, { titleId: "0100000000020000", name: "B" }], "");
  assert.deepEqual(r.items.map((g) => g.edited), [true, false]);
});

test("pages walk the whole list, and recent puts the newest game first", () => {
  const games = Array.from({ length: 5 }, (_, i) => ({ titleId: `010000000000${i}000`, name: `Game ${i}`, added: i }));
  const page2 = searchGames(games, "", { limit: 2, offset: 2 });
  assert.equal(page2.total, 5);
  assert.equal(page2.offset, 2);
  assert.deepEqual(page2.items.map((g) => g.name), ["Game 2", "Game 3"]);
  assert.deepEqual(searchGames(games, "", { sort: "recent", limit: 2 }).items.map((g) => g.name), ["Game 4", "Game 3"]);
});

test("a very long query is cut instead of costing more", () => {
  assert.equal(searchGames(GAMES, "마".repeat(10_000)).total, 0);
});
