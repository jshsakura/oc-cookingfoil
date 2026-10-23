import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_SYSTEMS, loadSystems, folderKeys, unreadFolders, unreadReasons } from "../../src/retro/systems.js";
import { scanDir, visibleSystems } from "../../src/retro/catalog.js";
import { BEZEL_SOURCES } from "../../src/retro/art/sources.js";
import { PLATFORMS } from "../../src/retro/art/titles.js";
import { BIOS, listFirmware, missingBios } from "../../src/retro/bios.js";
import { pathProblem } from "../../src/meta/console-paths.js";
import { CONSOLE, seedConsole } from "../support/console.js";

const ADDED = {
  neocd: "SNK - Neo Geo CD", "32x": "Sega - 32X", sg: "Sega - SG-1000", a2600: "Atari - 2600", a7800: "Atari - 7800",
  lynx: "Atari - Lynx", col: "Coleco - ColecoVision", videopac: "Magnavox - Odyssey2", msx: "Microsoft - MSX",
  amstrad: "Amstrad - CPC", c64: "Commodore - 64", zxs: "Sinclair - ZX Spectrum", vb: "Nintendo - Virtual Boy",
  wsv: "Watara - Supervision", pico8: "PICO-8", chip8: "CHIP-8", tama: "Bandai - Tamagotchi P1",
  mini: "Nintendo - Pokemon Mini", gw: "Nintendo - Game & Watch",
};
const LANGS = ["en", "ko", "ja", "zh"];

function put(root, rel, body = "x") {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body);
}

test("the added systems carry every field, in four languages, with RetroArch's folder name", () => {
  for (const [id, folder] of Object.entries(ADDED)) {
    const s = DEFAULT_SYSTEMS[id];
    assert.ok(s, id);
    assert.equal(s.folder, folder, id);
    for (const lang of LANGS) assert.ok(s.names[lang]?.trim(), `${id} ${lang}`);
    assert.ok(s.extensions.length && s.extensions.every((e) => /^\.[a-z0-9]+$/.test(e)), `${id} extensions`);
    assert.match(s.core, /^[a-z0-9_]+$/, id);
    assert.ok(s.coreName, `${id} coreName`);
    assert.ok(s.bezelDir && !pathProblem(`retroarch/overlays/GameBezels/${s.bezelDir}`), `${id} bezelDir`);
    assert.ok(!pathProblem(`retroarch/config/${s.coreName}/x.cfg`), `${id} coreName fits the SD card`);
    if (BEZEL_SOURCES[id]) assert.equal(BEZEL_SOURCES[id][0][1], s.bezelDir, `${id} bezels land where the configs point`);
  }
  assert.equal(DEFAULT_SYSTEMS.neocd.extensions.includes(".chd"), true, "a disc system");
  assert.equal(DEFAULT_SYSTEMS.pico8.bezelDir, "pico8", "no Bezel Project folder: the id");
  for (const id of ["pico8", "chip8", "tama"]) assert.equal(BEZEL_SOURCES[id], undefined, id);
  for (const id of Object.keys(PLATFORMS)) assert.ok(DEFAULT_SYSTEMS[id], `ratings platform for a known system: ${id}`);
  assert.equal(loadSystems("/nonexistent")["32x"].folder, "Sega - 32X");
});

test("a system without games is invisible, even when its folder exists", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "retro-sys-"));
  put(dir, "roms/Sega - 32X/Knuckles Chaotix (USA).32x", "KC");
  fs.mkdirSync(path.join(dir, "roms/Atari - 2600"), { recursive: true });
  put(dir, "roms/PICO-8/readme.txt", "no carts");
  const cat = await scanDir(dir);
  assert.ok(cat.present.has("a2600"), "the folder is there");
  assert.deepEqual(visibleSystems(cat).map((s) => s.id), ["32x"]);
  assert.deepEqual(visibleSystems(cat, []).map((s) => s.id), [], "nothing listed, nothing shown");
});

