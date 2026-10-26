import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import zlib from "node:zlib";
import os from "node:os";
import path from "node:path";
import { referencedFiles, gameId, scanDir } from "../../src/retro/catalog.js";
import { listPack, sdPathOf } from "../../src/retro/base-pack.js";
import { gameCfg, overlayCfg, sdPaths } from "../../src/retro/bezel-config.js";
import { loadSystems } from "../../src/retro/systems.js";
import sharp from "sharp";
import { CONSOLE, seedConsole } from "../support/console.js";

// A real, tall cover (like a SNES box), so the square drawing has something to fit.
const TALL_COVER = await sharp({ create: { width: 100, height: 140, channels: 3, background: "#c03030" } }).png().toBuffer();
// A bezel is a frame around a transparent screen: RetroArch draws it from the PNG on the SD card.
const BEZEL_PNG = await sharp({ create: { width: 64, height: 36, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: { create: { width: 8, height: 36, channels: 4, background: { r: 200, g: 40, b: 40, alpha: 1 } } }, left: 0, top: 0 }])
  .png().toBuffer();

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
  put(dir, "roms/snes/젤다의 전설 - 신들의 트라이포스 (Zelda no Densetsu) [K].sfc", "Z");
  put(dir, "art-map/snes.json", JSON.stringify({ "젤다의 전설 - 신들의 트라이포스 (Zelda no Densetsu) [K]": "Zelda no Densetsu - Kamigami no Triforce (Japan)" }));
  put(dir, "ratings.json", JSON.stringify({ snes: { "Chrono Trigger (USA)": { rating: 95, count: 40 }, "Super Mario World (USA)": { rating: 90, count: 80 }, "broken": { rating: 900 } } }));
  put(dir, "roms/nes/Contra (J).nes", "C2");
  // Folders that are not a system's own (an old alias here) are not read.
  put(dir, "roms/FC/Contra Force (U).nes", "CF");
  put(dir, "roms/Wii/Some Game.iso", "unsupported");
  put(dir, "roms/ps1/Disc Game/Disc Game.cue", 'FILE "Disc Game (Track 1).bin" BINARY\nFILE "../../escape.bin" BINARY\n');
  put(dir, "roms/ps1/Disc Game/Disc Game (Track 1).bin", "TRACK1");
  put(dir, "roms/gba/.hidden.gba", "x");
  put(dir, "thumbnails/snes/Named_Boxarts/Super Mario World (USA).png", TALL_COVER);
  put(dir, "bezels/snes/Super Mario World (USA).png", BEZEL_PNG);
  put(dir, "bezels/ps1/_default.png", "GENERIC");
  put(dir, "system-icons/color/snes.png", "COLOR");
  put(dir, "system-icons/mono/snes.png", "MONO");
  put(dir, "retroarch/retroarch.nro", "NRO");
  put(dir, "retroarch/retroarch.cfg", 'user_language = "14"\n');
  put(dir, "retroarch/cores/snes9x_libretro_libnx.nro", "CORE");
  put(dir, "retroarch/cores/mgba_libretro_libnx.nro", "GBA-CORE"); // gba has no listed game
  put(dir, "retroarch/assets/fonts/korean.ttf", "FONT");
  put(dir, "retroarch/.DS_Store", "junk");
  return dir;
}

test("disc lists name only files beside them", () => {
  assert.deepEqual(referencedFiles(".cue", 'FILE "a b.bin" BINARY\nFILE c.bin BINARY\nFILE "../x.bin" BINARY\nFILE "/abs.bin" BINARY'), ["a b.bin", "c.bin"]);
  assert.deepEqual(referencedFiles(".m3u", "#comment\nDisc 1.chd\n\nDisc 2.chd\n"), ["Disc 1.chd", "Disc 2.chd"]);
});

