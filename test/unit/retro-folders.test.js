import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { DEFAULT_SYSTEMS, loadSystems } from "../../src/retro/systems.js";
import { LEGACY_FOLDERS, migrateFolders } from "../../src/retro/folder-migration.js";
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
    assert.equal(s.libretro, LEGACY_FOLDERS[id][0], `${id} keeps the libretro name it used to read`);
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

/** A library laid out the old way, under the libretro names. */
function oldLibrary() {
  const dir = tmp();
  put(dir, `roms/${SNES}/Super Mario World (USA).sfc`, "SMW");
  put(dir, `roms/${SNES}/Sub/Chrono Trigger (USA).sfc`, "CT");
  put(dir, `thumbnails/${SNES}/Named_Boxarts/Super Mario World (USA).png`, COVER);
  put(dir, `bezels/${SNES}/Super Mario World (USA).png`, "BEZEL");
  put(dir, `bezels/${SNES}/_default.png`, "DEFAULT");
  put(dir, "roms/Sony - PlayStation/Game.chd", "CHD");
  put(dir, "roms/FBNeo - Arcade Games/sf2.zip", "SF2");
  put(dir, `system-icons/color/${SNES}.png`, "COLOR");
  put(dir, `system-icons/mono/${SNES}.png`, "MONO");
  put(dir, "art-map/snes.json", "{}");
  return dir;
}

test("a library under the libretro names moves into the short folders, and a second run does nothing", () => {
  const dir = oldLibrary();
  const before = files(dir).length;
  const report = migrateFolders(dir, loadSystems(dir));
  assert.deepEqual(dirs(dir, "roms"), ["arcade", "ps1", "snes"]);
  assert.deepEqual(dirs(dir, "thumbnails"), ["snes"]);
  assert.deepEqual(dirs(dir, "bezels"), ["snes"]);
  assert.deepEqual(dirs(dir, "system-icons/color"), ["snes.png"]);
  assert.ok(fs.existsSync(path.join(dir, "roms/snes/Sub/Chrono Trigger (USA).sfc")));
  assert.ok(fs.existsSync(path.join(dir, "thumbnails/snes/Named_Boxarts/Super Mario World (USA).png")));
  assert.ok(fs.existsSync(path.join(dir, "art-map/snes.json")), "art-map is keyed by id and stays");
  assert.equal(report.conflicts.length, 0);
  assert.equal(files(dir).length, before, "nothing lost");

  const again = migrateFolders(dir, loadSystems(dir));
  assert.deepEqual(again, { renamed: [], merged: [], conflicts: [], failed: [] });
});

test("alias folders (FC, PS1, …) move into the short folder, whatever their case", () => {
  const dir = tmp();
  put(dir, "roms/FC/Contra (J).nes", "C");
  put(dir, "roms/PS1/Game.chd", "D");
  put(dir, "roms/WSC/Game.wsc", "W");
  put(dir, "roms/SS/Game.chd", "S");
  put(dir, "roms/PS2/Game.iso", "not ours");
  put(dir, "thumbnails/SFC/Named_Boxarts/x.png", "X");
  migrateFolders(dir, loadSystems(dir));
  assert.deepEqual(dirs(dir, "roms"), ["PS2", "nes", "ps1", "saturn", "ws"], "an unknown folder is left alone");
  assert.deepEqual(dirs(dir, "thumbnails"), ["snes"]);
});

