import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_SYSTEMS } from "../../src/retro/systems.js";
import { BIOS, Md5Cache, consoleFirmwarePath, firmwareRenames, listFirmware, missingBios } from "../../src/retro/bios.js";
import { CORE_NOTE, requirements } from "../../src/retro/requirements.js";
import { listPack } from "../../src/retro/base-pack.js";
import { coreFile } from "../../src/retro/pack-status.js";

const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");

/** A retro folder with retroarch/ holding `files` ({ rel: content }). */
function retro(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "retro-req-"));
  const pack = path.join(root, "retroarch");
  fs.mkdirSync(path.join(pack, "system"), { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(pack, rel)), { recursive: true });
    fs.writeFileSync(path.join(pack, rel), body);
  }
  return { root, pack, system: path.join(pack, "system") };
}

/** BIOS with fake known hashes, so the tests never carry real firmware. */
const RULES = {
  ...BIOS,
  gba: { groups: [], extra: [{ files: ["gba_bios.bin"] }], md5: { "gba_bios.bin": [md5("good gba bios")] } },
  pcecd: { groups: [["syscard3.pce"]], md5: { "syscard3.pce": [md5("good syscard")] } },
};

const view = async (r, games, opts = {}) => requirements({
  games, systems: DEFAULT_SYSTEMS, packDir: r.pack, firmwareDir: r.system,
  files: await listFirmware(r.system), cache: opts.cache ?? new Md5Cache(), rules: opts.rules ?? RULES,
});

test("every BIOS rule names a known system, and every core it was checked for is that system's core", () => {
  const checked = { col: "gearcoleco", videopac: "o2em", msx: "bluemsx", neocd: "neocd", pcecd: "mednafen_pce_fast", segacd: "genesis_plus_gx",
    nes: "fceumm", gb: "gambatte", gbc: "gambatte", gba: "mgba", md: "genesis_plus_gx", sms: "genesis_plus_gx", gg: "genesis_plus_gx",
    ps1: "pcsx_rearmed", nds: "melonds", saturn: "yabause", a7800: "prosystem", lynx: "handy" };
  for (const [id, rule] of Object.entries(BIOS)) {
    assert.ok(DEFAULT_SYSTEMS[id], `a BIOS rule for a known system: ${id}`);
    assert.equal(DEFAULT_SYSTEMS[id].core, checked[id], `${id}'s firmware was read from its core's page`);
    assert.ok(Array.isArray(rule.groups), `${id} keeps its required groups`);
    for (const [file, hashes] of Object.entries(rule.md5 ?? {})) {
      assert.ok([...rule.groups.flat(), ...(rule.extra ?? []).flatMap((x) => x.files)].includes(file), `${id} hashes a file it names: ${file}`);
      for (const h of hashes) assert.match(h, /^[0-9a-f]{32}$/, `${id} ${file} md5 is lower-case hex`);
    }
  }
});

test("a file's name is matched without case, at the top, in a system, core or bios folder, never in another folder", () => {
  assert.deepEqual(missingBios(["pcecd"], ["SYSCARD3.PCE"]), [], "upper case");
  assert.deepEqual(missingBios(["pcecd"], ["pcecd/syscard3.pce"]), [], "the system's id");
  assert.deepEqual(missingBios(["pcecd"], ["mednafen_pce_fast/syscard3.pce"]), [], "the core");
  assert.deepEqual(missingBios(["pcecd"], ["BIOS/syscard3.pce"]), [], "a bios folder");
  assert.equal(missingBios(["pcecd"], ["other/syscard3.pce"]).length, 1, "another folder");
  assert.deepEqual(missingBios(["col"], ["gearcoleco/coleco.rom"]), [], "the core's other name for the same BIOS");
});

