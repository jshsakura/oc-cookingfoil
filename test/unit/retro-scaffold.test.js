import { test, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import { DEFAULT_SYSTEMS, loadSystems, unreadFolders } from "../../src/retro/systems.js";
import * as catalog from "../../src/retro/catalog.js";
import * as scaffold from "../../src/retro/scaffold.js";
import { mountStorageGuideApi } from "../../src/routes/admin/storage-guide-api.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "retro-scaffold-"));
const isDir = (p) => fs.statSync(p, { throwIfNoEntry: false })?.isDirectory() === true;
const roms = (retro) => fs.readdirSync(path.join(retro, "roms")).sort();

/** A storage folder layout as storage-layout.js resolves it, every role inside `root`. */
function storageLayout(root) {
  const dirs = Object.fromEntries(["incoming", "games", "homebrew", "retro", "patches", "saves", "keys", "data"].map((r) => [r, path.join(root, r)]));
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  return { storage: true, root, dirs, from: Object.fromEntries(Object.keys(dirs).map((r) => [r, "storage"])) };
}

/** Separate mounts and no storage folder: each role somewhere of its own. */
function separateLayout(base) {
  const dirs = Object.fromEntries(["games", "homebrew", "retro", "patches", "saves", "keys", "data"].map((r) => [r, path.join(base, `mnt-${r}`)]));
  dirs.incoming = path.join(dirs.games, "incoming");
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  return { storage: false, root: null, dirs, from: Object.fromEntries(Object.keys(dirs).map((r) => [r, "legacy"])) };
}

const runOn = (layout, opts = {}) => scaffold.run({ retroDir: layout.dirs.retro, systems: loadSystems(layout.dirs.retro), layout, enabled: true, ...opts });

afterEach(() => {
  catalog.beforeScan(null);
  mock.restoreAll();
});

test("only systems whose core the Switch build of RetroArch has, or the pack holds, are runnable", () => {
  const ids = scaffold.runnableIds(DEFAULT_SYSTEMS);
  assert.ok(ids.includes("snes") && ids.includes("gba") && ids.includes("scummvm"));
  assert.ok(!ids.includes("a2600"), "stella is not in the official Switch bundle");
  assert.ok(scaffold.runnableIds(DEFAULT_SYSTEMS, new Set(["stella"])).includes("a2600"), "a core the operator added counts");
});

test("a folder is made for each runnable system and the BIOS folder, nothing for the others", async () => {
  const layout = storageLayout(tmp());
  const r = await runOn(layout);
  const want = scaffold.runnableIds(DEFAULT_SYSTEMS).map((id) => DEFAULT_SYSTEMS[id].folder).sort();
  assert.deepEqual(roms(layout.dirs.retro), want);
  assert.ok(!fs.existsSync(path.join(layout.dirs.retro, "roms", "Atari - 2600")));
  assert.ok(isDir(path.join(layout.dirs.retro, "retroarch", "system")));
  assert.equal(r.made.length, want.length + 1);
  const again = await runOn(layout);
  assert.deepEqual(again.made, [], "a second run makes nothing");
});

test("an alias folder means no canonical folder, and its files are left as they are", async () => {
  const layout = storageLayout(tmp());
  const snes = path.join(layout.dirs.retro, "roms", "SNES");
  fs.mkdirSync(snes, { recursive: true });
  fs.writeFileSync(path.join(snes, "Game.sfc"), "x");
  fs.mkdirSync(path.join(layout.dirs.retro, "roms", "Nintendo - Game Boy Advance"));
  await runOn(layout);
  const names = roms(layout.dirs.retro);
  assert.ok(!names.includes("snes") && !names.includes("gba"));
  assert.deepEqual(fs.readdirSync(snes), ["Game.sfc"]);
  assert.equal(loadSystems(layout.dirs.retro).snes.folder, "SNES", "the games are still read from the alias");
});

test("an older pack folder gets its BIOS folder there, so the pack is not switched to an empty retroarch/", async () => {
  const layout = storageLayout(tmp());
  fs.mkdirSync(path.join(layout.dirs.retro, "base-pack"));
  fs.writeFileSync(path.join(layout.dirs.retro, "base-pack", "retroarch.nro"), "x");
  await runOn(layout);
  assert.ok(isDir(path.join(layout.dirs.retro, "base-pack", "system")));
  assert.ok(!fs.existsSync(path.join(layout.dirs.retro, "retroarch")));
});

test("an alias folder copied in after the scaffold is read, with the game ids it had before the scaffold", async () => {
  const layout = storageLayout(tmp());
  const retro = layout.dirs.retro;
  const before = tmp();
  for (const [folder, file] of [["SNES", "Chrono Trigger.sfc"], ["psx", "Xenogears.chd"], ["genesis", "Sonic.md"]]) {
    fs.mkdirSync(path.join(before, "roms", folder), { recursive: true });
    fs.writeFileSync(path.join(before, "roms", folder, file), "x");
  }
  const want = (await catalog.scanDir(before)).games.map((g) => g.id).sort();
  await runOn(layout);
  fs.cpSync(path.join(before, "roms"), path.join(retro, "roms"), { recursive: true });
  const s = loadSystems(retro);
  assert.equal(s.snes.folder, "SNES");
  assert.equal(s.ps1.folder, "psx");
  assert.equal(s.md.folder, "genesis");
  assert.deepEqual(unreadFolders(retro, s), []);
  assert.deepEqual((await catalog.scanDir(retro)).games.map((g) => g.id).sort(), want);
  const again = await runOn(layout);
  assert.deepEqual(again.made, [], "the alias is the system's folder now; the empty snes stays as it is");
  assert.ok(isDir(path.join(retro, "roms", "snes")));
});

test("a missing retro folder is never made, by a run or by a catalog scan", async () => {
  const base = tmp();
  const layout = { storage: false, root: null, dirs: { data: path.join(base, "data"), retro: path.join(base, "nas", "retro") }, from: {} };
  fs.mkdirSync(layout.dirs.data);
  const r = await runOn(layout);
  assert.equal(r.skipped, "no-retro");
  assert.deepEqual(r.made, []);
  assert.equal(fs.existsSync(path.join(base, "nas")), false);
  catalog.beforeScan((dir, systems) => scaffold.run({ retroDir: dir, systems, layout, enabled: true }));
  await catalog.rescan(layout.dirs.retro);
  assert.equal(fs.existsSync(path.join(base, "nas")), false, "a sync with the mount gone writes nothing on the local disk");
});

test("a problem is handed out for logging once per path, however many runs see it", async () => {
  const layout = storageLayout(tmp());
  fs.mkdirSync(path.join(layout.dirs.retro, "roms"));
  fs.writeFileSync(path.join(layout.dirs.retro, "roms", "gba"), "not a folder");
  fs.symlinkSync(path.join(layout.root, "gone"), path.join(layout.dirs.retro, "roms", "snes"));
  const first = scaffold.freshProblems(layout.dirs.retro, await runOn(layout));
  assert.deepEqual(first.map((p) => path.basename(p.path)).sort(), ["gba", "snes"]);
  assert.ok(first.every((p) => p.error));
  assert.deepEqual(scaffold.freshProblems(layout.dirs.retro, await runOn(layout)), [], "the second run reports nothing new");
  assert.equal((await runOn(layout)).failed.length, 2, "the admin page still sees both");
});

test("the guide says how to stop a deleted folder from coming back", async () => {
  const r = await runOn(storageLayout(tmp()));
  assert.match(r.text, /deleted folder comes back[^\n]*retroScaffold/);
});

test("a file where a folder would go is reported, not replaced", async () => {
  const layout = storageLayout(tmp());
  fs.mkdirSync(path.join(layout.dirs.retro, "roms"));
  fs.writeFileSync(path.join(layout.dirs.retro, "roms", "gba"), "not a folder");
  const r = await runOn(layout);
  assert.equal(fs.readFileSync(path.join(layout.dirs.retro, "roms", "gba"), "utf8"), "not a folder");
  assert.ok(r.failed.some((f) => f.folder === "roms/gba"));
});

test("a deleted system folder comes back at the next catalog scan", async () => {
  const layout = storageLayout(tmp());
  catalog.beforeScan((dir, systems) => scaffold.run({ retroDir: dir, systems, layout, enabled: true }));
  await catalog.scan(layout.dirs.retro);
  const gba = path.join(layout.dirs.retro, "roms", "gba");
  assert.ok(isDir(gba));
  fs.rmdirSync(gba);
  await catalog.scan(layout.dirs.retro);
  assert.ok(isDir(gba));
  assert.equal(catalog.visibleSystems(await catalog.current(layout.dirs.retro)).length, 0, "empty folders show no system to clients");
});

test("turned off, nothing is made and no guide is written", async () => {
  const layout = storageLayout(tmp());
  const r = await runOn(layout, { enabled: false });
  assert.equal(fs.existsSync(path.join(layout.dirs.retro, "roms")), false);
  assert.equal(fs.existsSync(path.join(layout.root, scaffold.GUIDE_NAME)), false);
  assert.equal(r.enabled, false);
  assert.ok(r.text.includes("| Game Boy Advance |"), "the guide text is still there for the admin page");
});

test("nothing is made while the old data/retro still waits to be moved over", async () => {
  const layout = storageLayout(tmp());
  fs.mkdirSync(path.join(layout.dirs.data, "retro", "roms", "snes"), { recursive: true });
  const r = await runOn(layout);
  assert.equal(fs.readdirSync(layout.dirs.retro).length, 0);
  assert.equal(r.skipped, "old-retro");
});

test("the guide sits in the storage folder, lists each runnable system with its folder, extensions and BIOS", async () => {
  const layout = storageLayout(tmp());
  await runOn(layout);
  const text = fs.readFileSync(path.join(layout.root, "README.md"), "utf8");
  assert.match(text.split("\n")[0], /^<!-- cookingfoil-guide sha256=[0-9a-f]{16} /);
  assert.match(text, /\| Game Boy Advance \| gba \| `retro\/roms\/gba\/` \| \.gba \.zip \.7z \| none \|/);
  assert.match(text, /\| Sega CD \/ Mega-CD \| segacd \| `retro\/roms\/segacd\/` \|[^|]+\| one of `bios_CD_U\.bin`, `bios_CD_E\.bin`, `bios_CD_J\.bin` \|/);
  assert.match(text, /`retro\/retroarch\/system\/`/);
  assert.ok(!text.includes("Atari 2600"), "systems the Switch cannot run are left out");
  assert.ok(!text.includes("—"), "no em dashes");
});

test("with separate mounts the guide sits in the retro folder and names the other folders by their paths", async () => {
  const base = tmp();
  const layout = separateLayout(base);
  await runOn(layout);
  assert.ok(isDir(path.join(layout.dirs.retro, "roms", "snes")));
  const text = fs.readFileSync(path.join(layout.dirs.retro, "README.md"), "utf8");
  assert.ok(text.includes(`\`${layout.dirs.games}/\``));
  assert.match(text, /\| Super Nintendo \| snes \| `roms\/snes\/` \|/);
});

test("the guide is written again when the system list changes", async () => {
  const layout = storageLayout(tmp());
  const file = path.join(layout.root, "README.md");
  await runOn(layout);
  assert.ok(!fs.readFileSync(file, "utf8").includes("Atari 2600"));
  fs.mkdirSync(path.join(layout.dirs.retro, "retroarch", "cores"), { recursive: true });
  fs.writeFileSync(path.join(layout.dirs.retro, "retroarch", "cores", "stella_libretro_libnx.nro"), "x");
  const r = await runOn(layout);
  assert.equal(r.guide.state, "written");
  assert.ok(fs.readFileSync(file, "utf8").includes("| Atari 2600 |"));
  assert.ok(isDir(path.join(layout.dirs.retro, "roms", "Atari - 2600")));
  fs.rmSync(file);
  assert.equal((await runOn(layout)).guide.state, "written", "a deleted guide comes back");
  assert.equal((await runOn(layout)).guide.state, "current");
});

test("a guide the user edited, or a README of their own, is left alone", async () => {
  const layout = storageLayout(tmp());
  const file = path.join(layout.root, "README.md");
  await runOn(layout);
  const edited = fs.readFileSync(file, "utf8").replace("# CookingFoil storage", "# My server");
  fs.writeFileSync(file, edited);
  fs.mkdirSync(path.join(layout.dirs.retro, "retroarch", "cores"), { recursive: true });
  fs.writeFileSync(path.join(layout.dirs.retro, "retroarch", "cores", "stella_libretro_libnx.nro"), "x");
  assert.equal((await runOn(layout)).guide.state, "edited");
  assert.equal(fs.readFileSync(file, "utf8"), edited);
  fs.writeFileSync(file, "# notes of my own\n");
  assert.equal((await runOn(layout)).guide.state, "foreign");
  assert.equal(fs.readFileSync(file, "utf8"), "# notes of my own\n");
});

test("the guide in the retro folder is not read as a game or a system folder", async () => {
  const layout = separateLayout(tmp());
  await runOn(layout);
  assert.ok(fs.existsSync(path.join(layout.dirs.retro, "README.md")));
  const cat = await catalog.scanDir(layout.dirs.retro);
  assert.equal(cat.games.length, 0);
  assert.deepEqual(unreadFolders(layout.dirs.retro, cat.systems), []);
});

test("the admin endpoint serves the guide from memory, without touching the disk", async () => {
  const layout = storageLayout(tmp());
  await runOn(layout);
  const app = express();
  const router = express.Router();
  mountStorageGuideApi(router, () => true, { layout, retroDir: layout.dirs.retro });
  app.use("/admin", router);
  const server = app.listen(0);
  try {
    const port = server.address().port;
    const touched = [];
    for (const name of ["readFileSync", "statSync", "existsSync", "readdirSync", "mkdirSync", "writeFileSync"]) {
      mock.method(fs, name, (...a) => { touched.push(name); throw new Error(`disk read in a request: ${name} ${a[0]}`); });
    }
    for (const name of ["readFile", "stat", "readdir", "mkdir", "writeFile"]) {
      mock.method(fsp, name, async () => { touched.push(name); throw new Error(`disk read in a request: ${name}`); });
    }
    const md = await fetch(`http://127.0.0.1:${port}/admin/api/storage-guide`);
    assert.equal(md.status, 200);
    assert.match(md.headers.get("content-type"), /text\/markdown/);
    assert.ok((await md.text()).includes("| Game Boy Advance |"));
    const st = await (await fetch(`http://127.0.0.1:${port}/admin/api/storage-guide?format=json`)).json();
    assert.equal(st.guide.path, path.join(layout.root, "README.md"));
    assert.ok(st.folders.some((f) => f.folder === "gba" && f.made));
    mock.restoreAll();
    assert.deepEqual(touched, []);
  } finally {
    mock.restoreAll();
    server.close();
  }
});

test("the endpoint denies a request without an admin session", async () => {
  const app = express();
  const router = express.Router();
  mountStorageGuideApi(router, (req, res) => { res.status(401).json({ error: "2fa required" }); return false; }, { layout: storageLayout(tmp()), retroDir: "/nowhere" });
  app.use("/admin", router);
  const server = app.listen(0);
  try {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/admin/api/storage-guide`);
    assert.equal(r.status, 401);
  } finally {
    server.close();
  }
});
