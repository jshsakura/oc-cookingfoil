import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_SYSTEMS } from "../../src/retro/systems.js";
import { scanDir } from "../../src/retro/catalog.js";
import { assignSdNames } from "../../src/retro/sd-names.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "retro-scummvm-"));
function put(root, rel, body = "x") {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body);
}

test("ScummVM is a system with its own libretro box art and bezel names", () => {
  const s = DEFAULT_SYSTEMS.scummvm;
  assert.deepEqual([s.core, s.coreName, s.extensions, s.libretro, s.bezelDir, s.folder], ["scummvm", "ScummVM", [".scummvm"], "ScummVM", "ScummVM", "ScummVM"]);
  for (const lang of ["en", "ko", "ja", "zh"]) assert.ok(s.names[lang], lang);
});

test("a .scummvm file brings every file of its folder, subfolders too, and is the one game listed", async () => {
  const dir = tmp();
  put(dir, "roms/ScummVM/monkey2/monkey2.scummvm", "monkey2\n");
  put(dir, "roms/ScummVM/monkey2/monkey2.000", "aaaa");
  put(dir, "roms/ScummVM/monkey2/monkey2.001", "bbbbbb");
  put(dir, "roms/ScummVM/monkey2/RESOURCE/sub/korean.fnt", "cc");
  put(dir, "roms/ScummVM/monkey2/.hidden", "no");
  put(dir, "roms/ScummVM/other/other.scummvm", "ft\n");
  put(dir, "roms/ScummVM/other/other.000", "z");

  const { games } = await scanDir(dir);
  const sv = games.filter((g) => g.system === "scummvm");
  assert.deepEqual(sv.map((g) => g.name).sort(), ["monkey2", "other"]);
  const monkey = sv.find((g) => g.name === "monkey2");
  assert.deepEqual(monkey.extras.map((x) => x.rel).sort(), [
    "monkey2/RESOURCE/sub/korean.fnt", "monkey2/monkey2.000", "monkey2/monkey2.001",
  ]);
  assert.equal(monkey.size, 8 + 4 + 6 + 2, "the game's size counts its folder");
  assert.equal(sv.find((g) => g.name === "other").extras.length, 1, "another game's folder is its own");
  assert.equal(monkey.core, "scummvm");
});

test("a .scummvm file with no folder of its own takes nothing along", async () => {
  const dir = tmp();
  put(dir, "roms/ScummVM/loose.scummvm", "x");
  put(dir, "roms/ScummVM/neighbour/other.scummvm", "y");
  put(dir, "roms/ScummVM/neighbour/other.000", "z");
  const { games } = await scanDir(dir);
  const loose = games.find((g) => g.name === "loose");
  assert.deepEqual(loose.extras, []);
  assert.equal(loose.size, 1);
});

test("a ScummVM game goes to its own SD folder with its files' names and subfolders kept", async () => {
  const dir = tmp();
  put(dir, "roms/ScummVM/Monkey Island 1/monkey1.scummvm", "monkey1\n");
  put(dir, "roms/ScummVM/Monkey Island 1/MONSTER.SOU");
  put(dir, "roms/ScummVM/Monkey Island 1/audio/track1.ogg");
  put(dir, "roms/ScummVM/Monkey Island 2/monkey2.scummvm", "monkey2\n");
  put(dir, "roms/ScummVM/Monkey Island 2/MONSTER.SOU");
  put(dir, "roms/ScummVM/Monkey Island 2/한글.fnt");

  const { games } = await scanDir(dir);
  const sv = games.filter((g) => g.system === "scummvm");
  await assignSdNames(sv);
  const plan = (name) => { const g = sv.find((x) => x.name === name); return [g.sd.rom, ...[...g.sd.extras.values()].map((x) => x.sd)].sort(); };
  assert.deepEqual(plan("monkey1"), ["roms/scummvm/monkey1/MONSTER.SOU", "roms/scummvm/monkey1/audio/track1.ogg", "roms/scummvm/monkey1/monkey1.scummvm"]);
  assert.deepEqual(plan("monkey2"), ["roms/scummvm/monkey2/MONSTER.SOU", "roms/scummvm/monkey2/monkey2 (extra 2).fnt", "roms/scummvm/monkey2/monkey2.scummvm"],
    "a name the console can't create is renamed, the rest kept");
});

test("two .scummvm files in one folder are two games, neither taking the other along", async () => {
  const dir = tmp();
  put(dir, "roms/ScummVM/pack/a.scummvm", "a\n");
  put(dir, "roms/ScummVM/pack/b.scummvm", "b\n");
  put(dir, "roms/ScummVM/pack/data.000");
  const { games } = await scanDir(dir);
  const sv = games.filter((g) => g.system === "scummvm");
  assert.deepEqual(sv.map((g) => g.name).sort(), ["a", "b"]);
  for (const g of sv) assert.deepEqual(g.extras.map((x) => x.rel), ["pack/data.000"]);
});
