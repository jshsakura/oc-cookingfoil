import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { coreFile, packDirOf, packStatus } from "../../src/retro/pack-status.js";

const SYSTEMS = { snes: { names: { ko: "슈퍼 패미컴" } }, gba: { names: { ko: "게임보이 어드밴스" } } };
const pack = (files) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "retro-pack-"));
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(root, "retroarch", f)), { recursive: true });
    fs.writeFileSync(path.join(root, "retroarch", f), "x");
  }
  return root;
};

test("each console with games says whether every core its games name is in the pack", () => {
  const root = pack(["retroarch.nro", coreFile("snes9x")]);
  const games = [
    { system: "snes", core: "snes9x" }, { system: "snes", core: "snes9x" }, { system: "snes", core: "bsnes" },
    { system: "gba", core: "mgba" },
  ];
  const status = packStatus(packDirOf(root), games, SYSTEMS);
  assert.equal(status.retroarch, "installed");
  assert.deepEqual(status.systems.map((s) => [s.id, s.name, s.games, s.state]), [["snes", "슈퍼 패미컴", 3, "core-missing"], ["gba", "게임보이 어드밴스", 1, "core-missing"]]);
  assert.deepEqual(status.systems[0].cores, [
    { core: "snes9x", file: "cores/snes9x_libretro_libnx.nro", games: 2, installed: true },
    { core: "bsnes", file: "cores/bsnes_libretro_libnx.nro", games: 1, installed: false },
  ]);
});

test("an empty server pack reports RetroArch missing and nothing else is assumed", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "retro-pack-"));
  const status = packStatus(packDirOf(root), [{ system: "gba", core: "mgba" }], SYSTEMS);
  assert.equal(status.retroarch, "missing");
  assert.equal(status.systems[0].state, "core-missing");
  assert.deepEqual(packStatus(packDirOf(root), [], SYSTEMS).systems, [], "no games, no consoles to report");
});

test("a pack with every core is ready, and the older base-pack folder is read too", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "retro-pack-"));
  fs.mkdirSync(path.join(root, "base-pack", "cores"), { recursive: true });
  fs.writeFileSync(path.join(root, "base-pack", coreFile("mgba")), "x");
  assert.equal(packStatus(packDirOf(root), [{ system: "gba", core: "mgba" }], SYSTEMS).systems[0].state, "ready");
});

test("a console whose every core is switched off reads core-off; one with another core on is judged by that", () => {
  const root = pack(["retroarch.nro", coreFile("snes9x")]);
  const games = [{ system: "snes", core: "snes9x" }, { system: "snes", core: "bsnes" }, { system: "gba", core: "mgba" }];
  const status = packStatus(packDirOf(root), games, SYSTEMS, new Set(["bsnes", "mgba"]));
  assert.deepEqual(status.systems.map((s) => [s.id, s.state]), [["snes", "ready"], ["gba", "core-off"]]);
  assert.equal(status.systems[0].cores[1].off, true);
});