test("base pack files map onto the SD card, RetroArch itself into its homebrew folder", () => {
  assert.equal(sdPathOf("retroarch.nro"), "switch/retroarch_switch.nro");
  assert.equal(sdPathOf("cores/mgba_libretro_libnx.nro"), "retroarch/cores/mgba_libretro_libnx.nro");
  assert.equal(sdPathOf("retroarch.cfg"), "retroarch/retroarch.cfg");
  assert.equal(sdPathOf("../evil"), null);
  assert.equal(sdPathOf(".DS_Store"), null);
  assert.equal(sdPathOf("system/neocd_f.rom"), "retroarch/system/neocd/neocd_f.rom", "NeoCD looks in system/neocd/");
  assert.equal(sdPathOf("system/neocd/neocd_z.rom"), "retroarch/system/neocd/neocd_z.rom");
  assert.equal(sdPathOf("system/BS-X.bin"), "retroarch/system/BS-X.bin", "other firmware stays at the top");
  assert.equal(sdPathOf(".cookingfoil-trash/2026-10-22/core-0123456789/cores/x.nro"), null, "the pack's own trash never goes to the card");
  assert.equal(sdPathOf("cores/.cookingfoil-trash/2026-10-22/core-0123456789/x.nro"), null);
  assert.equal(sdPathOf("cores/.cookingfoil-partial-0123456789-x.nro"), null, "nor a copy a stop cut short");
});

test("the pack list leaves out a trash folder and a partial copy wherever they sit", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "retro-pack-trash-"));
  for (const rel of ["cores/a_libretro_libnx.nro", ".cookingfoil-trash/2026-10-22/core-0123456789/cores/old_libretro_libnx.nro", "retroarch/.cookingfoil-trash/2026-10-22/core-0123456789/cores/b.nro", "cores/.cookingfoil-partial-0123456789-c_libretro_libnx.nro", "cores/.cookingfoil-partial-0123456789.json"]) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), "x");
  }
  assert.deepEqual((await listPack(dir)).map((f) => f.path), ["retroarch/cores/a_libretro_libnx.nro"]);
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
  assert.ok(!cfg.includes("custom_viewport"), "no fixed pixel viewport: the console runs 720p handheld and 1080p docked");
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
  assert.deepEqual([...present].sort(), ["gba", "nes", "ps1", "snes"], "one short folder per system; Wii is not a RetroArch system here");
  assert.deepEqual(games.map((g) => g.name), ["Contra (J)", "Disc Game", "Chrono Trigger (USA)", "Super Mario World (USA)", "젤다의 전설 - 신들의 트라이포스 (Zelda no Densetsu) [K]"]);
  assert.ok(!games.some((g) => g.name === "Contra Force (U)"), "an alias folder is not read");
  const disc = games.find((g) => g.system === "ps1");
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
// An approved console: the shop takes its keys, never a password.
const AUTH = CONSOLE;