test("a firmware file goes to the console where its core looks, whatever case or folder the operator used", () => {
  assert.equal(consoleFirmwarePath("SCPH5501.BIN"), "scph5501.bin");
  assert.equal(consoleFirmwarePath("segacd/bios_cd_u.bin"), "bios_CD_U.bin");
  assert.equal(consoleFirmwarePath("bios/neocd_f.rom"), "neocd/neocd_f.rom");
  assert.equal(consoleFirmwarePath("neocd/front/neocd_f.rom"), "neocd/front/neocd_f.rom", "NeoCD reads its subfolders");
  assert.equal(consoleFirmwarePath("other/scph5501.bin"), "other/scph5501.bin", "an unrelated folder is left as it is");
  assert.equal(consoleFirmwarePath("BS-X.bin"), "BS-X.bin", "a file the table does not know stays");
});

test("a misnamed file with a known hash is recognised and reaches the console under the expected name", async () => {
  const r = retro({ "system/my gba.bin": "good gba bios", "system/unrelated.txt": "x" });
  const files = await listFirmware(r.system);
  const renames = await firmwareRenames(r.system, files, new Md5Cache(), RULES);
  assert.deepEqual([...renames], [["my gba.bin", "gba_bios.bin"]]);
  const out = await view(r, [{ system: "gba", core: "mgba", rel: "a.gba" }]);
  const fw = out.systems[0].firmware[0];
  assert.equal(fw.state, "present");
  assert.equal(fw.file, "my gba.bin");
  assert.equal(fw.recognizedAs, "gba_bios.bin");
  assert.equal(fw.console, "retroarch/system/gba_bios.bin");
});

test("the base pack sends a misnamed but known firmware under its expected name", async () => {
  const r = retro({ "system/psx.bin": "x" });
  const known = md5("x");
  const pack = await listPack(r.pack, { cleanDir: path.join(r.root, "clean"), firmware: { cache: new Md5Cache(), rules: { ps1: { groups: [], extra: [{ files: ["scph5501.bin"] }], md5: { "scph5501.bin": [known] } } } } });
  assert.deepEqual(pack.map((f) => f.path), ["retroarch/system/scph5501.bin"]);
});

test("each firmware is present, missing, or present with another hash, and optional ones never count as missing", async () => {
  const r = retro({ "system/syscard3.pce": "a bad dump" });
  const out = await view(r, [{ system: "pcecd", core: "mednafen_pce_fast", rel: "a.cue" }, { system: "gba", core: "mgba", rel: "b.gba" }]);
  const pce = out.systems.find((s) => s.id === "pcecd");
  assert.equal(pce.firmware[0].state, "mismatch");
  assert.equal(pce.firmware[0].md5.actual, md5("a bad dump"));
  assert.equal(pce.missing, 1);
  const gba = out.systems.find((s) => s.id === "gba");
  assert.deepEqual(gba.firmware.map((f) => [f.files[0], f.required, f.state]), [["gba_bios.bin", false, "missing"]]);
  assert.equal(gba.missing, 0, "optional");
  assert.equal(out.complete, false);
  assert.deepEqual(out.systems.map((s) => s.id), ["pcecd", "gba"], "systems that still need something come first");

  fs.writeFileSync(path.join(r.system, "syscard3.pce"), "good syscard");
  const fixed = await view(r, [{ system: "pcecd", core: "mednafen_pce_fast", rel: "a.cue" }]);
  assert.equal(fixed.systems[0].firmware[0].state, "present");
  assert.equal(fixed.complete, true);
});

test("firmware for some games only is asked for only when such a game is there", async () => {
  const r = retro({});
  const rules = { nes: BIOS.nes };
  const carts = await view(r, [{ system: "nes", core: "fceumm", rel: "a.nes" }], { rules });
  assert.deepEqual(carts.systems[0].firmware, []);
  const disks = await view(r, [{ system: "nes", core: "fceumm", rel: "b.FDS" }], { rules });
  assert.deepEqual(disks.systems[0].firmware.map((f) => [f.files[0], f.required, f.state]), [["disksys.rom", true, "missing"]]);
});

