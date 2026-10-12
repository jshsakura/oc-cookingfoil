import { test } from "node:test";
import assert from "node:assert/strict";
import { applyArcade, dependencies, listedName, setInfo, splitDescription } from "../../src/retro/arcade.js";
import { assignSdNames } from "../../src/retro/sd-names.js";

const zip = (short, size = 100) => ({
  id: `arcade-${short}`, system: "arcade", name: short, file: `${short}.zip`, rel: `${short}.zip`, abs: `/roms/${short}.zip`,
  size, fileSize: size, mtimeMs: 1, extras: [], core: "fbneo",
});

test("a description splits into the title and its version", () => {
  assert.deepEqual(splitDescription("Street Fighter II: The World Warrior (World 910522)"), ["Street Fighter II: The World Warrior", "World 910522"]);
  assert.deepEqual(splitDescription("1942"), ["1942", null]);
});

test("sets are named in Korean first, with the English title and the version beside it", () => {
  const sf2 = setInfo("sf2");
  assert.equal(sf2.base, "Street Fighter II: The World Warrior");
  assert.ok(sf2.names.ko, "a Korean title");
  assert.equal(listedName(sf2), `${sf2.names.ko} (Street Fighter II: The World Warrior) [World 910522]`);
  assert.equal(setInfo("SF2").desc, sf2.desc, "short names are matched without case");
  assert.equal(setInfo("not-a-set"), null);
});

test("a clone needs its parent, a Neo Geo game its BIOS", () => {
  assert.deepEqual(dependencies("mslug"), ["neogeo"]);
  assert.deepEqual(dependencies("99lstwar"), ["repulse"]);
  assert.equal(setInfo("neogeo").bios, true);
});

test("BIOS sets leave the list and travel with the games that need them; unknown zips stay as they are", async () => {
  const games = applyArcade([zip("mslug", 1000), zip("neogeo", 50), zip("homemade", 7)]);
  assert.deepEqual(games.map((g) => g.file).sort(), ["homemade.zip", "mslug.zip"]);
  const mslug = games.find((g) => g.file === "mslug.zip");
  assert.deepEqual(mslug.extras.map((x) => x.rel), ["neogeo.zip"]);
  assert.equal(mslug.size, 1050);
  assert.equal(mslug.original, setInfo("mslug").desc);
  assert.ok(mslug.names.en && mslug.names.ko);
  assert.equal(games.find((g) => g.file === "homemade.zip").name, "homemade");

  // On the SD card the zips keep the short names the core looks for.
  await assignSdNames(games, async () => "");
  assert.equal(mslug.sd.rom, "roms/arcade/mslug.zip");
  assert.equal(mslug.sd.extras.get("neogeo.zip").sd, "roms/arcade/neogeo.zip");
});

test("an arcade folder is read with the DAT: Korean names, BIOS folded in, short names kept", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { scanDir } = await import("../../src/retro/catalog.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-"));
  const roms = path.join(dir, "roms", "FBNeo - Arcade Games");
  fs.mkdirSync(roms, { recursive: true });
  for (const f of ["bublbobl.zip", "mslug.zip", "neogeo.zip"]) fs.writeFileSync(path.join(roms, f), f);
  const { games } = await scanDir(dir);
  assert.deepEqual(games.map((g) => g.file).sort(), ["bublbobl.zip", "mslug.zip"]);
  const bubl = games.find((g) => g.file === "bublbobl.zip");
  assert.equal(bubl.names.ko, "보글보글");
  assert.equal(bubl.sd.rom, "roms/arcade/bublbobl.zip");
  assert.deepEqual(games.find((g) => g.file === "mslug.zip").extras.map((x) => x.rel), ["neogeo.zip"]);
});

test("the operator's arcade-names.json wins over the built-in titles", () => {
  const info = setInfo("rygar", { rygar: { ko: "아르고스의 전사", zh: "  " } });
  assert.equal(info.names.ko, "아르고스의 전사");
  assert.equal(info.names.en, "Rygar");
  assert.equal(setInfo("bublbobl", { "Bubble Bobble": { ko: "버블 보블" } }).names.ko, "버블 보블", "by English title too");
  assert.equal(setInfo("bublbobl").names.ko, "보글보글");
});

test("arcade is listed before the other systems", async () => {
  const { systemsOf } = await import("../../src/retro/catalog.js");
  const systems = { snes: { names: { en: "SNES" } }, arcade: { names: { en: "Arcade" } }, gba: { names: { en: "GBA" } } };
  const ids = systemsOf({ systems, games: [], present: new Set(["snes", "arcade", "gba"]) }).map((s) => s.id);
  assert.deepEqual(ids, ["arcade", "snes", "gba"]);
});

test("a Korean version is listed instead of its parent, which still travels with it", () => {
  const games = applyArcade([zip("samsho2", 10), zip("samsho2k", 5), zip("mslug", 7), zip("neogeo", 1)]);
  assert.deepEqual(games.map((g) => g.file).sort(), ["mslug.zip", "samsho2k.zip"]);
  const k = games.find((g) => g.file === "samsho2k.zip");
  assert.deepEqual(k.extras.map((x) => x.rel), ["samsho2.zip", "neogeo.zip"]);
});

test("the version tag becomes a region code for a flag", async () => {
  const { regionOf } = await import("../../src/retro/arcade.js");
  assert.equal(regionOf("World 911202"), "world");
  assert.equal(regionOf("Europe 940705"), "eu");
  assert.equal(regionOf("Japan, set 1"), "jp");
  assert.equal(regionOf("USA 920513"), "us");
  assert.equal(regionOf("Asia 970319"), "asia");
  assert.equal(regionOf("Korean Translation 911202"), "kr");
  assert.equal(regionOf("Korean release"), "kr");
  assert.equal(regionOf("NGM-2420"), null);
  assert.equal(regionOf(null), null);
});