async function boot(retroDir, extraEnv = {}) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "retro-data-"));
  fs.mkdirSync(path.join(data, "games"));
  await seedConsole(data);
  const child = spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: { ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: data, COOK_GAMES_DIR: path.join(data, "games"), COOK_RETRO_DIR: retroDir,
      COOK_AUTH_USERS: "alice:alice-password", COOK_TITLEDB_AUTO_FETCH: "false", ...extraEnv },
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
    assert.ok((await (await get("/api/library/info")).json()).features.includes("retro"));
    const { systems, retroarch } = await (await get("/api/retro/systems")).json();
    const snes = systems.find((s) => s.id === "snes");
    assert.equal(retroarch, "installed");
    assert.deepEqual(snes.core, { id: "snes9x", state: "ready" }, "its core is in the pack");
    assert.deepEqual(systems.find((s) => s.id === "nes").core, { id: "fceumm", state: "core-missing" }, "a console whose core the pack lacks says so");
    assert.equal(snes.romCount, 3);
    assert.equal(systems.find((s) => s.id === "nes").romCount, 1, "only roms/nes is read");
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
    assert.deepEqual(rated.games.map((g) => [g.name, g.rating]), [["Chrono Trigger (USA)", 95], ["Super Mario World (USA)", 90], ["젤다의 전설 - 신들의 트라이포스 (Zelda no Densetsu)", undefined]]);
    assert.equal(rated.games[0].ratingCount, 40);
    // On the SD card every name is ASCII: the English title, tags gone; the tags stay as `variant`.
    const zelda = rated.games[2];
    assert.equal(zelda.variant, "K");
    assert.deepEqual(zelda.edition, { korean: true, source: "patch" }, "the tags as flags");
    assert.equal(zelda.region, "kr");
    assert.ok(!("edition" in rated.games[0]), "no flags for an untagged game");
    assert.equal(zelda.install.rom, "roms/snes/Zelda no Densetsu.sfc");
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
    assert.ok(!("forwarderUrl" in smw), "no shortcut package is offered");
    assert.equal(smw.bezel.hasBezel, true);
    // Which bezel each game installs with, the same in lists, home rows and a game's own reply.
    assert.equal(smw.bezel.kind, "game");
    const all = (await (await get("/api/retro/games?pageSize=200")).json()).games;
    const kinds = new Set(all.map((g) => g.bezel.kind));
    assert.ok(kinds.has("system") && kinds.has("none"), [...kinds].join(","));
    for (const g of all) assert.equal(g.bezel.kind, g.bezel.hasBezel ? (g.bezel.generic ? "system" : "game") : "none", g.name);
    assert.ok(home.systems.every((s) => s.games.every((g) => ["game", "system", "none"].includes(g.bezel.kind))));
    const own = await (await get(`/api/retro/games/${smw.id}`)).json();
    assert.equal(own.bezel.kind, "game");
    // Who made the bezel, worded in the request's language (the credit is additive: the other fields are unchanged).
    assert.equal(own.bezel.credit.name, "The Bezel Project");
    assert.match(own.bezel.credit.url, /^https:\/\/github\.com\//);
    assert.ok(own.bezel.credit.text.length > 10);
    assert.ok(all.filter((g) => g.bezel.kind === "none").every((g) => !("credit" in g.bezel)));
    assert.ok(own.variants.every((v) => ["game", "system", "none"].includes(v.bezel.kind)));
    const filtered = (await (await get("/api/retro/games?pageSize=200&bezel=1")).json()).games;
    assert.ok(filtered.length && filtered.every((g) => g.bezel.kind === "game"), "bezel=1 still means a game's own bezel");
    assert.equal(smw.install.gameCfg, "retroarch/config/Snes9x/Super Mario World (USA).cfg");
    assert.equal(await (await get(smw.romUrl)).text(), "SMW");
    // rom_hash: the content's MD5 once the background pass has read it; never for a disc game.
    let hashed = await (await get(`/api/retro/games/${smw.id}`)).json();
    for (let i = 0; i < 40 && !hashed.rom_hash; i++) {
      await new Promise((r) => setTimeout(r, 100));
      hashed = await (await get(`/api/retro/games/${smw.id}`)).json();
    }
    assert.equal(hashed.rom_hash, crypto.createHash("md5").update("SMW").digest("hex"));
    assert.equal(hashed.rom_size, 3);
    assert.equal(hashed.variants.find((v) => v.id === smw.id).rom_hash, hashed.rom_hash);
    const discGame = all.find((g) => g.system === "ps1");
    assert.equal(discGame.rom_hash, null);
    assert.ok(discGame.size > discGame.rom_size, "size counts the tracks, rom_size the .cue alone");
    const tile = await get(smw.iconUrl);
    assert.equal(tile.headers.get("content-type"), "image/webp", "WebP without asking");
    assert.doesNotMatch(tile.headers.get("vary") ?? "", /Accept/);
    const meta = await sharp(Buffer.from(await tile.arrayBuffer())).metadata();
    assert.deepEqual([meta.width, meta.height], [256, 256], "a square tile for the client, whatever the cover's shape");
    assert.match(smw.iconUrl, /\?v=[0-9a-f]{12}$/);
    assert.equal(tile.headers.get("cache-control"), "public, max-age=31536000, immutable", "a versioned tile is cached for good");
    assert.ok(tile.headers.get("etag"));
    const small = await sharp(Buffer.from(await (await get(`${smw.iconUrl}&size=sm`)).arrayBuffer())).metadata();
    assert.deepEqual([small.width, small.height], [160, 160]);
    assert.equal((await get(smw.iconUrl.replace(/\?v=.*/, "?v=stale"))).headers.get("cache-control"), "private, no-cache");
    assert.match(smw.boxartUrl, /\/boxart\?v=[0-9a-f]{12}$/);
    assert.equal(smw.boxartUrl.split("v=")[1], smw.iconUrl.split("v=")[1], "one cover, one key");
    const whole = await get(smw.boxartUrl);
    assert.equal(whole.headers.get("content-type"), "image/webp");
    assert.deepEqual(await sharp(Buffer.from(await whole.arrayBuffer())).metadata().then((m) => [m.format, m.width, m.height]), ["webp", 100, 140], "the whole cover, as WebP");
    assert.equal(whole.headers.get("cache-control"), "public, max-age=31536000, immutable");
    for (const accept of ["image/webp,image/*;q=0.8", "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8", "*/*"]) {
      const box = await fetch(`${BASE}${smw.boxartUrl}&size=md`, { headers: { ...AUTH, Accept: accept } });
      assert.equal(box.headers.get("content-type"), "image/webp", accept);
      assert.doesNotMatch(box.headers.get("vary") ?? "", /Accept/);
      assert.equal(box.headers.get("cache-control"), "public, max-age=31536000, immutable");
    }
    // The bezel goes onto the SD card for RetroArch's overlay: the PNG itself, its transparency whole.
    const bezel = await fetch(`${BASE}${smw.bezel.imageUrl}`, { headers: { ...AUTH, Accept: "image/webp,image/*;q=0.8" } });
    assert.equal(bezel.headers.get("content-type"), "image/png");
    const bezelBytes = Buffer.from(await bezel.arrayBuffer());
    assert.ok(bezelBytes.equals(BEZEL_PNG), "never re-encoded");
    const bezelMeta = await sharp(bezelBytes).metadata();
    assert.deepEqual([bezelMeta.format, bezelMeta.hasAlpha], ["png", true]);
    assert.equal((await get(smw.boxartUrl.replace(/\?v=.*/, ""))).headers.get("cache-control"), "private, no-cache", "unversioned: revalidated");
    assert.match(snes.iconUrl, /\/icon\?v=[0-9a-f]{12}$/);
    assert.match(snes.iconMonoUrl, /\/icon\?style=mono&v=[0-9a-f]{12}$/);
    assert.equal((await get(snes.iconUrl)).headers.get("cache-control"), "public, max-age=31536000, immutable");
    assert.equal((await get(snes.iconUrl.replace(/\?v=.*/, ""))).headers.get("cache-control"), "private, no-cache");
    assert.match(await (await get(smw.bezel.gameCfgUrl)).text(), /video_aspect_ratio_auto = "true"/);
    const r = await fetch(BASE + smw.romUrl, { headers: { ...AUTH, Range: "bytes=1-2" } });
    assert.equal(r.status, 206);
    assert.equal(await r.text(), "MW");

    const bundle = untar(Buffer.from(await (await get(smw.bundleUrl)).arrayBuffer()));
    assert.equal(bundle.get("roms/snes/Super Mario World (USA).sfc"), "SMW");
    assert.equal(bundle.get("retroarch/overlays/GameBezels/SNES/Super Mario World (USA).png"), BEZEL_PNG.toString("utf8"));
    assert.match(bundle.get("retroarch/overlays/GameBezels/SNES/Super Mario World (USA).cfg"), /overlay0_full_screen = true/);
    assert.match(bundle.get("retroarch/config/Snes9x/Super Mario World (USA).cfg"), /input_overlay_enable = "true"/);

    // Generated entries (overlay.cfg, game.cfg) carry a stable time: the bytes and the
    // ETag stay the same across seconds, so a resumed download matches.
    const first = await get(smw.bundleUrl);
    const firstBytes = Buffer.from(await first.arrayBuffer());
    await new Promise((res) => setTimeout(res, 1100));
    const again = await get(smw.bundleUrl);
    assert.equal(again.headers.get("etag"), first.headers.get("etag"), "the bundle's ETag does not follow the clock");
    assert.ok(Buffer.from(await again.arrayBuffer()).equals(firstBytes), "nor do its bytes");
    const resumed = await fetch(BASE + smw.bundleUrl, { headers: { ...AUTH, Range: "bytes=512-", "If-Range": first.headers.get("etag") } });
    assert.equal(resumed.status, 206, "If-Range with the earlier ETag resumes");
    assert.ok(Buffer.from(await resumed.arrayBuffer()).equals(firstBytes.subarray(512)));

    const disc = (await (await get("/api/retro/games?system=ps1")).json()).games[0];
    const discTar = untar(Buffer.from(await (await get(disc.bundleUrl)).arrayBuffer()));
    assert.equal(discTar.get("roms/ps1/Disc Game (Track 1).bin"), "TRACK1", "flat in the console folder");
    assert.match(discTar.get("roms/ps1/Disc Game.cue"), /^FILE "Disc Game \(Track 1\)\.bin" BINARY$/m, "the cue names the tracks as they land");
    assert.equal(disc.install.rom, "roms/ps1/Disc Game.cue");
    assert.ok(![...discTar.keys()].some((k) => k.includes("escape")));

    assert.equal((await get("/api/retro/games/snes-0000000000/bundle")).status, 404);
    assert.equal((await get("/api/retro/games/..%2F..%2Fetc/rom")).status, 404);

    let manifest = await get("/api/retro/base-pack/manifest");
    for (let i = 0; manifest.status === 503 && i < 20; i++) {
      await new Promise((res) => setTimeout(res, 250));
      manifest = await get("/api/retro/base-pack/manifest");
    }
    const m = await manifest.json();
    assert.deepEqual(m.files.map((f) => f.path), ["retroarch/assets/fonts/korean.ttf", "retroarch/cores/mgba_libretro_libnx.nro", "retroarch/cores/snes9x_libretro_libnx.nro", "retroarch/retroarch.cfg", "switch/retroarch_switch.nro"], "a client without cores=ondemand gets every file, the cores of consoles without games too");
    assert.ok(m.files.every((f) => !("core" in f) && !("onDemand" in f)), "and no on-demand marks");
    assert.equal(m.files.find((f) => f.path === "retroarch/retroarch.cfg").once, true);
    assert.match(m.files[0].sha256, /^[0-9a-f]{64}$/);
    assert.equal(await (await get(m.files.at(-1).url)).text(), "NRO");
    assert.equal((await get("/api/retro/base-pack/file/retroarch/..%2F..%2Fetc%2Fpasswd")).status, 404);
    assert.equal(m.bundleUrl, "/api/retro/base-pack/bundle");
    const pack = await get(m.bundleUrl);
    assert.equal(pack.headers.get("x-retro-once"), "retroarch/retroarch.cfg");
    assert.equal(Number(pack.headers.get("content-length")), m.bundleSize, "the manifest names the bundle's exact size");
    assert.equal(pack.headers.get("etag"), `"${m.version}"`);
    // A pack changed after the manifest was read gets an ETag of its own, not the stale version.
    const extra = path.join(dir, "retroarch/cores/extra_libretro_libnx.nro");
    fs.writeFileSync(extra, "EXTRA");
    const changed = await get(m.bundleUrl);
    assert.notEqual(changed.headers.get("etag"), `"${m.version}"`, "a stale manifest version never names other bytes");
    assert.ok(untar(Buffer.from(await changed.arrayBuffer())).has("retroarch/cores/extra_libretro_libnx.nro"), "the bundle without cores=ondemand has every file, as before");
    const onDemand = await (await get("/api/retro/base-pack/manifest?cores=ondemand")).json();
    assert.equal(onDemand.bundleUrl, "/api/retro/base-pack/bundle?cores=ondemand");
    fs.rmSync(extra);
    assert.equal(untar(Buffer.from(await pack.arrayBuffer())).get("switch/retroarch_switch.nro"), "NRO");
    assert.equal((await get("/api/retro/base-pack")).status, 200, "the older path still works");
  } finally {
    server.kill("SIGKILL");
  }
});

