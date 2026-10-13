import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { DEFAULT_SYSTEMS, loadSystems } from "../../src/retro/systems.js";
import { gameId, scanDir } from "../../src/retro/catalog.js";
import { artKey } from "../../src/retro/square-art.js";
import { sdPaths } from "../../src/retro/bezel-config.js";
import * as art from "../../src/retro/art/sync.js";

const SNES = "Nintendo - Super Nintendo Entertainment System";
const COVER = await sharp({ create: { width: 10, height: 14, channels: 3, background: "#c03030" } }).png().toBuffer();
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "retro-folders-"));
function put(root, rel, body = "x") {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body);
}
/** Every file under root, relative, sorted. */
function files(root) {
  return fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.relative(root, path.join(e.parentPath, e.name)))
    .sort();
}
const dirs = (root, sub) => fs.readdirSync(path.join(root, sub)).sort();

test("every built-in system's folder is its id; the libretro name is a separate field", () => {
  for (const [id, s] of Object.entries(DEFAULT_SYSTEMS)) {
    assert.equal(s.folder, id, id);
    assert.ok(s.libretro && s.libretro !== id, `${id} has its own libretro name`);
    assert.ok(!("aliases" in s), "no alias folders");
  }
  const systems = loadSystems("/nonexistent");
  assert.equal(systems.snes.folder, "snes");
  assert.equal(systems.snes.libretro, SNES);
  assert.equal(systems.arcade.folder, "arcade");
  assert.equal(systems.arcade.libretro, "FBNeo - Arcade Games");
});

test("systems.json can rename a system's folder and its libretro name", () => {
  const dir = tmp();
  put(dir, "systems.json", JSON.stringify({
    snes: { folder: "Super Famicom", libretro: "Nintendo - Super Famicom" },
    gba: { folder: "../escape" },
    nes: { folder: "  " },
    msx: { extensions: ["rom"], core: "bluemsx" },
  }));
  const systems = loadSystems(dir);
  assert.equal(systems.snes.folder, "Super Famicom");
  assert.equal(systems.snes.libretro, "Nintendo - Super Famicom");
  assert.equal(systems.snes.core, "snes9x", "the rest stays");
  assert.equal(systems.gba.folder, "gba", "a path is not a folder name");
  assert.equal(systems.gba.libretro, "Nintendo - Game Boy Advance");
  assert.equal(systems.nes.folder, "nes");
  assert.equal(systems.msx.folder, "msx", "a new system's folder is its id");
});

test("libretro-thumbnails is found by the libretro name, never the folder", async () => {
  const dir = tmp();
  const own = { folder: "my-snes", libretro: SNES };
  const repo = "Nintendo_-_Super_Nintendo_Entertainment_System";
  assert.equal(art.libretroUrl(own, "Mega Man X (USA)"), `https://raw.githubusercontent.com/libretro-thumbnails/${repo}/master/Named_Boxarts/Mega%20Man%20X%20(USA).png`);
  assert.equal(art.boxartPath(dir, own, "x"), path.join(dir, "thumbnails", "my-snes", "Named_Boxarts", "x.png"));
  assert.equal(art.bezelPath(dir, own, "x"), path.join(dir, "bezels", "my-snes", "x.png"));

  const seen = [];
  const net = async (url) => {
    seen.push(String(url));
    if (String(url).endsWith("/git/trees/HEAD")) return Response.json({ tree: [{ path: "Named_Boxarts", sha: "x" }] });
    if (String(url).endsWith("/git/trees/x")) return Response.json({ tree: [{ path: "Mega Man X (USA).png" }] });
    return new Response(COVER);
  };
  await art.libretroNames("snes-folders-test", own, { fetchImpl: net });
  assert.ok(seen.every((u) => !u.includes("my-snes")));
  assert.ok(seen.some((u) => u.includes(`/libretro-thumbnails/${repo}/`)));

  globalThis.fetch = net;
  seen.length = 0;
  const jobs = art.jobsFor(dir, "psp", own, { "My Rom": "Mega Man X (USA)" }, false);
  for (const job of jobs) await job();
  assert.deepEqual(seen, [`https://raw.githubusercontent.com/libretro-thumbnails/${repo}/master/Named_Boxarts/Mega%20Man%20X%20(USA).png`]);
  assert.ok(fs.existsSync(path.join(dir, "thumbnails", "my-snes", "Named_Boxarts", "My Rom.png")));
});

test("a game's id comes from its system and its path in the folder, not the folder's name", async () => {
  const plain = tmp();
  put(plain, "roms/snes/Super Mario World (USA).sfc", "SMW");
  put(plain, "roms/snes/Sub/Chrono Trigger (USA).sfc", "CT");
  put(plain, "thumbnails/snes/Named_Boxarts/Super Mario World (USA).png", COVER);
  const renamed = tmp();
  put(renamed, "systems.json", JSON.stringify({ snes: { folder: "Super Famicom" } }));
  put(renamed, "roms/Super Famicom/Super Mario World (USA).sfc", "SMW");
  put(renamed, "roms/Super Famicom/Sub/Chrono Trigger (USA).sfc", "CT");
  // A folder that is not the system's is not read at all.
  put(renamed, "roms/snes/Stray (USA).sfc", "STRAY");

  const a = await scanDir(plain);
  const b = await scanDir(renamed);
  const ids = (r) => r.games.map((g) => [g.file, g.id]).sort();
  assert.deepEqual(ids(a), ids(b));
  assert.equal(a.games.find((g) => g.file === "Super Mario World (USA).sfc").id, gameId("snes", "Super Mario World (USA).sfc"));
  assert.ok(!b.games.some((g) => g.file === "Stray (USA).sfc"), "one folder per system");
  const smw = a.games.find((g) => g.file === "Super Mario World (USA).sfc");
  assert.equal(smw.icon, path.join(plain, "thumbnails/snes/Named_Boxarts/Super Mario World (USA).png"));
  assert.ok(artKey(smw));
  assert.equal(sdPaths(smw, a.systems.snes).rom, "roms/snes/Super Mario World (USA).sfc", "the card's paths follow the system id");
});
