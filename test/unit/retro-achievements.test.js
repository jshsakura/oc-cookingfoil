import { test, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import express from "express";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "retro-achievements-"));
process.env.COOK_DATA_DIR = root;
process.env.COOK_RA_API_KEY = "A".repeat(32);

const { zipStore } = await import("../../src/helpers/zip-store.js");
const { largestEntry } = await import("../../src/helpers/zip-read.js");
const { hashBytes, arcadeHash, romHash, CONSOLES } = await import("../../src/retro/achievements/hash.js");
const { consoleIndex, matchRom } = await import("../../src/retro/achievements/match.js");
const store = await import("../../src/retro/achievements/store.js");
const sync = await import("../../src/retro/achievements/sync.js");
const romHashes = await import("../../src/retro/rom-hash.js");
const players = await import("../../src/retro/achievements/players.js");
const { mountAchievements, achievementSummary, resetCache } = await import("../../src/routes/retro-achievements.js");

after(() => fs.rmSync(root, { recursive: true, force: true }));

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24, 1)]);
const md5 = (buf) => crypto.createHash("md5").update(buf).digest("hex");
const rom = (n, seed = 7) => Buffer.from(Array.from({ length: n }, (_, i) => (i * seed + 3) & 0xff));

/** A one-file zip with its entry deflated, as most ROM zips are. */
function deflatedZip(name, data) {
  const nameBuf = Buffer.from(name);
  const packed = zlib.deflateRawSync(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28);
  const dirAt = 30 + nameBuf.length + packed.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + nameBuf.length, 12); end.writeUInt32LE(dirAt, 16);
  return Buffer.concat([local, nameBuf, packed, central, nameBuf, end]);
}

test("ROM hashes follow RetroArch: copier headers left out, N64 in big-endian order, arcade by set name", () => {
  const body = rom(0x4000);
  assert.equal(hashBytes("nes", Buffer.concat([Buffer.from("NES\x1a"), Buffer.alloc(12), body])), md5(body));
  assert.equal(hashBytes("nes", body), md5(body));
  assert.equal(hashBytes("snes", Buffer.concat([Buffer.alloc(512), body])), md5(body));
  assert.equal(hashBytes("snes", body), md5(body));
  assert.equal(hashBytes("gba", body), md5(body));
  const z64 = Buffer.concat([Buffer.from([0x80, 0x37, 0x12, 0x40]), rom(60)]);
  const v64 = Buffer.from(z64);
  for (let i = 0; i < v64.length; i += 2) [v64[i], v64[i + 1]] = [v64[i + 1], v64[i]];
  assert.equal(hashBytes("n64", v64), md5(z64));
  assert.equal(hashBytes("n64", z64), md5(z64));
  assert.equal(hashBytes("psp", body), null, "disc systems are matched by title");
  assert.equal(arcadeHash("/roms/arcade/gunbird.zip"), md5("gunbird"));
  assert.equal(CONSOLES.snes, 3);
  assert.equal(CONSOLES.pcecd, 76);
});

test("the ROM inside a zip is hashed, stored or deflated", async () => {
  const dir = fs.mkdtempSync(path.join(root, "zips-"));
  const body = Buffer.concat([Buffer.from("NES\x1a"), Buffer.alloc(12), rom(0x8000)]);
  fs.writeFileSync(path.join(dir, "stored.zip"), zipStore([{ name: "readme.txt", data: Buffer.from("hi") }, { name: "game.nes", data: body }]));
  fs.writeFileSync(path.join(dir, "deflated.zip"), deflatedZip("game.nes", body));
  fs.writeFileSync(path.join(dir, "game.nes"), body);
  assert.equal((await largestEntry(path.join(dir, "stored.zip"))).name, "game.nes");
  const want = md5(body.subarray(16));
  for (const file of ["stored.zip", "deflated.zip", "game.nes"]) {
    assert.equal(await romHash({ system: "nes", abs: path.join(dir, file) }), want, file);
  }
  assert.equal(await romHash({ system: "nes", abs: path.join(dir, "x.7z") }), null);
  assert.equal(await romHash({ system: "arcade", abs: path.join(dir, "kof98.zip") }), md5("kof98"));
});

