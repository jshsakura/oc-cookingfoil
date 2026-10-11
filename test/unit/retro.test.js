import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { referencedFiles, gameId, scanDir } from "../../src/retro/catalog.js";
import { sdPathOf } from "../../src/retro/base-pack.js";
import { gameCfg, overlayCfg, sdPaths } from "../../src/retro/bezel-config.js";
import { loadSystems } from "../../src/retro/systems.js";

function put(root, rel, body = "x") {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body);
}

/** File names and bodies in an uncompressed ustar buffer. */
function untar(buf) {
  const out = new Map();
  for (let off = 0; off + 512 <= buf.length; ) {
    const h = buf.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const str = (a, b) => h.subarray(a, b).toString("utf8").replace(/\0.*$/s, "");
    const name = (str(345, 500) ? str(345, 500) + "/" : "") + str(0, 100);
    const size = Number.parseInt(str(124, 136).trim() || "0", 8);
    out.set(name, buf.subarray(off + 512, off + 512 + size).toString("utf8"));
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "retro-"));
  put(dir, "roms/snes/Super Mario World (USA).sfc", "SMW");
  put(dir, "roms/snes/notes.txt", "not a game");
  put(dir, "roms/snes/Chrono Trigger (USA).sfc", "CT");
  put(dir, "roms/ps1/Disc Game/Disc Game.cue", 'FILE "Disc Game (Track 1).bin" BINARY\nFILE "../../escape.bin" BINARY\n');
  put(dir, "roms/ps1/Disc Game/Disc Game (Track 1).bin", "TRACK1");
  put(dir, "roms/gba/.hidden.gba", "x");
  put(dir, "icons/snes/Super Mario World (USA).png", "PNG");
  put(dir, "bezels/snes/Super Mario World (USA).png", "BEZEL");
  put(dir, "bezels/ps1/_default.png", "GENERIC");
  put(dir, "base-pack/retroarch.nro", "NRO");
  put(dir, "base-pack/retroarch.cfg", 'user_language = "14"\n');
  put(dir, "base-pack/cores/snes9x_libretro_libnx.nro", "CORE");
  put(dir, "base-pack/assets/fonts/korean.ttf", "FONT");
  put(dir, "base-pack/.DS_Store", "junk");
  return dir;
}

test("disc lists name only files beside them", () => {
  assert.deepEqual(referencedFiles(".cue", 'FILE "a b.bin" BINARY\nFILE c.bin BINARY\nFILE "../x.bin" BINARY\nFILE "/abs.bin" BINARY'), ["a b.bin", "c.bin"]);
  assert.deepEqual(referencedFiles(".m3u", "#comment\nDisc 1.chd\n\nDisc 2.chd\n"), ["Disc 1.chd", "Disc 2.chd"]);
});

test("base pack files map onto the SD card, RetroArch itself into /switch", () => {
  assert.equal(sdPathOf("retroarch.nro"), "switch/retroarch_switch.nro");
  assert.equal(sdPathOf("cores/mgba_libretro_libnx.nro"), "retroarch/cores/mgba_libretro_libnx.nro");
  assert.equal(sdPathOf("retroarch.cfg"), "retroarch/retroarch.cfg");
  assert.equal(sdPathOf("../evil"), null);
  assert.equal(sdPathOf(".DS_Store"), null);
});

test("bezel configs follow the Bezel Project layout and the 720p 4:3 viewport", () => {
  const systems = loadSystems("/nonexistent");
  const game = { system: "snes", rel: "Super Mario World (USA).sfc", name: "Super Mario World (USA)" };
  const paths = sdPaths(game, systems.snes);
  assert.equal(paths.rom, "roms/snes/Super Mario World (USA).sfc");
  assert.equal(paths.bezelPng, "retroarch/overlays/GameBezels/SNES/Super Mario World (USA).png");
  assert.equal(paths.gameCfg, "retroarch/config/Snes9x/Super Mario World (USA).cfg");
  const cfg = gameCfg(game, systems.snes);
  for (const line of ['aspect_ratio_index = "22"', 'custom_viewport_width = "960"', 'custom_viewport_height = "720"', 'custom_viewport_x = "160"', 'custom_viewport_y = "0"',
    'input_overlay = "/retroarch/overlays/GameBezels/SNES/Super Mario World (USA).cfg"']) assert.ok(cfg.includes(line), line);
  assert.match(overlayCfg(game), /overlay0_overlay = "Super Mario World \(USA\)\.png"/);
});

test("systems.json changes a core or adds a system", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "retro-sys-"));
  fs.writeFileSync(path.join(dir, "systems.json"), JSON.stringify({ snes: { core: "bsnes", coreName: "bsnes" }, msx: { extensions: ["rom"], core: "bluemsx", coreName: "blueMSX" }, "../x": {} }));
  const systems = loadSystems(dir);
  assert.equal(systems.snes.core, "bsnes");
  assert.equal(systems.snes.names.ko, "슈퍼 패미컴 (SNES)");
  assert.deepEqual(systems.msx.extensions, [".rom"]);
  assert.equal(systems["../x"], undefined);
});

