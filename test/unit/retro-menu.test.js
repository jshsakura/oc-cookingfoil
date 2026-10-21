import { test } from "node:test";
import assert from "node:assert/strict";
import { pickMenu, menuRows, MENU_GAMES, MENU_MIN } from "../../src/retro/menu.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 21, 3, 0); // 12:00 in Korea
const SYSTEMS = ["snes", "gba", "nes", "md", "gb", "psp"];
const GENRES = ["RPG", "Action", "Platformer", "Shooter", "Fighting", "Puzzle"];
const STYLES = ["vertical-shmup", "versus-fighter", "beat-em-up", "run-and-gun"];

const fact = (i, over = {}) => ({
  id: `g${i}`, work: `w${i}`, system: SYSTEMS[i % SYSTEMS.length], genres: [GENRES[i % GENRES.length]], styles: [], arcadeStyle: null,
  players: (i % 4) + 1, simultaneous: null, cooperative: i % 9 === 0, family: i % 5 === 0, maker: ["Capcom", "Konami", "Hudson"][i % 3],
  series: null, year: 1985 + (i % 25), korean: i % 6 === 0, achievements: i % 3 === 0, region: "jp",
  rating: 55 + (i % 45), ratingCount: 5 + (i % 300), addedAt: (NOW - 400 * DAY) / 1000, size: 1e6, ...over,
});
const arcade = (i, over = {}) => fact(i, { system: "arcade", arcadeStyle: STYLES[i % STYLES.length], simultaneous: (i % 2) + 2, rating: null, ratingCount: 0, players: 2, ...over });
const library = ({ recent = 20 } = {}) => [
  ...Array.from({ length: 500 }, (_, i) => fact(i)),
  ...Array.from({ length: 120 }, (_, i) => arcade(1000 + i)),
  ...Array.from({ length: recent }, (_, i) => fact(2000 + i, { addedAt: (NOW - i * 60_000) / 1000 })),
];
const KEY = /^[a-z0-9-]+(:[a-z0-9-]+)*$/;

const deal = (list, seed, count) => pickMenu(menuRows(list, NOW), { seed, count });

test("one seed deals one menu; other seeds lead with other rows", () => {
  const rows = menuRows(library(), NOW);
  const a = pickMenu(rows, { seed: 1, count: 6 });
  assert.deepEqual(pickMenu(rows, { seed: 1, count: 6 }).map((r) => r.id), a.map((r) => r.id));
  const leads = new Set(Array.from({ length: 20 }, (_, s) => pickMenu(rows, { seed: s, count: 6 }).slice(1, 6).map((r) => r.id).join()));
  assert.ok(leads.size >= 15, `only ${leads.size} different menus in 20 visits`);
});

test("recent comes first and newest first, then an arcade row and a row to play together, six at most", () => {
  const menu = deal(library(), 7, 6);
  assert.equal(menu.length, 6);
  assert.equal(menu[0].id, "recent");
  assert.deepEqual(menu[0].games.map((f) => f.id), Array.from({ length: MENU_GAMES }, (_, i) => `g${2000 + i}`));
  for (let seed = 0; seed < 10; seed++) {
    assert.deepEqual(new Set(deal(library(), seed, 6).slice(1, 3).map((r) => r.group)), new Set(["arcade", "together"]), `seed ${seed}`);
  }
  const firsts = new Set(Array.from({ length: 10 }, (_, seed) => deal(library(), seed, 6)[1].group));
  assert.equal(firsts.size, 2, "either can lead");

  const quiet = deal(library({ recent: 3 }), 7, 6);
  assert.ok(quiet.every((r) => r.id !== "recent"), "fewer than eight new games make no recent row");
  assert.deepEqual(new Set(quiet.slice(0, 2).map((r) => r.group)), new Set(["arcade", "together"]));
  assert.equal(deal(library().slice(0, 30), 7, 6).length < 6, true, "a small library shows what it has");
});

test("every row holds eight to twelve games, a game in one row only, ids in the agreed shape", () => {
  for (let seed = 0; seed < 8; seed++) {
    const menu = deal(library(), seed);
    const works = menu.flatMap((r) => r.games.map((f) => f.work));
    assert.equal(new Set(works).size, works.length);
    for (const r of menu) {
      assert.ok(r.games.length >= MENU_MIN && r.games.length <= MENU_GAMES, r.id);
      assert.match(r.id, KEY);
    }
  }
});