test("BIOS notices only name consoles that have games, and an any-of group is met by one file", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "retro-bios-"));
  put(dir, "bios_CD_J.bin");
  put(dir, "neocd/neocd_z.rom");
  put(dir, "Machines/Shared Roms/MSX.rom");
  // A BIOS that went to the trash (the firmware folder on its own disk keeps its trash inside) is not there.
  put(dir, ".cookingfoil-trash/2026-01-01/bios-0123456789/colecovision.rom");
  put(dir, ".cookingfoil-partial-0a1b2c3d4e-colecovision.rom");
  const files = await listFirmware(dir);
  assert.deepEqual(files.sort(), ["Machines/Shared Roms/MSX.rom", "bios_CD_J.bin", "neocd/neocd_z.rom"]);

  assert.deepEqual(missingBios([], files), [], "no games, no notice");
  assert.deepEqual(missingBios(["snes", "segacd", "neocd"], files), [], "one region BIOS will do; NeoCD finds it in a subfolder");
  assert.deepEqual(missingBios(["col", "col", "msx"], files), [
    { id: "col", missing: [["colecovision.rom", "coleco.rom", "os7.u2"]] },
    { id: "msx", missing: [["Databases/msxromdb.xml"]] },
  ]);
  assert.deepEqual(missingBios(["segacd", "pcecd"], []), [
    { id: "segacd", missing: [["bios_CD_U.bin", "bios_CD_E.bin", "bios_CD_J.bin"]] },
    { id: "pcecd", missing: [["syscard3.pce"]] },
  ]);
  assert.deepEqual(missingBios(["msx"], ["MSX.rom", "msxromdb.xml"]).map((x) => x.missing.length), [2], "MSX wants its exact paths");
  assert.deepEqual(missingBios(["__proto__", "constructor"], []), [], "only real rules");
  // NeoCD reads system/neocd/ and the folders under it; one at the top is moved there for the console.
  assert.deepEqual(missingBios(["neocd"], ["neocd_f.rom"]), [], "a NeoCD BIOS at the top goes into neocd/");
  assert.deepEqual(missingBios(["neocd"], ["neocd/front/neocd_f.rom"]), [], "any folder under neocd/");
  assert.equal(missingBios(["neocd"], ["other/neocd_f.rom"]).length, 1, "another folder is not where NeoCD looks");
  for (const id of Object.keys(BIOS)) assert.ok(DEFAULT_SYSTEMS[id], `a BIOS rule for a known system: ${id}`);
});

const PORT = 15400 + (process.pid % 500);
const BASE = `http://127.0.0.1:${PORT}`;
// An approved console: the shop takes its keys, never a password.
const AUTH = CONSOLE;
const get = (url) => fetch(BASE + url, { headers: AUTH });

async function boot(retroDir) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "retro-sys-data-"));
  fs.mkdirSync(path.join(data, "games"));
  await seedConsole(data);
  const child = spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: { ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: data, COOK_GAMES_DIR: path.join(data, "games"), COOK_RETRO_DIR: retroDir,
      COOK_AUTH_USERS: "alice:alice-password", COOK_TITLEDB_AUTO_FETCH: "false" },
    stdio: "ignore",
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) return child;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill("SIGKILL");
  throw new Error("server did not start");
}

test("folders with spaces and dots work end to end; empty systems stay out of every list", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "retro-sys-api-"));
  put(dir, "systems.json", JSON.stringify({ msx: { folder: "Microsoft - MSX2+ v1.1" } }));
  put(dir, "roms/Sega - 32X/Knuckles Chaotix (USA).32x", "KC");
  put(dir, "roms/Microsoft - MSX2+ v1.1/Penguin Adventure (Japan).rom", "PA");
  put(dir, "thumbnails/Sega - 32X/Named_Boxarts/Knuckles Chaotix (USA).png", "PNG");
  // Icons are filed by the short id; the folder is RetroArch's long name.
  put(dir, "system-icons/color/32x.png", "ICON32X");
  put(dir, "system-icons/mono/Sega - 32X.png", "MONO32X");
  // Pre-registered consoles: an icon and a folder, but no games.
  fs.mkdirSync(path.join(dir, "roms/Atari - 2600"), { recursive: true });
  put(dir, "system-icons/color/a2600.png", "ICON2600");
  put(dir, "roms/Coleco - ColecoVision/readme.txt", "none yet");
  const server = await boot(dir);
  try {
    const { systems } = await (await get("/api/retro/systems")).json();
    assert.deepEqual(systems.map((s) => s.id).sort(), ["32x", "msx"]);
    const s32x = systems.find((s) => s.id === "32x");
    assert.equal(await (await get(s32x.iconUrl)).text(), "ICON32X", "falls back to <id>.png");
    assert.equal(await (await get(s32x.iconMonoUrl)).text(), "MONO32X", "<folder>.png first");
    assert.equal(systems.find((s) => s.id === "msx").iconUrl, null, "no icon: null, never a broken image");
    assert.equal((await get("/api/retro/systems/a2600/icon")).status, 404, "an empty console's icon is hidden too");

    const home = await (await get("/api/retro/home")).json();
    assert.deepEqual(home.systems.map((s) => s.id).sort(), ["32x", "msx"]);
    assert.equal((await (await get("/api/retro/games?system=a2600")).json()).total, 0);

    const game = (await (await get("/api/retro/games?system=32x")).json()).games[0];
    assert.equal(game.install.rom, "roms/32x/Knuckles Chaotix (USA).32x", "the SD card keeps the short id");
    assert.equal(pathProblem(game.install.rom), null);
    assert.ok(game.iconUrl, "box art found under the long folder");
    assert.equal(await (await get(game.romUrl)).text(), "KC");
    const msx = (await (await get("/api/retro/games?system=msx")).json()).games[0];
    assert.equal(await (await get(msx.romUrl)).text(), "PA", "a folder with a dot and a plus");
    assert.match(msx.install.rom, /^roms\/msx\//);
  } finally {
    server.kill("SIGKILL");
  }
});