const LIST = [
  { id: 1, title: "Super Mario Bros.", count: 30, points: 300, icon: null, hashes: ["aa".repeat(16)] },
  { id: 2, title: "~Hack~ Super Mario Bros.", count: 5, points: 50, icon: null, hashes: ["bb".repeat(16)] },
  { id: 3, title: "Legend of Zelda, The | Zelda no Densetsu", count: 40, points: 400, icon: null, hashes: [] },
];

test("a ROM matches by its hash first, then by its English title; hacks never win on a title", () => {
  const index = consoleIndex(LIST);
  assert.deepEqual(matchRom(index, "bb".repeat(16), ["Anything"]), { id: 2, by: "hash" });
  assert.deepEqual(matchRom(index, "cc".repeat(16), ["Super Mario Bros. (World)"]), { id: 1, by: "title" });
  assert.deepEqual(matchRom(index, null, ["The Legend of Zelda"]), { id: 3, by: "title" });
  assert.deepEqual(matchRom(index, null, ["Zelda no Densetsu"]), { id: 3, by: "title" });
  assert.equal(matchRom(index, null, ["Tetris"]), null);
});

test("the sync reads each console's list weekly and hashes a ROM once, matching Korean patches by title", async () => {
  store.reset();
  sync.reset();
  const dir = fs.mkdtempSync(path.join(root, "roms-"));
  const original = rom(0x8000, 3);
  const patched = rom(0x8000, 5);
  fs.writeFileSync(path.join(dir, "a.nes"), original);
  fs.writeFileSync(path.join(dir, "b.nes"), patched);
  const games = [
    { id: "nes-1", system: "nes", name: "Super Mario Bros. (World)", abs: path.join(dir, "a.nes"), fileSize: 1, mtimeMs: 1 },
    { id: "nes-2", system: "nes", name: "젤다의 전설 (Legend of Zelda, The) [T-Kor]", abs: path.join(dir, "b.nes"), fileSize: 1, mtimeMs: 1 },
    { id: "nes-3", system: "nes", name: "테트리스 (Tetris)", abs: path.join(dir, "c.nes"), fileSize: 1, mtimeMs: 1 },
  ];
  const list = LIST.map((g) => ({ ID: g.id, Title: g.title, NumAchievements: g.count, Points: g.points, Hashes: g.id === 1 ? [md5(original).toUpperCase()] : g.hashes }));
  const asked = [];
  const fetchImpl = async (url) => {
    asked.push(new URL(url).pathname);
    return new Response(JSON.stringify(list), { status: 200 });
  };
  let at = Date.parse("2026-10-19T00:00:00Z");
  const opts = { current: async () => ({ games }), fetchImpl, now: () => at, pauseMs: 0 };
  const r = await sync.tick(opts);
  assert.deepEqual(asked, ["/API/API_GetGameList.php"]);
  assert.deepEqual({ lists: r.lists, roms: r.roms, matched: r.matched }, { lists: 1, roms: 3, matched: 2 });
  assert.deepEqual(store.rom("nes-1").ra, { id: 1, by: "hash" });
  assert.deepEqual(store.rom("nes-2").ra, { id: 3, by: "title" });
  assert.equal(store.rom("nes-3").ra, null);
  assert.deepEqual(achievementSummary([games[1]]), { achievements: { raGameId: 3, count: 40, points: 400, matchedBy: "title" } });

  at += 60 * 60 * 1000;
  const again = await sync.tick(opts);
  assert.equal(asked.length, 1, "the list is a week good");
  assert.equal(again.roms, 0, "nothing is hashed again while the files stay the same");
  at += 8 * 24 * 60 * 60 * 1000;
  await sync.tick(opts);
  assert.equal(asked.length, 2);
});