test("the retro index pages every version of every listed game by id, trimmed, and syncs by changes", async () => {
  const dir = fixture();
  // Enough games for a body worth gzipping (a small one goes as it is).
  for (let i = 0; i < 30; i++) put(dir, `roms/gb/Filler ${i} (USA).gb`, `GB${i}`);
  const server = await boot(dir);
  try {
    assert.equal((await fetch(`${BASE}/api/retro/index`)).status, 401, "behind the shop's sign-in");
    assert.ok((await (await get("/api/library/info")).json()).features.includes("retro-index"));
    const res = await get("/api/retro/index");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-encoding"), "gzip", "fetch takes gzip, not brotli");
    const first = await res.json();
    const { games } = first;
    assert.equal(first.page, 1);
    assert.equal(first.pageSize, 500);
    assert.equal(first.total, games.length);
    assert.match(first.version, /^[0-9a-f]{16}$/);
    assert.deepEqual(games.map((g) => g.id), games.map((g) => g.id).sort(), "ordered by id, so pages don't shift");

    const listed = (await (await get("/api/retro/games?pageSize=200")).json()).games;
    const systemOf = (id) => id.slice(0, id.lastIndexOf("-"));
    for (const r of listed) {
      const versions = games.filter((g) => systemOf(g.id) === r.system && (g.id === r.id || (g.group && r.group.endsWith(`~${g.group}`))));
      assert.ok(versions.some((g) => g.id === r.id), `${r.id} is in the index`);
      if (r.variants > 1) assert.equal(versions.filter((g) => g.representative).map((g) => g.id)[0], r.id, "the group shows the same version");
    }
    assert.equal(games.length, listed.reduce((n, r) => n + r.variants, 0), "every version of every listed game");

    // Paging: the same list, a page at a time, under the same version.
    const p1 = await (await get("/api/retro/index?pageSize=2&page=1")).json();
    const p2 = await (await get("/api/retro/index?pageSize=2&page=2")).json();
    assert.equal(p1.games.length, 2);
    assert.deepEqual([...p1.games, ...p2.games].map((g) => g.id), games.slice(0, 2 + p2.games.length).map((g) => g.id));
    assert.equal((await (await get("/api/retro/index?pageSize=9999")).json()).pageSize, 500, "500 a page at most");

    const zelda = games.find((g) => g.variant === "K");
    assert.equal(systemOf(zelda.id), "snes");
    assert.equal(zelda.original, "Zelda no Densetsu - Kamigami no Triforce (Japan)");
    assert.deepEqual(zelda.edition, { korean: true, source: "patch" });
    assert.equal(zelda.region, "kr");
    assert.equal(zelda.size, 1);
    const chrono = games.find((g) => g.name.startsWith("Chrono"));
    assert.equal(chrono.rating, 95);
    assert.equal(chrono.ratingCount, 40);
    const mario = games.find((g) => g.name.startsWith("Super Mario"));
    assert.equal(mario.ownBezel, true);
    assert.match(mario.icon, /^[0-9a-f]{12}$/, "the icon's v, not the whole URL");
    // Defaults and what the id says are left out; per-console and download fields never appear.
    for (const key of ["verified", "votes", "rom_size", "ownBezel", "group", "representative"]) assert.ok(!(key in chrono), `chrono leaves ${key} out`);
    for (const g of games) {
      for (const key of ["system", "my_vote", "romUrl", "bundleUrl", "install", "forwarderTitleId", "iconUrl", "file", "variants"]) assert.ok(!(key in g), `${g.id} has no ${key}`);
    }

    const gz = await new Promise((resolve, reject) => {
      http.get(`${BASE}/api/retro/index`, { headers: { ...AUTH, "Accept-Encoding": "gzip" } }, (r) => resolve(r.resume().headers["content-encoding"])).on("error", reject);
    });
    assert.equal(gz, "gzip", "a client without brotli gets gzip");
    const br = await new Promise((resolve, reject) => {
      http.get(`${BASE}/api/retro/index`, { headers: { ...AUTH, "Accept-Encoding": "gzip, deflate, br" } }, (r) => {
        const chunks = [];
        r.on("data", (c) => chunks.push(c)).on("end", () => resolve({ encoding: r.headers["content-encoding"], body: Buffer.concat(chunks) }));
      }).on("error", reject);
    });
    assert.equal(br.encoding, "br", "brotli first, whatever order the client lists");
    assert.ok(JSON.parse(zlib.brotliDecompressSync(br.body)).games.length > 0);

    // Without gzip asked for, plain JSON.
    const plain = await new Promise((resolve, reject) => {
      http.get(`${BASE}/api/retro/index`, { headers: AUTH }, (r) => {
        const chunks = [];
        r.on("data", (c) => chunks.push(c)).on("end", () => resolve({ encoding: r.headers["content-encoding"], body: Buffer.concat(chunks).toString() }));
      }).on("error", reject);
    });
    assert.equal(plain.encoding, undefined);
    assert.equal(JSON.parse(plain.body).total, games.length);

    // Unchanged, a page answers 304 to its ETag (fetch would add no-cache to a conditional request otherwise).
    // ROM hashes still being read change the body, so ask until it has settled.
    let etag = res.headers.get("etag");
    let again = null;
    for (let i = 0; i < 50; i++) {
      again = await fetch(`${BASE}/api/retro/index`, { headers: { ...AUTH, "If-None-Match": etag, "Cache-Control": "max-age=0" } });
      if (again.status === 304) break;
      etag = again.headers.get("etag");
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.equal(again.status, 304);
    assert.equal(res.headers.get("cache-control"), "private, max-age=0, must-revalidate");

    // Changes only: nothing since the current version; one vote later, that game alone.
    // First let every cartridge ROM get its hash, so nothing else changes meanwhile (discs never get one).
    let settled = null;
    for (let i = 0; i < 40; i++) {
      settled = await (await get("/api/retro/index")).json();
      if (settled.games.every((g) => g.rom_hash || systemOf(g.id) === "ps1")) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    assert.ok(settled.games.every((g) => g.rom_hash || systemOf(g.id) === "ps1"), "cartridge ROMs are hashed");
    const none = await (await get(`/api/retro/index?since=${settled.version}`)).json();
    assert.deepEqual(none, { version: settled.version, since: settled.version, changed: [], removed: [] });
    const voted = await fetch(`${BASE}/api/votes/retro/${chrono.id}`, { method: "POST", headers: { ...AUTH, "Content-Type": "application/json" }, body: JSON.stringify({ vote: "up" }) });
    assert.equal(voted.status, 200);
    await new Promise((r) => setTimeout(r, 3100));
    const after = await (await get(`/api/retro/index?since=${settled.version}`)).json();
    assert.notEqual(after.version, settled.version);
    assert.deepEqual(after.changed.map((g) => [g.id, g.votes]), [[chrono.id, { up: 1, down: 0 }]]);
    assert.deepEqual(after.removed, []);
    assert.deepEqual(await (await get("/api/retro/index?since=0000000000000000")).json(), { version: after.version, reset: true }, "a version it doesn't remember: page again");
  } finally {
    server.kill("SIGKILL");
  }
});

test("without a retro folder the API is off", async () => {
  const server = await boot(path.join(os.tmpdir(), "no-such-retro-dir-" + process.pid));
  try {
    assert.equal((await get("/api/retro/systems")).status, 404);
    assert.ok(!(await (await get("/api/library/info")).json()).features.includes("retro"));
  } finally {
    server.kill("SIGKILL");
  }
});

test("NDS, Neo Geo Pocket, WonderSwan, Saturn and the CD systems each have their own folder and core", () => {
  const systems = loadSystems("/nonexistent");
  for (const id of ["nds", "ngp", "ws", "saturn", "segacd", "pcecd"]) assert.equal(systems[id].folder, id);
  assert.equal(systems.nds.core, "melonds");
  assert.equal(systems.saturn.libretro, "Sega - Saturn");
  assert.ok(!("ps2" in systems), "no PS2 core for the console");
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

test("box art comes as WebP at the size the client shows or whole, never enlarged, and is dropped with its game", async () => {
  const { ensureBoxart, prewarm, artKey } = await import("../../src/retro/square-art.js");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "retro-boxart-"));
  const artDir = path.join(root, "art");
  const cover = path.join(root, "cover.png");
  fs.writeFileSync(cover, await sharp({ create: { width: 366, height: 512, channels: 3, background: "#30c030" } }).png().toBuffer());
  const game = { id: "snes-0123456789", icon: cover };
  const dims = async (file) => sharp(file).metadata().then((m) => [m.format, m.width, m.height]);
  assert.deepEqual(await dims(await ensureBoxart(artDir, game, "md")), ["webp", 183, 256], "fits within 256, keeps its shape");
  assert.deepEqual(await dims(await ensureBoxart(artDir, game, "sm")), ["webp", 114, 160]);
  assert.deepEqual(await dims(await ensureBoxart(artDir, game, "full")), ["webp", 366, 512], "whole, as WebP");
  assert.ok((await ensureBoxart(artDir, game, "md")).includes(artKey(game)), "named by the cover's key");
  // What an older server drew for clients without WebP is dropped at the next pass.
  const oldPng = path.join(artDir, "boxart", `${game.id}-${artKey(game)}.md.png`);
  fs.writeFileSync(oldPng, "old");
  await prewarm(artDir, [game]);
  assert.ok(!fs.existsSync(oldPng), "an old non-WebP box art variant is gone");
  assert.ok(fs.existsSync(await ensureBoxart(artDir, game, "md")));
  const tiny = { id: "snes-0000000001", icon: path.join(root, "tiny.png") };
  fs.writeFileSync(tiny.icon, TALL_COVER);
  assert.deepEqual(await dims(await ensureBoxart(artDir, tiny, "md")), ["webp", 100, 140], "a small cover is not enlarged");
  await prewarm(artDir, [tiny]);
  assert.deepEqual(fs.readdirSync(path.join(artDir, "boxart")).filter((f) => f.startsWith(game.id)), [], "a removed game's box art is dropped");
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
  const ps1 = "roms/ps1";
  put(dir, `${ps1}/MGS/메탈 기어 솔리드 (Metal Gear Solid - Integral) [K Disc 1].chd`, "D1");
  put(dir, `${ps1}/MGS/메탈 기어 솔리드 (Metal Gear Solid - Integral) [K Disc 2].chd`, "DISC2");
  put(dir, `${ps1}/MGS/메탈 기어 솔리드 (Metal Gear Solid - Integral) [K].PBP`, "PBP-ALL");
  put(dir, `${ps1}/Langrisser/랑그릿사 4 & 5 (Langrisser IV & V) [IV Disc].chd`, "IV");
  put(dir, `${ps1}/Langrisser/랑그릿사 4 & 5 (Langrisser IV & V) [V Disc].chd`, "V");
  put(dir, "roms/psp/QG/퀸즈 게이트 (Queen's Gate) [K].chd", "CHD");
  put(dir, "roms/psp/QG/퀸즈 게이트 (Queen's Gate) [Korea].cso", "CSO");
  put(dir, `thumbnails/ps1/Named_Boxarts/메탈 기어 솔리드 (Metal Gear Solid - Integral) [K Disc 1].png`, TALL_COVER);
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

test("the games list filters by rating, size and own bezel", async () => {
  const { listFilter } = await import("../../src/retro/list-filter.js");
  const games = [
    { name: "a", rating: 90, size: 100, bezel: { generic: false } },
    { name: "b", rating: 60, size: 5000, bezel: { generic: true } },
    { name: "c", size: 300, bezel: null },
  ];
  const names = (q) => games.filter(listFilter(q)).map((g) => g.name);
  assert.deepEqual(names({}), ["a", "b", "c"]);
  assert.deepEqual(names({ minRating: "70" }), ["a"], "unrated games fall below any minimum");
  assert.deepEqual(names({ minSize: "200", maxSize: "1000" }), ["c"]);
  assert.deepEqual(names({ bezel: "1" }), ["a"], "the console's default bezel doesn't count");
  assert.deepEqual(names({ minRating: "-5", maxSize: "big" }), ["a", "b", "c"], "malformed values are ignored");
});

test("each game names its HOME-menu shortcut, which the console builds itself", async () => {
  const dir = fixture();
  put(dir, "roms/snes/Super Mario World (Japan).sfc", "SMWJ");
  const server = await boot(dir);
  try {
    const smw = (await (await get("/api/retro/games?q=mario")).json()).games[0];
    // Two versions of one game: each HOME shortcut says which it is, and the reply carries that name.
    const names = await Promise.all((await (await get(`/api/retro/games/${smw.id}`)).json()).variants.map(async (v) => (await (await get(`/api/retro/games/${v.id}`)).json()).shortcutName));
    assert.deepEqual(names.sort(), ["Super Mario World · 북미", "Super Mario World · 일본"]);
    assert.equal((await (await get("/api/retro/games?q=chrono")).json()).games[0].shortcutName, "Chrono Trigger", "a lone version keeps its plain name");
    assert.match(smw.forwarderTitleId, /^05[0-9A-F]{11}000$/);
    const game = await (await get(`/api/retro/games/${smw.id}`)).json();
    assert.equal(game.forwarderTitleId, smw.forwarderTitleId);
    assert.ok(!("forwarderUrl" in game) && !("forwarderSize" in game), "no shortcut package is offered");
    assert.equal((await get(`/api/retro/games/${smw.id}/forwarder.nsp`)).status, 404, "the server packs nothing");
  } finally {
    server.kill("SIGKILL");
  }
});

test("a retro folder with no ROMs doesn't offer retro, so the client hides its menu", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "retro-empty-"));
  put(dir, "roms/snes/readme.txt", "no games yet");
  const server = await boot(dir);
  try {
    const info = await (await get("/api/library/info")).json();
    assert.ok(!info.features.includes("retro"));
    assert.ok(info.features.includes("item-names"), "the rest of the features stay");
  } finally {
    server.kill("SIGKILL");
  }
});

test("a NeoCD BIOS at the top of system/ is listed in system/neocd/, never over one already there", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "retro-pack-"));
  for (const [rel, body] of [["system/neocd_f.rom", "top"], ["system/neocd_z.rom", "top"], ["system/neocd/neocd_z.rom", "own"], ["system/BS-X.bin", "x"]]) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  const files = await listPack(dir);
  assert.deepEqual(files.map((f) => f.path), ["retroarch/system/BS-X.bin", "retroarch/system/neocd/neocd_f.rom", "retroarch/system/neocd/neocd_z.rom"]);
  assert.equal(files.find((f) => f.path.endsWith("neocd_z.rom")).abs, path.join(dir, "system/neocd/neocd_z.rom"));
});