test("a system folder named the way other front ends name it is read as that system", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cook-alias-"));
  try {
    put(root, "roms/SNES/Chrono Trigger.sfc");
    put(root, "roms/Nintendo - Game Boy Advance/Golden Sun.gba");
    put(root, "roms/genesis/Sonic.md");
    put(root, "roms/psx/Xenogears.chd");
    const s = loadSystems(root);
    assert.equal(s.snes.folder, "SNES");
    assert.equal(s.gba.folder, "Nintendo - Game Boy Advance");
    assert.equal(s.md.folder, "genesis");
    assert.equal(s.ps1.folder, "psx");
    assert.equal(s.nes.folder, "nes", "a system with no folder keeps its own name, so an upload makes it");
    const { games } = await scanDir(root);
    assert.deepEqual(games.map((g) => g.system).sort(), ["gba", "md", "ps1", "snes"]);
    assert.deepEqual(unreadFolders(root, s), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the system's own folder wins over a look-alike, which is then reported unread", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cook-alias-"));
  try {
    put(root, "roms/snes/a.sfc");
    put(root, "roms/SNES/b.sfc");
    put(root, "roms/My Hacks/c.sfc");
    put(root, "roms/.trash/d.sfc");
    put(root, "roms/loose.sfc");
    const s = loadSystems(root);
    assert.equal(s.snes.folder, "snes");
    assert.deepEqual(unreadFolders(root, s), ["My Hacks", "SNES"]);
    assert.deepEqual(unreadReasons(root, s), [
      { folder: "My Hacks", system: null, by: null },
      { folder: "SNES", system: "snes", by: "snes" },
    ], "SNES is a known system's look-alike, held back by the folder that already has its games");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an empty own folder gives way to a look-alike holding games; an empty look-alike does not", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cook-alias-"));
  try {
    fs.mkdirSync(path.join(root, "roms", "snes"), { recursive: true });
    put(root, "roms/snes/.DS_Store");
    put(root, "roms/SNES/a.sfc");
    fs.mkdirSync(path.join(root, "roms", "gba"));
    fs.mkdirSync(path.join(root, "roms", "Nintendo - Game Boy Advance"));
    const s = loadSystems(root);
    assert.equal(s.snes.folder, "SNES", "a folder with only dot files counts as empty");
    assert.equal(s.gba.folder, "gba", "both empty: the own folder stays");
    assert.deepEqual(unreadFolders(root, s), ["Nintendo - Game Boy Advance"], "the empty snes is not reported unread");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an own folder holding only OS litter (Thumbs.db, desktop.ini, dot files) counts as empty", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cook-alias-"));
  try {
    put(root, "roms/snes/Thumbs.db");
    put(root, "roms/snes/desktop.ini");
    put(root, "roms/snes/.DS_Store");
    put(root, "roms/SNES/a.sfc");
    put(root, "roms/gba/THUMBS.DB");
    put(root, "roms/gba/real.gba");
    put(root, "roms/GBA/b.gba");
    const s = loadSystems(root);
    assert.equal(s.snes.folder, "SNES", "litter is not a game");
    assert.equal(s.gba.folder, "gba", "a real file next to the litter keeps the own folder");
    assert.deepEqual(unreadFolders(root, s), ["GBA"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a folder named in systems.json is taken as written, never swapped for a look-alike", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cook-alias-"));
  try {
    put(root, "systems.json", JSON.stringify({ snes: { folder: "Super Famicom" } }));
    put(root, "roms/SNES/a.sfc");
    const s = loadSystems(root);
    assert.equal(s.snes.folder, "Super Famicom");
    assert.deepEqual(unreadFolders(root, s), ["SNES"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("no folder name points at two systems", () => {
  const owner = new Map();
  for (const id of Object.keys(DEFAULT_SYSTEMS)) {
    for (const k of folderKeys(id, DEFAULT_SYSTEMS[id])) {
      assert.ok(!owner.has(k) || owner.get(k) === id, `${k}: ${owner.get(k)} and ${id}`);
      owner.set(k, id);
    }
  }
});
