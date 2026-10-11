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
import sharp from "sharp";

// A real, tall cover (like a SNES box), so the square drawing has something to fit.
const TALL_COVER = await sharp({ create: { width: 100, height: 140, channels: 3, background: "#c03030" } }).png().toBuffer();

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
  put(dir, "roms/Nintendo - Super Nintendo Entertainment System/Super Mario World (USA).sfc", "SMW");
  put(dir, "roms/Nintendo - Super Nintendo Entertainment System/notes.txt", "not a game");
  put(dir, "roms/SFC/Chrono Trigger (USA).sfc", "CT");
  put(dir, "roms/SFC/젤다의 전설 - 신들의 트라이포스 (Zelda no Densetsu) [K].sfc", "Z");
  put(dir, "art-map/snes.json", JSON.stringify({ "젤다의 전설 - 신들의 트라이포스 (Zelda no Densetsu) [K]": "Zelda no Densetsu - Kamigami no Triforce (Japan)" }));
  put(dir, "ratings.json", JSON.stringify({ snes: { "Chrono Trigger (USA)": { rating: 95, count: 40 }, "Super Mario World (USA)": { rating: 90, count: 80 }, "broken": { rating: 900 } } }));
  put(dir, "roms/FC/Contra (J).nes", "C");
  put(dir, "roms/NES/Contra (J).nes", "C2");
  put(dir, "roms/Wii/Some Game.iso", "unsupported");
  put(dir, "roms/PS1/Disc Game/Disc Game.cue", 'FILE "Disc Game (Track 1).bin" BINARY\nFILE "../../escape.bin" BINARY\n');
  put(dir, "roms/PS1/Disc Game/Disc Game (Track 1).bin", "TRACK1");
  put(dir, "roms/gba/.hidden.gba", "x");
  put(dir, "thumbnails/Nintendo - Super Nintendo Entertainment System/Named_Boxarts/Super Mario World (USA).png", TALL_COVER);
  put(dir, "bezels/Nintendo - Super Nintendo Entertainment System/Super Mario World (USA).png", "BEZEL");
  put(dir, "bezels/Sony - PlayStation/_default.png", "GENERIC");
  put(dir, "system-icons/color/Nintendo - Super Nintendo Entertainment System.png", "COLOR");
  put(dir, "system-icons/mono/Nintendo - Super Nintendo Entertainment System.png", "MONO");
  put(dir, "retroarch/retroarch.nro", "NRO");
  put(dir, "retroarch/retroarch.cfg", 'user_language = "14"\n');
  put(dir, "retroarch/cores/snes9x_libretro_libnx.nro", "CORE");
  put(dir, "retroarch/assets/fonts/korean.ttf", "FONT");
  put(dir, "retroarch/.DS_Store", "junk");
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