test("the sync and the background ROM hashes read each file once between them, and an overwrite is matched again", async () => {
  store.reset();
  sync.reset();
  const dir = fs.mkdtempSync(path.join(root, "roms-"));
  const abs = path.join(dir, "a.nes");
  fs.writeFileSync(abs, rom(0x8000, 3));
  const games = [{ id: "nes-s1", system: "nes", name: "Something Else", rel: "a.nes", file: "a.nes", abs, fileSize: 1, mtimeMs: 1 }];
  const list = LIST.map((g) => ({ ID: g.id, Title: g.title, NumAchievements: g.count, Points: g.points, Hashes: g.id === 1 ? [md5(rom(0x8000, 3))] : g.id === 2 ? [md5(rom(0x8000, 5))] : g.hashes }));
  const opts = { current: async () => ({ games }), fetchImpl: async () => new Response(JSON.stringify(list), { status: 200 }), now: () => Date.parse("2026-10-19T00:00:00Z"), pauseMs: 0 };
  await sync.tick(opts);
  assert.deepEqual(store.rom("nes-s1").ra, { id: 1, by: "hash" });
  assert.equal(romHashes.known(games[0]), md5(rom(0x8000, 3)), "the sync's hash is the shared one");
  assert.equal((await romHashes.pass(games, { pauseMs: 0 })).hashed, 0, "the background pass doesn't read it again");

  // Overwritten in place, size and mtime put back (the sync's own stamp can't see it).
  const st = fs.statSync(abs);
  fs.writeFileSync(abs, rom(0x8000, 5));
  fs.utimesSync(abs, st.atime, st.mtime);
  assert.equal((await romHashes.pass(games, { pauseMs: 0 })).hashed, 1);
  assert.equal((await sync.tick(opts)).roms, 1);
  assert.deepEqual(store.rom("nes-s1").ra, { id: 2, by: "hash" });
});