test("a row draws from its whole ranking, so the best twelve are not all it ever shows", () => {
  const list = [...Array.from({ length: 42 }, (_, i) => fact(i, { rating: 90 + (i % 10), ratingCount: 50 + i })), ...library({ recent: 0 }).slice(42)];
  const shown = new Set();
  let times = 0;
  const rows = menuRows(list, NOW);
  for (let s = 0; s < 28; s++) {
    const row = pickMenu(rows, { seed: s }).find((r) => r.id === "classic");
    if (!row) continue;
    times++;
    for (const f of row.games) shown.add(f.id);
  }
  assert.ok(times >= 4, `classic came up ${times} times in 28 visits`);
  assert.ok(shown.size >= 24, `only ${shown.size} of 42 classics came up`);
});

test("one console takes at most three places in a row while others can fill it", () => {
  const menu = deal(library(), 3);
  const consoles = new Map(menuRows(library(), NOW).map((r) => [r.id, new Set(r.games.map((f) => f.system)).size]));
  const spread = menu.filter((x) => x.group !== "recent" && consoles.get(x.id) >= 4);
  assert.ok(spread.length >= 5);
  for (const r of spread) {
    const count = new Map();
    for (const f of r.games) count.set(f.system, (count.get(f.system) ?? 0) + 1);
    assert.ok(Math.max(...count.values()) <= 3, `${r.id}: ${[...count].join(" ")}`);
  }
});

test("the arcade and play-together rows fill themselves from the arcade facts", () => {
  const ids = menuRows(library(), NOW).map((r) => r.id);
  for (const id of ["arcade:all", "arcade:genre:vertical-shmup", "arcade:genre:versus-fighter", "arcade:decade:1990", "players:2", "players:4", "coop", "versus", "coop:beat-em-up"]) {
    assert.ok(ids.includes(id), id);
  }
  const clones = Array.from({ length: 10 }, (_, i) => arcade(3000 + i, { work: "arcade:sf2" }));
  const rows = menuRows([...clones, ...Array.from({ length: 6 }, (_, i) => arcade(4000 + i))], NOW);
  assert.ok(!rows.some((r) => r.id === "arcade:all"), "ten clones of one set are one game, so seven games are not enough");
});

test("rows are named in the asked language", () => {
  const rows = menuRows(library(), NOW);
  const name = (id) => rows.find((r) => r.id === id).name("ko");
  assert.equal(name("players:4"), "4인 이상 플레이");
  for (const [id, home] of [["recent", "최근 추가"], ["korean", "한국어 지원"], ["players:2", "2인 이상 플레이"], ["coop", "함께 하면 더 재미있는 게임"], ["classic", "명작"], ["good", "평점 80 이상"]]) {
    const row = rows.find((r) => r.id === id);
    if (row) assert.equal(row.name("ko"), home, `${id} reads as the Switch home row does`);
  }
  assert.equal(name("arcade:genre:vertical-shmup"), "오락실 종스크롤 슈팅");
  assert.equal(name("arcade:decade:1990"), "90년대 오락실");
  assert.equal(name("maker:capcom"), "Capcom 게임");
  assert.equal(rows.find((r) => r.id === "decade:1990:genre:rpg").name("en"), "'90s RPG");
});

test("a menu for five thousand games is made quickly", () => {
  const big = Array.from({ length: 5000 }, (_, i) => (i % 5 ? fact(i) : arcade(i)));
  const start = performance.now();
  const rows = menuRows(big, NOW);
  const pooled = performance.now();
  pickMenu(rows, { seed: 1, count: 6 });
  assert.ok(performance.now() - pooled < 50, `dealing took ${Math.round(performance.now() - pooled)} ms`);
  assert.ok(performance.now() - start < 1500, `${Math.round(performance.now() - start)} ms`);
});

test("every row has an icon from the client's set", async () => {
  const { rowIcon } = await import("../../src/retro/menu.js");
  const ids = menuRows(library(), NOW).map((r) => r.id);
  assert.deepEqual(new Set(ids.map(rowIcon)).has("grid"), false, "no row falls through to the default");
  assert.equal(rowIcon("arcade:genre:vertical-shmup"), "joystick");
  assert.equal(rowIcon("coop:beat-em-up"), "users");
});