test("bezel configs follow the Bezel Project layout and keep the core's aspect ratio", () => {
  const systems = loadSystems("/nonexistent");
  const game = { system: "snes", rel: "Super Mario World (USA).sfc", name: "Super Mario World (USA)" };
  const paths = sdPaths(game, systems.snes);
  assert.equal(paths.rom, "roms/snes/Super Mario World (USA).sfc");
  assert.equal(paths.bezelPng, "retroarch/overlays/GameBezels/SNES/Super Mario World (USA).png");
  assert.equal(paths.gameCfg, "retroarch/config/Snes9x/Super Mario World (USA).cfg");
  const cfg = gameCfg(game, systems.snes);
  for (const line of ['video_aspect_ratio_auto = "true"', 'input_overlay_enable = "true"',
    'input_overlay = "/retroarch/overlays/GameBezels/SNES/Super Mario World (USA).cfg"']) assert.ok(cfg.includes(line), line);
  assert.ok(!cfg.includes("custom_viewport"), "no fixed pixel viewport: the Switch is 720p handheld and 1080p docked");
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
  assert.deepEqual([...present].sort(), ["gba", "nes", "ps1", "snes"], "official names, short ids and aliases; Wii is not a RetroArch system here");
  assert.deepEqual(games.map((g) => g.name), ["Contra (J)", "Contra (J)", "Disc Game", "Chrono Trigger (USA)", "Super Mario World (USA)", "젤다의 전설 - 신들의 트라이포스 (Zelda no Densetsu) [K]"]);
  const contras = games.filter((g) => g.system === "nes");
  assert.notEqual(contras[0].id, contras[1].id, "FC and NES are read together without clashing ids");
  const disc = games.find((g) => g.system === "ps1");
  assert.deepEqual(disc.extras.map((x) => x.rel), ["Disc Game/Disc Game (Track 1).bin"]);
  assert.equal(disc.size, fs.statSync(path.join(dir, "roms/PS1/Disc Game/Disc Game.cue")).size + 6);
  assert.equal(disc.bezel.generic, true);
  const smw = games.find((g) => g.name.startsWith("Super"));
  assert.equal(smw.id, gameId("snes", "Nintendo - Super Nintendo Entertainment System/Super Mario World (USA).sfc"));
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
    assert.equal(snes.romCount, 3);
    assert.equal(systems.find((s) => s.id === "nes").romCount, 2);
    assert.equal(snes.defaultCore, "snes9x");
    assert.equal(snes.names.ko, "슈퍼 패미컴 (SNES)");
    assert.equal(await (await get(snes.iconUrl)).text(), "COLOR");
    assert.equal(await (await get(snes.iconMonoUrl)).text(), "MONO");
    assert.equal(systems.find((s) => s.id === "ps1").iconUrl, null, "no icon file, no URL");
    assert.equal((await get("/api/retro/systems/../../etc/icon")).status, 404);

    let page = await (await get("/api/retro/games?system=snes&pageSize=1&sort=name")).json();
    assert.equal(page.total, 3);
    assert.equal(page.games.length, 1);
    assert.equal(page.games[0].name, "Chrono Trigger (USA)");

    // Ratings: best first, the unrated last; the fields appear only when known.
    const rated = await (await get("/api/retro/games?system=snes&sort=rating")).json();
    assert.deepEqual(rated.games.map((g) => [g.name, g.rating]), [["Chrono Trigger (USA)", 95], ["Super Mario World (USA)", 90], ["젤다의 전설 - 신들의 트라이포스 (Zelda no Densetsu) [K]", undefined]]);
    assert.equal(rated.games[0].ratingCount, 40);
    assert.ok(!("rating" in rated.games[2]));

    // q matches the name, the original title and the file, ignoring case and spaces.
    for (const q of ["젤다", "트라이포스", "kamigami no", "KAMIGAMINO", "zeldanodensetsu"]) {
      const hit = await (await get(`/api/retro/games?q=${encodeURIComponent(q)}`)).json();
      assert.equal(hit.total, 1, q);
      assert.equal(hit.games[0].original, "Zelda no Densetsu - Kamigami no Triforce (Japan)");
    }

    // Home: every console with games, its best-rated few.
    const home = await (await get("/api/retro/home?limit=2")).json();
    const snesRow = home.systems.find((s) => s.id === "snes");
    assert.deepEqual(snesRow.games.map((g) => g.rating), [95, 90]);
    assert.ok(home.systems.every((s) => s.romCount > 0 && s.games.length <= 2));
    assert.ok(!home.systems.some((s) => s.id === "gg"), "consoles without games are left out");
    page = await (await get("/api/retro/games?search=mario")).json();
    const smw = page.games[0];
    assert.equal(page.total, 1);
    assert.equal(smw.forwarderUrl, null);
    assert.equal(smw.bezel.hasBezel, true);
    assert.equal(smw.install.gameCfg, "retroarch/config/Snes9x/Super Mario World (USA).cfg");
    assert.equal(await (await get(smw.romUrl)).text(), "SMW");
    const tile = await get(smw.iconUrl);
    assert.equal(tile.headers.get("content-type"), "image/jpeg");
    const meta = await sharp(Buffer.from(await tile.arrayBuffer())).metadata();
    assert.deepEqual([meta.width, meta.height], [256, 256], "a square tile for the Switch, whatever the cover's shape");
    assert.match(smw.iconUrl, /\?v=[0-9a-f]{12}$/);
    assert.equal(tile.headers.get("cache-control"), "public, max-age=31536000, immutable", "a versioned tile is cached for good");
    assert.ok(tile.headers.get("etag"));
    const small = await sharp(Buffer.from(await (await get(`${smw.iconUrl}&size=sm`)).arrayBuffer())).metadata();
    assert.deepEqual([small.width, small.height], [160, 160]);
    assert.equal((await get(smw.iconUrl.replace(/\?v=.*/, "?v=stale"))).headers.get("cache-control"), "private, no-cache");
    assert.ok(Buffer.from(await (await get(smw.boxartUrl)).arrayBuffer()).equals(TALL_COVER), "the cover itself stays available");
    assert.match(await (await get(smw.bezel.gameCfgUrl)).text(), /video_aspect_ratio_auto = "true"/);
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

test("NDS, Neo Geo Pocket, WonderSwan and Saturn folders are read under any of their names", async () => {
  const { systemForFolder } = await import("../../src/retro/systems.js");
  const systems = loadSystems("/nonexistent");
  assert.equal(systemForFolder(systems, "NDS"), "nds");
  assert.equal(systemForFolder(systems, "Nintendo - Nintendo DS"), "nds");
  assert.equal(systemForFolder(systems, "NGP"), "ngp");
  assert.equal(systemForFolder(systems, "WSC"), "ws");
  assert.equal(systemForFolder(systems, "SS"), "saturn");
  assert.equal(systemForFolder(systems, "Sega - Saturn"), "saturn");
  assert.equal(systemForFolder(systems, "PS2"), null, "no PS2 core on the Switch");
  assert.equal(systems.nds.core, "melonds");
  assert.equal(systemForFolder(systems, "Sega - Mega-CD - Sega CD"), "segacd");
  assert.equal(systemForFolder(systems, "PCECD"), "pcecd");
  assert.equal(systemForFolder(systems, "NEC - PC Engine CD - TurboGrafx-CD"), "pcecd");
  assert.ok(!systems.pce.extensions.includes(".chd"), "PC Engine CD discs live in their own system, with their own box art and bezels");
});

test("square tiles are drawn ahead of time, redrawn for a new cover, and dropped with their game", async () => {
  const { prewarm, squarePath } = await import("../../src/retro/square-art.js");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "retro-square-"));
  const artDir = path.join(root, "art");
  const cover = path.join(root, "cover.png");
  fs.writeFileSync(cover, TALL_COVER);
  const game = { id: "snes-0123456789", icon: cover };
  await prewarm(artDir, [game, { id: "snes-noart00000", icon: null }]);
  const first = squarePath(artDir, game);
  assert.ok(fs.existsSync(first));
  assert.deepEqual(fs.readdirSync(artDir).sort(), [path.basename(first), path.basename(squarePath(artDir, game, "sm"))].sort(), "both sizes, drawn ahead");

  fs.writeFileSync(cover, await sharp({ create: { width: 140, height: 100, channels: 3, background: "#3030c0" } }).png().toBuffer());
  fs.utimesSync(cover, new Date(), new Date(Date.now() + 5000));
  await prewarm(artDir, [game]);
  const second = squarePath(artDir, game);
  assert.notEqual(second, first, "a replaced cover gets a new square");
  assert.ok(!fs.readdirSync(artDir).some((f) => f.includes(path.basename(first, ".jpg"))), "the old squares are gone");

  await prewarm(artDir, []);
  assert.deepEqual(fs.readdirSync(artDir), [], "a removed game's square is dropped");
});