test("old and new folders side by side merge without loss; a taken name stays behind, and only the new folder is read", async () => {
  const dir = tmp();
  put(dir, "roms/nes/Contra (J).nes", "NEW");
  put(dir, "roms/nes/Zelda.nes", "Z");
  put(dir, "roms/FC/Contra (J).nes", "OLD");
  put(dir, "roms/FC/Mario.nes", "M");
  put(dir, `roms/Nintendo - Nintendo Entertainment System/Metroid.nes`, "MET");
  put(dir, "thumbnails/nes/Named_Boxarts/Zelda.png", "Z");
  put(dir, "thumbnails/FC/Named_Boxarts/Mario.png", "M");
  const before = files(dir).length;
  const report = migrateFolders(dir, loadSystems(dir));
  assert.equal(files(dir).length, before, "nothing deleted");
  assert.deepEqual(dirs(dir, "roms"), ["FC", "nes"]);
  assert.deepEqual(fs.readdirSync(path.join(dir, "roms/nes")).sort(), ["Contra (J).nes", "Mario.nes", "Metroid.nes", "Zelda.nes"]);
  assert.equal(fs.readFileSync(path.join(dir, "roms/nes/Contra (J).nes"), "utf8"), "NEW", "the file already in place wins");
  assert.deepEqual(fs.readdirSync(path.join(dir, "roms/FC")), ["Contra (J).nes"], "the clash stays where it was");
  assert.deepEqual(report.conflicts.map((c) => path.relative(dir, c.from)), ["roms/FC/Contra (J).nes"]);
  assert.deepEqual(dirs(dir, "thumbnails"), ["nes"], "merged folders on both sides, the empty old one removed");
  assert.deepEqual(fs.readdirSync(path.join(dir, "thumbnails/nes/Named_Boxarts")).sort(), ["Mario.png", "Zelda.png"]);

  const { games } = await scanDir(dir);
  assert.deepEqual(games.map((g) => g.file).sort(), ["Contra (J).nes", "Mario.nes", "Metroid.nes", "Zelda.nes"], "one system, one folder");
  assert.ok(games.every((g) => g.abs.startsWith(path.join(dir, "roms", "nes") + path.sep)));
});

test("the move goes to the operator's folder when systems.json names one", async () => {
  const dir = oldLibrary();
  put(dir, "systems.json", JSON.stringify({ snes: { folder: "Super Famicom" }, nes: { aliases: ["My NES"] } }));
  put(dir, "roms/My NES/Contra.nes", "C");
  migrateFolders(dir, loadSystems(dir), { nes: ["My NES"] });
  assert.deepEqual(dirs(dir, "roms"), ["Super Famicom", "arcade", "nes", "ps1"]);
  assert.deepEqual(dirs(dir, "thumbnails"), ["Super Famicom"]);
  assert.deepEqual(dirs(dir, "system-icons/mono"), ["Super Famicom.png"]);
  const { games } = await scanDir(dir);
  assert.ok(games.some((g) => g.system === "nes" && g.file === "Contra.nes"), "the operator's own old aliases move too");
});

test("game ids, box art keys and SD paths are the same before and after the move", async () => {
  const dir = oldLibrary();
  const oldCover = path.join(dir, `thumbnails/${SNES}/Named_Boxarts/Super Mario World (USA).png`);
  const keyBefore = artKey({ icon: oldCover });
  const { games, systems } = await scanDir(dir); // moves first, then reads
  assert.ok(fs.existsSync(path.join(dir, "roms/snes")));

  const smw = games.find((g) => g.file === "Super Mario World (USA).sfc");
  // The id formula before the move: system, then the path under roms/ as it was.
  assert.equal(smw.id, gameId("snes", `${SNES}/Super Mario World (USA).sfc`));
  assert.equal(games.find((g) => g.file === "Chrono Trigger (USA).sfc").id, gameId("snes", `${SNES}/Sub/Chrono Trigger (USA).sfc`));
  assert.equal(games.find((g) => g.system === "ps1").id, gameId("ps1", "Sony - PlayStation/Game.chd"));
  assert.equal(games.find((g) => g.system === "arcade").id, gameId("arcade", "FBNeo - Arcade Games/sf2.zip"));
  assert.equal(smw.icon, path.join(dir, "thumbnails/snes/Named_Boxarts/Super Mario World (USA).png"));
  assert.equal(artKey(smw), keyBefore, "squares and forwarders made before the move stay current");
  assert.equal(sdPaths(smw, systems.snes).rom, "roms/snes/Super Mario World (USA).sfc", "the card's paths never used the server folder");
  assert.equal(smw.bezel.png, path.join(dir, "bezels/snes/Super Mario World (USA).png"));
});
