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
