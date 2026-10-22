import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_SYSTEMS } from "../../src/retro/systems.js";
import { scanDir } from "../../src/retro/catalog.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "retro-openbor-"));
function put(root, rel, body = "x") {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body);
}

test("OpenBOR is a system run by the OpenBOR libretro core", () => {
  const s = DEFAULT_SYSTEMS.openbor;
  assert.deepEqual([s.core, s.coreName, s.extensions, s.folder], ["openbor", "OpenBOR", [".pak"], "OpenBOR"]);
  for (const lang of ["en", "ko", "ja", "zh"]) assert.ok(s.names[lang], lang);
});

test("a .pak in roms/OpenBOR is listed as an OpenBOR game", async () => {
  const dir = tmp();
  put(dir, "roms/OpenBOR/Sample Brawler.pak");
  put(dir, "roms/OpenBOR/readme.txt");
  const { games } = await scanDir(dir);
  const bor = games.filter((g) => g.system === "openbor");
  assert.deepEqual(bor.map((g) => g.name), ["Sample Brawler"]);
});