test("disc names fold to one title", async () => {
  const { discOf } = await import("../../src/retro/catalog.js");
  assert.deepEqual(discOf("메탈 기어 솔리드 (Metal Gear Solid - Integral) [K Disc 2]"), { key: "메탈 기어 솔리드 (Metal Gear Solid - Integral) [K]", n: 2 });
  assert.deepEqual(discOf("Xenogears KOR (Disc 1)"), { key: "Xenogears KOR", n: 1 });
  assert.deepEqual(discOf("폴리스노츠 (Policenauts) [Jap2Kor_v1.0 Disc 3]"), { key: "폴리스노츠 (Policenauts) [Jap2Kor_v1.0]", n: 3 });
  assert.equal(discOf("랑그릿사 4 & 5 [IV Disc]"), null, "a disc with no number is its own game");
});

test("multi-disc games become one entry with an .m3u, and one format per game is listed", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "retro-discs-"));
  const ps1 = "roms/Sony - PlayStation";
  put(dir, `${ps1}/MGS/메탈 기어 솔리드 (Metal Gear Solid - Integral) [K Disc 1].chd`, "D1");
  put(dir, `${ps1}/MGS/메탈 기어 솔리드 (Metal Gear Solid - Integral) [K Disc 2].chd`, "DISC2");
  put(dir, `${ps1}/MGS/메탈 기어 솔리드 (Metal Gear Solid - Integral) [K].PBP`, "PBP-ALL");
  put(dir, `${ps1}/Langrisser/랑그릿사 4 & 5 (Langrisser IV & V) [IV Disc].chd`, "IV");
  put(dir, `${ps1}/Langrisser/랑그릿사 4 & 5 (Langrisser IV & V) [V Disc].chd`, "V");
  put(dir, "roms/Sony - PlayStation Portable/QG/퀸즈 게이트 (Queen's Gate) [K].chd", "CHD");
  put(dir, "roms/Sony - PlayStation Portable/QG/퀸즈 게이트 (Queen's Gate) [Korea].cso", "CSO");
  put(dir, `thumbnails/Sony - PlayStation/Named_Boxarts/메탈 기어 솔리드 (Metal Gear Solid - Integral) [K Disc 1].png`, TALL_COVER);
  const { games } = await scanDir(dir);
  const names = games.map((g) => `${g.system}:${g.file}`).sort();
  assert.deepEqual(names, [
    "ps1:랑그릿사 4 & 5 (Langrisser IV & V) [IV Disc].chd",
    "ps1:랑그릿사 4 & 5 (Langrisser IV & V) [V Disc].chd",
    "ps1:메탈 기어 솔리드 (Metal Gear Solid - Integral) [K].m3u",
    "psp:퀸즈 게이트 (Queen's Gate) [K].chd",
  ], "discs fold, the CHD set beats the PBP, CHD beats CSO, different games of one format stay apart");
  const mgs = games.find((g) => g.file.endsWith(".m3u"));
  assert.equal(mgs.m3u, "메탈 기어 솔리드 (Metal Gear Solid - Integral) [K Disc 1].chd\n메탈 기어 솔리드 (Metal Gear Solid - Integral) [K Disc 2].chd\n");
  assert.equal(mgs.size, 7);
  assert.equal(mgs.extras.length, 2);
  assert.ok(mgs.icon, "the first disc's box art stands in for the set");
});