test("a firmware's hash is read once while its size and time stay the same", async () => {
  const r = retro({ "system/syscard3.pce": "a bad dump", "system/stray.bin": "y" });
  const cache = new Md5Cache();
  const games = [{ system: "pcecd", core: "mednafen_pce_fast", rel: "a.cue" }, { system: "gba", core: "mgba", rel: "b.gba" }];
  await view(r, games, { cache });
  const reads = cache.reads;
  assert.ok(reads >= 1);
  await view(r, games, { cache });
  assert.equal(cache.reads, reads, "the second call reads no file");
  const big = path.join(r.system, "huge.bin");
  fs.writeFileSync(big, "");
  fs.truncateSync(big, 65 * 1024 * 1024);
  assert.equal(await cache.md5(big), null, "too big to be a BIOS");
});

test("the core each system's games use is named as a Switch .nro, with the server's and the console's place", async () => {
  const r = retro({ [coreFile("mgba")]: "nro", "retroarch.nro": "x" });
  const out = await view(r, [{ system: "gba", core: "mgba", rel: "a.gba" }, { system: "snes", core: "snes9x", rel: "b.sfc" }]);
  assert.match(CORE_NOTE, /\.nro/);
  assert.match(CORE_NOTE, /\.dll/);
  assert.equal(out.note, CORE_NOTE);
  assert.equal(out.retroarch, "installed");
  const cores = Object.fromEntries(out.systems.map((s) => [s.id, s.cores[0]]));
  assert.deepEqual(cores.gba, { core: "mgba", file: "mgba_libretro_libnx.nro", server: "retroarch/cores/mgba_libretro_libnx.nro", console: "sdmc:/retroarch/cores/mgba_libretro_libnx.nro", games: 1, state: "present", warn: false });
  assert.equal(cores.snes.state, "missing");
  assert.equal(cores.snes.warn, true);
});

test("a core state the pack reports wins over the file check, and only a failed or unbundled core warns", async () => {
  const { coreView } = await import("../../src/retro/requirements.js");
  assert.deepEqual(coreView({ core: "fbneo", file: coreFile("fbneo"), games: 2, installed: false, state: "will-install" }),
    { core: "fbneo", file: "fbneo_libretro_libnx.nro", server: "retroarch/cores/fbneo_libretro_libnx.nro", console: "sdmc:/retroarch/cores/fbneo_libretro_libnx.nro", games: 2, state: "will-install", warn: false });
  assert.equal(coreView({ core: "x", file: coreFile("x"), games: 1, installed: false, state: "failed", reason: "hash" }).warn, true);
  assert.equal(coreView({ core: "x", file: coreFile("x"), games: 1, installed: false, state: "failed", reason: "hash" }).reason, "hash");
  assert.equal(coreView({ core: "x", file: coreFile("x"), games: 1, installed: false, state: "not-in-bundle" }).warn, true);
});

test("arcade sets sum up the BIOS they need and the parents that are not there", async () => {
  const r = retro({ "system/fbneo/PGM.zip": "x" });
  const games = [
    { system: "arcade", core: "fbneo", rel: "mslug.zip", set: "mslug", missing: ["neogeo"] },
    { system: "arcade", core: "fbneo", rel: "kof98.zip", set: "kof98", missing: ["neogeo"] },
    { system: "arcade", core: "fbneo", rel: "sf2ua.zip", set: "sf2ua", missing: ["sf2"] },
    { system: "arcade", core: "fbneo", rel: "orlegend.zip", set: "orlegend", missing: ["pgm"] },
    { system: "arcade", core: "fbneo", rel: "gunbird.zip", set: "gunbird", missing: [] },
  ];
  const a = (await view(r, games)).systems[0];
  assert.equal(a.arcade.sets, 5);
  assert.equal(a.arcade.missingSets, 3, "pgm.zip in system/fbneo/ is where FBNeo looks too");
  assert.deepEqual(a.arcade.bios, [{ zip: "neogeo.zip", sets: 2, state: "missing" }, { zip: "pgm.zip", sets: 1, state: "present" }]);
  assert.deepEqual(a.arcade.parents, [{ zip: "sf2.zip", sets: 1 }]);
  assert.equal(a.missing, 2);
});
