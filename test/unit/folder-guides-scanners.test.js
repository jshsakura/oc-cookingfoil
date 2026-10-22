// Every scanner over a folder the server keeps a guide in takes README.md for what it is: the server's
// guide, never a game, a ROM, a BIOS file, a patch, a save or a file to sort.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "guide-scanners-"));
process.env.COOK_DATA_DIR = path.join(root, "data");
process.env.COOK_GAMES_DIR = path.join(root, "games");
fs.mkdirSync(process.env.COOK_DATA_DIR, { recursive: true });
const { scanLibrary } = await import("../../src/create-index-content.js");
const catalog = await import("../../src/retro/catalog.js");
const { loadSystems, unreadFolders } = await import("../../src/retro/systems.js");
const { listFirmware } = await import("../../src/retro/bios.js");
const { sdPathOf } = await import("../../src/retro/base-pack.js");
const { createOrganizer } = await import("../../src/meta/library-organize.js");
const { createIdentifier } = await import("../../src/meta/file-identity.js");
const { createOtherScanner } = await import("../../src/meta/library-browse.js");
const { scanManual } = await import("../../src/meta/homebrew.js");
const patches = await import("../../src/meta/user-patches.js");
const saves = await import("../../src/meta/shop-saves.js");
const backup = await import("../../src/db/backup.js");
after(() => fs.rmSync(root, { recursive: true, force: true }));

const GUIDE = "<!-- cookingfoil-guide sha256=0000000000000000 x -->\n# guide\n";
const TID = "0100F2C0115B6000";
const dirOf = (name) => fs.mkdtempSync(path.join(root, `${name}-`));
function put(base, files) {
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true });
    fs.writeFileSync(path.join(base, rel), body);
  }
  return base;
}

test("retro catalog: a guide in a system folder is no game, not even in the Mega Drive folder (.md)", async () => {
  const retro = put(dirOf("retro"), { "roms/md/README.md": GUIDE, "roms/md/Sonic.md": "x", "roms/snes/README.md": GUIDE, "roms/README.md": GUIDE, "README.md": GUIDE });
  const cat = await catalog.scanDir(retro);
  assert.deepEqual(cat.games.map((g) => g.rel), ["Sonic.md"]);
  assert.deepEqual(unreadFolders(retro, cat.systems), []);
});

test("retro systems: a folder holding only its guide counts as empty, so a look-alike folder with games is read", () => {
  const retro = put(dirOf("retro"), { "roms/snes/README.md": GUIDE, "roms/SNES/Game.sfc": "x" });
  assert.equal(loadSystems(retro).snes.folder, "SNES");
});

test("BIOS folder: its guide is not listed as firmware and never goes to the console", async () => {
  const system = put(dirOf("system"), { "README.md": GUIDE, "bios_CD_U.bin": "x", "neocd/README.md": "user's" });
  assert.deepEqual((await listFirmware(system)).sort(), ["bios_CD_U.bin", "neocd/README.md"]);
  assert.equal(sdPathOf("system/README.md"), null);
  assert.equal(sdPathOf("system/bios_CD_U.bin"), "retroarch/system/bios_CD_U.bin");
});

test("drop box: its guide is neither moved nor reported, though .md looks like a Mega Drive ROM", async () => {
  const games = dirOf("lib");
  const incoming = put(path.join(games, "incoming"), { "README.md": GUIDE, "notes.md": "x" });
  const old = new Date(Date.now() - 600_000);
  for (const n of ["README.md", "notes.md"]) fs.utimesSync(path.join(incoming, n), old, old);
  const org = createOrganizer({
    incomingDir: incoming, romsDir: games, romsRels: async () => [],
    ...createIdentifier({ readIdentity: async () => null, readTicketNames: async () => [] }),
    nameOf: () => null, retroDir: path.join(games, "retro"), homebrewDir: path.join(games, "homebrew"),
    systems: () => loadSystems(path.join(games, "retro")), readRefs: async () => [],
    begin: () => ({ step() {}, done() {} }), rescan: () => {}, rescanRetro: () => {}, rescanHomebrew: () => {},
  });
  await org.sweep();
  assert.ok(fs.existsSync(path.join(incoming, "README.md")));
  assert.deepEqual(org.view().held.map((h) => h.rel), ["notes.md"], "another .md file is still reported");
});

test("library browse: the games folder's guide is not an other file", async () => {
  const games = put(dirOf("games"), { "README.md": GUIDE, "sub/notes.txt": "x", "sub/README.md": "user's" });
  const rels = (await createOtherScanner({ root: games }).list()).map((f) => f.rel).sort();
  assert.deepEqual(rels, ["sub/README.md", "sub/notes.txt"]);
});

test("shop scan: the games folder's guide is not a game", async () => {
  put(process.env.COOK_GAMES_DIR, { "README.md": GUIDE, [`Game/Game [${TID}][v0].nsp`]: "x", "Game/README.md": GUIDE });
  const { filesMap } = await scanLibrary();
  assert.deepEqual([...filesMap.keys()], [`Game/Game [${TID}][v0].nsp`]);
});

test("homebrew: the guide at the top is no app", async () => {
  const hb = put(dirOf("homebrew"), { "README.md": GUIDE, "App/App.nro": "x" });
  const apps = await scanManual(hb);
  assert.equal(apps.length <= 1, true);
  assert.ok(!apps.some((a) => /readme/i.test(JSON.stringify(a.name ?? a.folder ?? ""))));
});

test("patches and saves: the guide at the top is neither a patch nor a save", async () => {
  const p = put(dirOf("patches"), { "README.md": GUIDE, [`${TID}/cheat/atmosphere/contents/${TID}/cheats/0123456789ABCDEF.txt`]: "x" });
  assert.deepEqual((await patches.scanDir(p)).map((x) => x.folder), ["cheat"]);
  const s = put(dirOf("saves"), { "README.md": GUIDE, [`${TID}/All/save.dat`]: "x" });
  const cache = { hash: async () => "h", save() {} };
  assert.deepEqual((await saves.scanDir(s, cache)).map((x) => x.folder), ["All"]);
});

test("backups copy the data folder's .json files, so its guide stays out", () => {
  put(process.env.COOK_DATA_DIR, { "README.md": GUIDE, "settings.json": "{}" });
  backup.backupNow();
  const day = backup.list()[0].day;
  const copied = fs.readdirSync(path.join(process.env.COOK_DATA_DIR, backup.BACKUP_DIR, day), { recursive: true });
  assert.ok(copied.includes("settings.json"));
  assert.ok(!copied.includes("README.md"));
});