test("a player registers a name RetroAchievements knows, and sees their progress on a matched game", async () => {
  players.reset();
  resetCache();
  store.reset({
    lists: { 7: { at: 1, triedAt: 1, games: [{ id: 1, title: "Super Mario Bros.", count: 2, points: 15, hashes: [] }] } },
    roms: { "nes-1": { stamp: "1:1", hash: null, ra: { id: 1, by: "title" }, listAt: 1 } },
  });
  const calls = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    calls.push(u.pathname);
    if (u.hostname === "media.retroachievements.org") {
      assert.equal(u.search, "", "the key never goes to the media server");
      return u.pathname === "/Badge/123_lock.png" ? new Response(PNG, { status: 200 }) : new Response("<html>", { status: 200 });
    }
    assert.equal(u.searchParams.get("y"), "A".repeat(32));
    if (u.pathname.endsWith("API_GetUserProfile.php")) {
      return u.searchParams.get("u").toLowerCase() === "mario"
        ? new Response(JSON.stringify({ User: "Mario" }), { status: 200 })
        : new Response("{}", { status: 404 });
    }
    assert.equal(u.searchParams.get("u"), "Mario");
    return new Response(JSON.stringify({ ID: 1, Title: "Super Mario Bros.", Achievements: {
      11: { ID: 11, Title: "First", Description: "Clear 1-1", Points: 5, BadgeName: "123", DisplayOrder: 1, DateEarned: "2026-10-01 10:00:00" },
      12: { ID: 12, Title: "Second", Description: "Clear 1-2", Points: 10, BadgeName: "124", DisplayOrder: 2 },
    } }), { status: 200 });
  };
  const app = express();
  app.use((req, _res, next) => { if (req.get("x-user")) req.auth = { user: req.get("x-user") }; next(); });
  const router = express.Router();
  const gameAchievements = mountAchievements(router, { fetchImpl });
  router.get("/games/:id/achievements", gameAchievements((req) => [{ id: req.params.id }]));
  app.use("/api/retro", router);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}/api/retro`;
  const as = (method, url, body, user = "viewer") => fetch(`${base}${url}`, {
    method, headers: { "x-user": user, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
  });
  try {
    assert.equal((await fetch(`${base}/achievements/account`)).status, 403);
    assert.deepEqual(await (await as("GET", "/achievements/account")).json(), { enabled: true, username: null });
    assert.equal((await as("PUT", "/achievements/account", { username: "nobody" })).status, 404);
    assert.equal((await as("PUT", "/achievements/account", { username: "bad name!" })).status, 400);
    assert.deepEqual(await (await as("GET", "/achievements/account/lookup?username=mario")).json(), { username: "Mario" });
    assert.equal((await as("GET", "/achievements/account/lookup?username=nobody")).status, 404);
    assert.equal((await as("GET", "/achievements/account/lookup?username=x")).status, 400);
    assert.equal(players.nameOf("user:viewer"), null, "a lookup registers nothing");
    assert.deepEqual(await (await as("PUT", "/achievements/account", { username: "mario" })).json(), { enabled: true, username: "Mario" });
    assert.equal(players.nameOf("user:viewer"), "Mario");
    assert.equal(players.nameOf("user:other"), null, "each account has its own name");

    const game = await (await as("GET", "/games/nes-1/achievements")).json();
    assert.equal(game.matchedBy, "title");
    assert.deepEqual(game.user, { username: "Mario", earned: 1, earnedHardcore: 0, points: 5 });
    assert.equal(game.raGameId, 1);
    assert.deepEqual(game.list.map((a) => [a.id, a.earned, a.earnedAt, a.badge, a.badgeLocked]), [
      [11, true, Date.parse("2026-10-01T10:00:00Z") / 1000, "/api/retro/achievements/badge/123.png", "/api/retro/achievements/badge/123_lock.png"],
      [12, false, null, "/api/retro/achievements/badge/124.png", "/api/retro/achievements/badge/124_lock.png"],
    ]);
    assert.equal("badgeName" in game.list[0], false);
    const before = calls.length;
    await as("GET", "/games/nes-1/achievements");
    assert.equal(calls.length, before, "a player's progress is kept for a few minutes");
    assert.equal((await as("GET", "/games/nes-9/achievements")).status, 404);

    const badge = await as("GET", "/achievements/badge/123_lock.png");
    assert.equal(badge.status, 200);
    assert.deepEqual(Buffer.from(await badge.arrayBuffer()), PNG);
    const fetched = calls.length;
    assert.equal((await as("GET", "/achievements/badge/123_lock.png")).status, 200);
    assert.equal(calls.length, fetched, "a badge is fetched once and kept");
    assert.equal((await as("GET", "/achievements/badge/124.png")).status, 404, "a reply that is not a PNG is not kept");
    assert.equal((await as("GET", "/achievements/badge/..%2Fx.png")).status, 404);

    assert.deepEqual(await (await as("DELETE", "/achievements/account")).json(), { enabled: true, username: null });
    assert.equal(players.nameOf("user:viewer"), null);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("the base pack never sends cheevos_ lines in a config, so an override cannot undo the console's sign-in", async () => {
  const { listPack, withoutCheevos } = await import("../../src/retro/base-pack.js");
  const dir = fs.mkdtempSync(path.join(root, "pack-"));
  const cleanDir = path.join(root, "pack-clean");
  const put = (rel, body) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), body); };
  put("retroarch.cfg", 'video_driver = "gl"\ncheevos_enable = "false"\ncheevos_username = ""\nmenu_driver = "ozone"\n');
  put("config/ScummVM/ScummVM.cfg", 'video_threaded = "false"\n  cheevos_hardcore_mode_enable = "true"');
  put("config/Snes9x/Snes9x.cfg", 'video_smooth = "true"\n');
  put("cores/readme.txt", "cheevos_enable = 1\n");
  const files = new Map((await listPack(dir, { cleanDir })).map((f) => [f.path, f]));
  const read = (sd) => fs.readFileSync(files.get(sd).abs, "utf8");
  assert.equal(read("retroarch/retroarch.cfg"), 'video_driver = "gl"\nmenu_driver = "ozone"\n');
  assert.equal(read("retroarch/config/ScummVM/ScummVM.cfg"), 'video_threaded = "false"\n');
  assert.equal(files.get("retroarch/retroarch.cfg").size, Buffer.byteLength(read("retroarch/retroarch.cfg")));
  assert.equal(files.get("retroarch/config/Snes9x/Snes9x.cfg").abs, path.join(dir, "config/Snes9x/Snes9x.cfg"), "a clean config is sent as it is");
  assert.equal(files.get("retroarch/cores/readme.txt").abs, path.join(dir, "cores/readme.txt"), "only configs are touched");
  assert.ok(files.get("retroarch/retroarch.cfg").once);
  assert.equal(withoutCheevos("a = 1\ncheevos_x = 2"), "a = 1\n");
});

test("a game's own RetroArch config carries no cheevos_ key", async () => {
  const { gameCfg, overlayCfg } = await import("../../src/retro/bezel-config.js");
  const game = { system: "snes", name: "Test", rel: "snes/Test.zip", sd: { stem: "Test" } };
  const text = gameCfg(game, { folder: "snes", core: "snes9x_libretro" }) + overlayCfg(game);
  assert.doesNotMatch(text, /cheevos_/);
});

test("many asking for a badge at once share one fetch, and all get the whole image", async () => {
  let fetches = 0;
  const fetchImpl = async () => {
    fetches++;
    await new Promise((r) => setTimeout(r, 30));
    return new Response(PNG, { status: 200 });
  };
  const app = express();
  app.use((req, _res, next) => { req.auth = { user: "viewer" }; next(); });
  const router = express.Router();
  mountAchievements(router, { fetchImpl });
  app.use("/api/retro", router);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const url = `http://127.0.0.1:${server.address().port}/api/retro/achievements/badge/987654.png`;
  try {
    const replies = await Promise.all(Array.from({ length: 5 }, () => fetch(url)));
    assert.deepEqual(replies.map((r) => r.status), [200, 200, 200, 200, 200]);
    for (const r of replies) assert.deepEqual(Buffer.from(await r.arrayBuffer()), PNG);
    assert.equal(fetches, 1);
    const dir = path.join(root, "retro-achievements", "badges");
    assert.deepEqual(fs.readdirSync(dir).filter((f) => f.startsWith("987654")), ["987654.png"], "no temporary file is left behind");
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("the achievements list shows each matched game once, with the player's counts, the latest earned first", async () => {
  players.reset();
  resetCache();
  store.reset({
    lists: { 7: { at: 1, triedAt: 1, games: [
      { id: 1, title: "Super Mario Bros.", count: 2, points: 15, hashes: [] },
      { id: 3, title: "The Legend of Zelda", count: 40, points: 400, hashes: [] },
      { id: 5, title: "Contra", count: 30, points: 300, hashes: [] },
    ] } },
    roms: {
      "nes-1": { ra: { id: 1, by: "title" } },
      "nes-1b": { ra: { id: 1, by: "hash" } },
      "nes-2": { ra: { id: 3, by: "title" } },
      "nes-4": { ra: { id: 5, by: "hash" } },
      "nes-3": { ra: null },
    },
  });
  const calls = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    calls.push(`${u.pathname}?${u.searchParams.get("o") ?? ""}`);
    assert.equal(u.searchParams.get("u"), "Mario");
    if (u.pathname.endsWith("API_GetUserProfile.php")) return new Response(JSON.stringify({ User: "Mario", TotalPoints: 1234 }), { status: 200 });
    assert.equal(u.searchParams.get("c"), "500");
    return new Response(JSON.stringify({ Count: 2, Total: 2, Results: [
      { GameID: 3, NumAwarded: 4, NumAwardedHardcore: 1, MaxPossible: 40, MostRecentAwardedDate: "2026-10-02T10:00:00+00:00" },
      { GameID: 5, NumAwarded: 2, NumAwardedHardcore: 2, MaxPossible: 30, MostRecentAwardedDate: "2026-10-03T10:00:00+00:00" },
      { GameID: 99, NumAwarded: 1, NumAwardedHardcore: 0, MaxPossible: 9, MostRecentAwardedDate: "2026-10-04T10:00:00+00:00" },
    ] }), { status: 200 });
  };
  const shownAsked = [];
  const listed = ["nes-1", "nes-1b", "nes-2", "nes-3", "nes-4"].map((id) => ({
    candidates: [{ id }],
    shown: () => { shownAsked.push(id); return { id, name: `Game ${id}`, system: "nes", iconUrl: `/api/retro/games/${id}/icon?v=1` }; },
  }));
  const app = express();
  app.use((req, _res, next) => { if (req.get("x-user")) req.auth = { user: req.get("x-user") }; next(); });
  const router = express.Router();
  mountAchievements(router, { fetchImpl, games: async () => listed });
  app.use("/api/retro", router);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const get = (user) => fetch(`http://127.0.0.1:${server.address().port}/api/retro/achievements/games`, { headers: user ? { "x-user": user } : {} });
  try {
    const anonymous = await (await get()).json();
    assert.equal(anonymous.user, null);
    assert.deepEqual(anonymous.list.map((r) => [r.gameId, r.earned, r.lastEarnedAt]), [
      ["nes-1b", 0, null], ["nes-2", 0, null], ["nes-4", 0, null],
    ], "no name: nothing earned, by title");
    assert.equal(calls.length, 0);
    assert.ok(!shownAsked.includes("nes-3"), "only matched games are looked up");

    players.register("user:viewer", "Mario");
    const mine = await (await get("viewer")).json();
    assert.deepEqual(mine.user, { username: "Mario", points: 1234 });
    assert.deepEqual(mine.list, [
      { gameId: "nes-4", title: "Game nes-4", system: "nes", raGameId: 5, count: 30, points: 300, earned: 2, earnedHardcore: 2,
        lastEarnedAt: Date.parse("2026-10-03T10:00:00Z") / 1000, matchedBy: "hash", iconUrl: "/api/retro/games/nes-4/icon?v=1" },
      { gameId: "nes-2", title: "Game nes-2", system: "nes", raGameId: 3, count: 40, points: 400, earned: 4, earnedHardcore: 1,
        lastEarnedAt: Date.parse("2026-10-02T10:00:00Z") / 1000, matchedBy: "title", iconUrl: "/api/retro/games/nes-2/icon?v=1" },
      { gameId: "nes-1b", title: "Game nes-1b", system: "nes", raGameId: 1, count: 2, points: 15, earned: 0, earnedHardcore: 0,
        lastEarnedAt: null, matchedBy: "hash", iconUrl: "/api/retro/games/nes-1b/icon?v=1" },
    ], "one row per RetroAchievements game, the hash match kept; a game not on this server is left out");
    assert.deepEqual(calls.sort(), ["/API/API_GetUserCompletionProgress.php?0", "/API/API_GetUserProfile.php?"]);
    await get("viewer");
    assert.equal(calls.length, 2, "a player's list is kept a minute");
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("completion progress pages through 500 games at a time", async () => {
  const client = await import("../../src/retro/achievements/client.js");
  const offsets = [];
  const fetchImpl = async (url) => {
    const o = Number(new URL(url).searchParams.get("o"));
    offsets.push(o);
    const n = o === 0 ? 500 : 3;
    return new Response(JSON.stringify({ Total: 503, Results: Array.from({ length: n }, (_, i) => ({ GameID: o + i + 1, NumAwarded: 1, NumAwardedHardcore: 0, MostRecentAwardedDate: null })) }), { status: 200 });
  };
  const out = await client.completionProgress("Mario", { fetchImpl });
  assert.deepEqual(offsets, [0, 500]);
  assert.equal(out.size, 503);
  assert.deepEqual(out.get(503), { earned: 1, earnedHardcore: 0, lastEarnedAt: null });
});
