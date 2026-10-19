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
    assert.equal((await fetch(`${base}/achievements/account`)).status, 401);
    assert.deepEqual(await (await as("GET", "/achievements/account")).json(), { enabled: true, username: null });
    assert.equal((await as("PUT", "/achievements/account", { username: "nobody" })).status, 404);
    assert.equal((await as("PUT", "/achievements/account", { username: "bad name!" })).status, 400);
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
