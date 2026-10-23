import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fromJsonSchema } from "@modelcontextprotocol/server";

// The served tools' declared outputs against real results with something in their lists: an empty
// list proves nothing about its items. mcp.test.js checks the empty server.
const base = fs.mkdtempSync(path.join(os.tmpdir(), "cook-mcp-outputs-"));
const dirs = Object.fromEntries(["games", "incoming", "patches", "saves", "homebrew", "retro", "data"].map((k) => [k, path.join(base, k)]));
for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
process.env.COOK_GAMES_DIR = dirs.games;
process.env.COOK_INCOMING_DIR = dirs.incoming;
process.env.COOK_PATCHES_DIR = dirs.patches;
process.env.COOK_SAVES_DIR = dirs.saves;
process.env.COOK_HOMEBREW_DIR = dirs.homebrew;
process.env.COOK_RETRO_DIR = dirs.retro;
process.env.COOK_DATA_DIR = dirs.data;
process.env.COOK_RATING_SYNC = "false";
process.env.COOK_TITLEDB_AUTO_FETCH = "false";

const { registry } = await import("../../src/capabilities/registry.js");
const service = await import("../../src/library/trash-service.js");

const put = (root, rel) => {
  const abs = path.join(dirs[root], rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, "x");
  return abs;
};

async function check(id, input = {}) {
  const cap = registry.byId(id);
  const out = JSON.parse(JSON.stringify(await cap.handler({}, input)));
  const { issues } = await fromJsonSchema(cap.output)["~standard"].validate(out);
  assert.equal(issues, undefined, `${id}: ${JSON.stringify(issues)}`);
  return out;
}

test("trash_list's items match its output", async () => {
  put("games", "Some Game/Some Game [0100000000010000][v0].nsp");
  await service.trash("games", [{ rel: "Some Game/Some Game [0100000000010000][v0].nsp" }], { kind: "game", action: "remove", by: { type: "admin", name: "test" }, name: "Some Game" });
  const out = await check("trash_list");
  assert.equal(out.items.length, 1);
});

test("trash_journal's moves match its output", async () => {
  const from = put("incoming", "Other [0100000000020000][v0].nsp");
  const to = path.join(dirs.games, "Other", "Other [0100000000020000][v0].nsp");
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(from, to);
  await service.recordMove({ action: "organize", by: { type: "job", name: "incoming" }, from, to });
  const out = await check("trash_journal");
  assert.equal(out.items.length, 1);
});

test("retro_cores' cores and systems match its output", async () => {
  put("retro", "retroarch/cores/mgba_libretro_libnx.nro");
  put("retro", "retroarch/retroarch.nro");
  fs.writeFileSync(put("retro", "retroarch/info/mgba_libretro.info"), 'display_name = "Nintendo - Game Boy Advance (mGBA)"\nsupported_extensions = "gba|gb"\n');
  put("retro", "roms/gba/Some Game (USA).gba");
  const { scan } = await import("../../src/retro/catalog.js");
  await scan(dirs.retro);
  const out = await check("retro_cores");
  assert.equal(out.cores.length, 1);
  assert.ok(out.systems.length >= 1);
});

test("game_get and games_search over a game with titledb data, an update, a DLC and a patch match their outputs", async () => {
  const base = "0100000000030000";
  fs.mkdirSync(path.join(dirs.data, "titledb"), { recursive: true });
  fs.writeFileSync(path.join(dirs.data, "titledb", "US.en.json"), JSON.stringify({
    1: { id: base, name: "Third Game", publisher: "Example", description: "About it.", releaseDate: 20240101, category: ["Action"], numberOfPlayers: 2, size: 1048576 },
  }));
  const versions = await import("../../src/meta/titledb-versions.js");
  versions.setIndex(versions.buildIndex(
    { [base]: { 65536: "2024-02-01", 131072: "2024-03-01" } },
    { "0100000000031001": { 0: { titleType: 130, otherApplicationId: base } }, [base]: { 0: { titleType: 128, requiredSystemVersion: 1073741824 } } },
  ));
  await (await import("../../src/meta/titledb-store.js")).load();
  put("games", `Third Game/Third Game [${base}][v0].nsp`);
  put("games", "Third Game/update/Third Game [0100000000030800][v65536].nsp");
  put("games", "Third Game/DLC/Third Game DLC [0100000000031001][v0].nsp");
  put("patches", `${base}/한글패치/atmosphere/contents/${base}/romfs/a.bin`);
  const shopCache = await import("../../src/meta/shop-cache.js");
  shopCache.invalidate({ rescan: true });
  await shopCache.get();
  await (await import("../../src/meta/user-patches.js")).scan();

  const game = await check("game_get", { titleId: base });
  assert.equal(game.name, "Third Game");
  assert.deepEqual(game.updates.map((u) => [u.version, u.inLibrary]), [[65536, true], [131072, false]]);
  assert.deepEqual(game.dlc, { total: 1, inLibrary: ["0100000000031001"] });
  assert.equal(game.files.length, 3);
  assert.equal(game.patches.length, 1);
  assert.equal(game.patches[0].korean, true);

  const found = await check("games_search", { q: "third" });
  assert.equal(found.items[0].titleId, base);
});

test("game_get answers an unknown id as NOT_FOUND and a malformed one as BAD_INPUT", async () => {
  const cap = registry.byId("game_get");
  await assert.rejects(cap.handler({}, { titleId: "0100000000FFF000" }), (err) => err.status === 404);
  await assert.rejects(cap.handler({}, { titleId: "zelda" }), (err) => err.status === 400);
});

test("retro_games_search finds a game by its English or Korean name and by missing art; retro_game_get matches its output", async () => {
  put("retro", "roms/gba/Other Quest (USA).gba");
  const { scan, current } = await import("../../src/retro/catalog.js");
  await scan(dirs.retro);
  const game = (await current(dirs.retro)).games.find((g) => g.file === "Other Quest (USA).gba");
  (await import("../../src/retro/names.js")).set(game.id, { ko: "다른 퀘스트" });

  const byKo = await check("retro_games_search", { q: "다른" });
  assert.deepEqual(byKo.items.map((g) => g.id), [game.id]);
  assert.equal(byKo.items[0].name, "다른 퀘스트");
  assert.equal((await check("retro_games_search", { q: "other quest" })).total, 1);
  assert.ok((await check("retro_games_search", { system: "gba", missingArt: true })).items.some((g) => g.id === game.id));

  const one = await check("retro_game_get", { id: game.id });
  assert.equal(one.system, "gba");
  assert.deepEqual(one.adminName, { ko: "다른 퀘스트" });
  assert.equal(one.versions.length, 1);
});

test("retro tools answer an unknown system or id as BAD_INPUT or NOT_FOUND", async () => {
  await assert.rejects(registry.byId("retro_games_search").handler({}, { system: "nope" }), (err) => err.status === 400);
  await assert.rejects(registry.byId("retro_game_get").handler({}, { id: "gba-0000000000" }), (err) => err.status === 404);
  await assert.rejects(registry.byId("retro_game_get").handler({}, { id: "../etc" }), (err) => err.status === 400);
});
