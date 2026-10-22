import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { HashCache } from "../../src/helpers/hash-cache.js";
import { listCores, originOf, OFFICIAL_VERSION } from "../../src/retro/core-list.js";
import official from "../../src/retro/data/official-cores-1.22.2.js";

const memory = () => { const m = new Map(); return { get: (k) => m.get(k), set: (k, v) => m.set(k, v), prune: () => {} }; };

function pack(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "retro-cores-"));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  return dir;
}

test("a core is official only when its bytes match the pinned bundle, modified when its name does but its bytes don't", () => {
  assert.equal(OFFICIAL_VERSION, "1.22.2");
  assert.equal(originOf("mgba_libretro_libnx.nro", official.files["mgba_libretro_libnx.nro"][0]), "official");
  assert.equal(originOf("mgba_libretro_libnx.nro", "0".repeat(64)), "modified");
  assert.equal(originOf("stella_libretro_libnx.nro", "0".repeat(64)), "extra", "a core the bundle lacks");
  assert.ok(official.files["retroarch_switch.nro"], "RetroArch itself is pinned too");
});

test("the core list shows each file's size, hash, name and the consoles whose games use it", async () => {
  const dir = pack({
    "retroarch.nro": "NRO",
    "cores/mgba_libretro_libnx.nro": "patched build",
    "cores/stella_libretro_libnx.nro": "STELLA",
    "info/mgba_libretro.info": 'display_name = "Nintendo - Game Boy Advance (mGBA)"\n',
    "cores/readme.txt": "not a core",
  });
  const games = [{ system: "gba", core: "mgba" }, { system: "gba", core: "mgba" }, { system: "gb", core: "mgba" }];
  const systems = { gba: { names: { ko: "게임보이 어드밴스" } } };
  const out = await listCores(dir, new HashCache(memory()), games, systems);
  assert.equal(out.retroarch.origin, "modified", "a retroarch.nro unlike the official one");
  assert.deepEqual(out.cores.map((c) => [c.core, c.name, c.origin]), [["mgba", "Nintendo - Game Boy Advance (mGBA)", "modified"], ["stella", null, "extra"]]);
  const mgba = out.cores[0];
  assert.equal(mgba.file, "cores/mgba_libretro_libnx.nro");
  assert.equal(mgba.size, "patched build".length);
  assert.equal(mgba.sha256, crypto.createHash("sha256").update("patched build").digest("hex"));
  assert.deepEqual(mgba.systems, [{ id: "gba", name: "게임보이 어드밴스", games: 2 }, { id: "gb", name: "gb", games: 1 }]);
  assert.deepEqual(out.cores[1].systems, [], "a core no game uses");
});

test("no pack yet lists nothing", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "retro-cores-"));
  assert.deepEqual(await listCores(dir, new HashCache(memory()), [], {}), { official: "1.22.2", retroarch: null, cores: [] });
});
