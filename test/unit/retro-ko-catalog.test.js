import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import express from "express";

// Korean titles from the dictionary in the catalog: a content hash match is shown at once,
// a title match waits for the admin, and only kept ones are shown.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "retro-ko-catalog-"));
process.env.COOK_DATA_DIR = path.join(root, "data");
process.env.COOK_RETRO_DIR = path.join(root, "retro");
process.env.COOK_RATING_SYNC = "false";
process.env.COOK_RETRO_AUTO_CORES = "false";
const retro = process.env.COOK_RETRO_DIR;

const sha = (alg, buf) => crypto.createHash(alg).update(buf).digest("hex");
const crc = (buf) => (zlib.crc32(buf) >>> 0).toString(16).padStart(8, "0");
const rom = (n, seed) => Buffer.from(Array.from({ length: n }, (_, i) => (i * seed + 1) & 0xff));
const put = (rel, body) => {
  fs.mkdirSync(path.dirname(path.join(retro, rel)), { recursive: true });
  fs.writeFileSync(path.join(retro, rel), body);
};

const PLAIN = rom(0x2000, 3);
put("roms/gba/Plain Game (USA).gba", PLAIN);
put("roms/gba/Guess Quest (USA).gba", rom(0x2000, 5));
put("roms/gba/Second Guess (USA).gba", rom(0x2000, 7));
put("roms/Nintendo - Pokemon Mini/Pocket Mini (Japan).min", rom(0x100, 9));
put("roms/Nintendo - Game & Watch/Ball.mgw", rom(0x100, 11));

const { useKoreanNames } = await import("../../src/retro/ko-names.js");
useKoreanNames({
  systems: { gba: { [sha("sha256", PLAIN).slice(0, 32)]: ["평범한 게임", "Plain Game", crc(PLAIN), sha("sha1", PLAIN).slice(0, 32)] } },
  titles: { gba: { "guess quest": "추측 퀘스트", "second guess": "두 번째 추측" } },
});
const catalog = await import("../../src/retro/catalog.js");
const romIndex = await import("../../src/retro/rom-index.js");
const koMatch = await import("../../src/retro/ko-match.js");
const { default: retroRouter } = await import("../../src/routes/retro.js");
const { mountRetroKoApi } = await import("../../src/routes/admin/retro-ko-api.js");

let server;
const url = (p) => `http://127.0.0.1:${server.address().port}${p}`;
const get = async (p) => (await fetch(url(p), { headers: { "Accept-Language": "ko" } })).json();
const post = (p, body) => fetch(url(p), { method: "POST", headers: { "Content-Type": "application/json", "Accept-Language": "ko" }, body: JSON.stringify(body) });
const games = async () => (await get("/api/retro/games?pageSize=50&variants=all")).games;
const byFile = async (file) => (await games()).find((g) => g.file === file);

before(async () => {
  const cat = await catalog.scan(retro);
  await romIndex.pass(cat.games, { pauseMs: 0 });
  const app = express();
  app.use(express.json());
  app.use("/api/retro", retroRouter());
  const admin = express.Router();
  mountRetroKoApi(admin, () => true);
  app.use("/admin", admin);
  server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
});
after(() => {
  server?.close();
  useKoreanNames(null);
  fs.rmSync(root, { recursive: true, force: true });
});

test("a ROM whose content hash is in the dictionary shows its Korean name in the list and is found by it", async () => {
  const plain = await byFile("Plain Game (USA).gba");
  assert.equal(plain.name, "평범한 게임");
  const found = await get(`/api/retro/games?q=${encodeURIComponent("평범한")}`);
  assert.deepEqual(found.games.map((g) => g.file), ["Plain Game (USA).gba"]);
  assert.equal((await byFile("Guess Quest (USA).gba")).name, "Guess Quest (USA)", "a title match alone is not shown");
});

test("the admin sees confirmed names and the guesses that wait for a decision", async () => {
  const d = await get("/admin/api/retro-ko");
  assert.deepEqual(d.confirmed.map((k) => [k.file, k.ko, k.by]), [["Plain Game (USA).gba", "평범한 게임", "sha256"]]);
  assert.deepEqual(d.guesses.map((k) => [k.file, k.ko, k.by]).sort(), [["Guess Quest (USA).gba", "추측 퀘스트", "title"], ["Second Guess (USA).gba", "두 번째 추측", "title"]]);
  assert.equal(d.index.files, 3, "the gba files; the new systems are not in this dictionary");
  assert.equal(d.index.read, 3);
});

test("an approved guess is saved with the admin's names and shows at once; a rejected one stays away", async () => {
  const quest = await byFile("Guess Quest (USA).gba");
  const second = await byFile("Second Guess (USA).gba");
  assert.equal((await post("/admin/api/retro-ko/guess", { game: quest.id, approve: true })).status, 200);
  assert.equal((await byFile("Guess Quest (USA).gba")).name, "추측 퀘스트");
  const saved = JSON.parse(fs.readFileSync(path.join(process.env.COOK_DATA_DIR, "retro-names.json"), "utf8"));
  assert.deepEqual(saved[quest.id], { ko: "추측 퀘스트" });

  assert.equal((await post("/admin/api/retro-ko/guess", { game: second.id, approve: false })).status, 200);
  assert.equal((await byFile("Second Guess (USA).gba")).name, "Second Guess (USA)");
  assert.equal((await post("/admin/api/retro-ko/guess", { game: second.id, approve: true })).status, 409, "nothing left to decide");
  assert.deepEqual((await get("/admin/api/retro-ko")).guesses, []);
  assert.equal((await post("/admin/api/retro-ko/guess", { game: "gba-0000000000", approve: true })).status, 404);
});

test("anything that decides how a game runs sees only hash matches, never a guess, kept or not", async () => {
  const cat = await catalog.current(retro);
  const quest = cat.games.find((g) => g.file === "Guess Quest (USA).gba");
  assert.equal(koMatch.confirmed(quest), null, "a kept guess is still no hash match");
  assert.equal(koMatch.confirmed(cat.games.find((g) => g.file === "Plain Game (USA).gba")).by, "sha256");
  assert.equal((await byFile("Guess Quest (USA).gba")).core, cat.systems.gba.core, "the core is the system's");
});

test("Pokémon mini and Game & Watch files are read from their RetroArch folders", async () => {
  const listed = await games();
  assert.equal(listed.find((g) => g.file === "Pocket Mini (Japan).min").system, "mini");
  assert.equal(listed.find((g) => g.file === "Ball.mgw").system, "gw");
  const { systems } = await get("/api/retro/systems");
  assert.deepEqual(systems.filter((s) => ["mini", "gw"].includes(s.id)).map((s) => [s.id, s.defaultCore]).sort(), [["gw", "gw"], ["mini", "pokemini"]]);
});