test("the catalog lists games, folds disc tracks into their .cue, and finds art", async () => {
  const dir = fixture();
  const { games, present } = await scanDir(dir);
  assert.deepEqual([...present].sort(), ["gba", "ps1", "snes"]);
  assert.deepEqual(games.map((g) => g.name), ["Disc Game", "Chrono Trigger (USA)", "Super Mario World (USA)"]);
  const disc = games[0];
  assert.deepEqual(disc.extras.map((x) => x.rel), ["Disc Game/Disc Game (Track 1).bin"]);
  assert.equal(disc.size, fs.statSync(path.join(dir, "roms/ps1/Disc Game/Disc Game.cue")).size + 6);
  assert.equal(disc.bezel.generic, true);
  const smw = games.find((g) => g.name.startsWith("Super"));
  assert.equal(smw.id, gameId("snes", "Super Mario World (USA).sfc"));
  assert.ok(smw.icon.endsWith(".png"));
  assert.equal(smw.bezel.generic, false);
  assert.equal(games.find((g) => g.name.startsWith("Chrono")).bezel, null);
});

const PORT = 14900 + (process.pid % 500);
const BASE = `http://127.0.0.1:${PORT}`;
const AUTH = { Authorization: "Basic " + Buffer.from("alice:alice-password").toString("base64") };

async function boot(retroDir) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "retro-data-"));
  fs.mkdirSync(path.join(data, "games"));
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

const get = (url) => fetch(BASE + url, { headers: AUTH });

test("the retro API lists, pages, bundles and serves the base pack", async () => {
  const dir = fixture();
  const server = await boot(dir);
  try {
    assert.equal((await fetch(`${BASE}/api/retro/systems`)).status, 401, "behind the shop's sign-in");
    assert.ok((await (await get("/api/shop/info")).json()).features.includes("retro"));
    const { systems } = await (await get("/api/retro/systems")).json();
    const snes = systems.find((s) => s.id === "snes");
    assert.equal(snes.romCount, 2);
    assert.equal(snes.defaultCore, "snes9x");
    assert.equal(snes.names.ko, "슈퍼 패미컴 (SNES)");

    let page = await (await get("/api/retro/games?system=snes&pageSize=1&sort=name")).json();
    assert.equal(page.total, 2);
    assert.equal(page.games.length, 1);
    assert.equal(page.games[0].name, "Chrono Trigger (USA)");
    page = await (await get("/api/retro/games?search=mario")).json();
    const smw = page.games[0];
    assert.equal(page.total, 1);
    assert.equal(smw.forwarderUrl, null);
    assert.equal(smw.bezel.hasBezel, true);
    assert.equal(smw.install.gameCfg, "retroarch/config/Snes9x/Super Mario World (USA).cfg");
    assert.equal(await (await get(smw.romUrl)).text(), "SMW");
    assert.equal(await (await get(smw.iconUrl)).text(), "PNG");
    assert.match(await (await get(smw.bezel.gameCfgUrl)).text(), /custom_viewport_x = "160"/);
    const r = await fetch(BASE + smw.romUrl, { headers: { ...AUTH, Range: "bytes=1-2" } });
    assert.equal(r.status, 206);
    assert.equal(await r.text(), "MW");

    const bundle = untar(Buffer.from(await (await get(smw.bundleUrl)).arrayBuffer()));
    assert.equal(bundle.get("roms/snes/Super Mario World (USA).sfc"), "SMW");
    assert.equal(bundle.get("retroarch/overlays/GameBezels/SNES/Super Mario World (USA).png"), "BEZEL");
    assert.match(bundle.get("retroarch/overlays/GameBezels/SNES/Super Mario World (USA).cfg"), /overlay0_full_screen = true/);
    assert.match(bundle.get("retroarch/config/Snes9x/Super Mario World (USA).cfg"), /input_overlay_enable = "true"/);

    const disc = (await (await get("/api/retro/games?system=ps1")).json()).games[0];
    const discTar = untar(Buffer.from(await (await get(disc.bundleUrl)).arrayBuffer()));
    assert.equal(discTar.get("roms/ps1/Disc Game/Disc Game (Track 1).bin"), "TRACK1");
    assert.ok(![...discTar.keys()].some((k) => k.includes("escape")));

    assert.equal((await get("/api/retro/games/snes-0000000000/bundle")).status, 404);
    assert.equal((await get("/api/retro/games/..%2F..%2Fetc/rom")).status, 404);

    let manifest = await get("/api/retro/base-pack/manifest");
    for (let i = 0; manifest.status === 503 && i < 20; i++) {
      await new Promise((res) => setTimeout(res, 250));
      manifest = await get("/api/retro/base-pack/manifest");
    }
    const m = await manifest.json();
    assert.deepEqual(m.files.map((f) => f.path), ["retroarch/assets/fonts/korean.ttf", "retroarch/cores/snes9x_libretro_libnx.nro", "retroarch/retroarch.cfg", "switch/retroarch_switch.nro"]);
    assert.equal(m.files.find((f) => f.path === "retroarch/retroarch.cfg").once, true);
    assert.match(m.files[0].sha256, /^[0-9a-f]{64}$/);
    assert.equal(await (await get(m.files.at(-1).url)).text(), "NRO");
    assert.equal((await get("/api/retro/base-pack/file/retroarch/..%2F..%2Fetc%2Fpasswd")).status, 404);
    const pack = await get("/api/retro/base-pack");
    assert.equal(pack.headers.get("x-retro-once"), "retroarch/retroarch.cfg");
    assert.equal(untar(Buffer.from(await pack.arrayBuffer())).get("switch/retroarch_switch.nro"), "NRO");
  } finally {
    server.kill("SIGKILL");
  }
});

test("without a retro folder the API is off", async () => {
  const server = await boot(path.join(os.tmpdir(), "no-such-retro-dir-" + process.pid));
  try {
    assert.equal((await get("/api/retro/systems")).status, 404);
    assert.ok(!(await (await get("/api/shop/info")).json()).features.includes("retro"));
  } finally {
    server.kill("SIGKILL");
  }
});
