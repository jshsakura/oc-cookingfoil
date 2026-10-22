import { test, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import { DEFAULT_SYSTEMS, loadSystems } from "../../src/retro/systems.js";
import { BIOS } from "../../src/retro/bios.js";
import { biosSets } from "../../src/retro/arcade.js";
import * as scaffold from "../../src/retro/scaffold.js";
import * as folderGuides from "../../src/helpers/folder-guides.js";
import { guideState } from "../../src/helpers/guide-file.js";
import { mountStorageGuideApi } from "../../src/routes/admin/storage-guide-api.js";
import { MANIFEST } from "../../src/meta/homebrew.js";

const ROLES = ["incoming", "games", "homebrew", "retro", "patches", "saves", "keys", "data"];
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "folder-guides-"));
const read = (p) => fs.readFileSync(p, "utf8");
const exists = (p) => fs.existsSync(p);

function storageLayout(root) {
  const dirs = Object.fromEntries(ROLES.map((r) => [r, path.join(root, r)]));
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  return { storage: true, root, dirs, from: Object.fromEntries(ROLES.map((r) => [r, "storage"])) };
}

const runOn = (layout, opts = {}) => scaffold.run({ retroDir: layout.dirs.retro, systems: loadSystems(layout.dirs.retro), layout, enabled: true, ...opts });
const guideOf = (dir) => path.join(dir, "README.md");
/** Every README.md under `root`, relative. */
const allGuides = (root) => fs.readdirSync(root, { recursive: true }).filter((p) => path.basename(p) === "README.md").sort();

afterEach(() => {
  mock.restoreAll();
  folderGuides.forget();
});

test("each role folder gets its own guide, the storage guide stays at the root", async () => {
  const layout = storageLayout(tmp());
  await runOn(layout);
  for (const role of ROLES) {
    const text = read(guideOf(layout.dirs[role]));
    assert.match(text.split("\n")[0], /^<!-- cookingfoil-guide sha256=[0-9a-f]{16} /, role);
    for (const h of ["## What goes here", "## Example", "## What the server does here", "## Do not put here", "## More"]) assert.ok(text.includes(h), `${role}: ${h}`);
    assert.ok(text.includes("`../README.md`"), `${role} points at the storage guide`);
  }
  assert.match(read(guideOf(layout.root)), /^<!-- cookingfoil-guide [^\n]*\n# CookingFoil storage/);
  assert.match(read(guideOf(layout.root)), /hold a README\.md of their own/);
});

test("every guide is short, has no em dash and is in English", () => {
  const layout = storageLayout(tmp());
  const all = folderGuides.plan({ layout, systems: DEFAULT_SYSTEMS, runnable: scaffold.runnableIds(DEFAULT_SYSTEMS), retroDir: layout.dirs.retro,
    biosDir: path.join(layout.dirs.retro, "retroarch", "system"), packDir: path.join(layout.dirs.retro, "retroarch"), storageGuide: guideOf(layout.root) });
  assert.ok(all.length > ROLES.length + Object.keys(DEFAULT_SYSTEMS).length);
  for (const g of all) {
    assert.ok(g.body.split("\n").length < 40, `${g.path}: ${g.body.split("\n").length} lines`);
    assert.ok(!/[—–]/.test(g.body), `${g.path} has a dash`);
    assert.ok(!/[가-힣]/.test(g.body), `${g.path} has Korean`);
  }
});

test("a system folder's guide comes from the system table: extensions, core file, BIOS and art paths", async () => {
  const layout = storageLayout(tmp());
  await runOn(layout);
  const roms = path.join(layout.dirs.retro, "roms");
  const gba = read(guideOf(path.join(roms, "gba")));
  assert.match(gba, /^# Game Boy Advance ROMs \(gba\)$/m);
  assert.ok(gba.includes(`ROM files: ${DEFAULT_SYSTEMS.gba.extensions.join(" ")}`));
  assert.ok(gba.includes("`mgba_libretro_libnx.nro` in `../../retroarch/cores/` (console: `sdmc:/retroarch/cores/mgba_libretro_libnx.nro`)"));
  assert.match(gba, /Switch \.nro built with libnx[^\n]*\.dll, \.so or \.dylib/);
  assert.ok(gba.includes("BIOS: none needed."));
  assert.ok(gba.includes("`thumbnails/gba/Named_Boxarts/<ROM name>.png`") && gba.includes("`bezels/gba/<ROM name>.png`"));
  assert.ok(gba.includes("`incoming/gba/`"));
  const segacd = read(guideOf(path.join(roms, "segacd")));
  for (const f of BIOS.segacd.groups[0]) assert.ok(segacd.includes(`\`../../retroarch/system/${f}\` (console: \`sdmc:/retroarch/system/${f}\`)`), f);
  assert.match(segacd, /BIOS, required: one of/);
  assert.match(segacd, /\(Disc 1\)/);
  const arcade = read(guideOf(path.join(roms, "arcade")));
  for (const b of biosSets()) assert.ok(arcade.includes(`${b}.zip`), b);
  assert.match(arcade, /\.zip loads [a-z0-9]+\.zip/);
  assert.ok(!arcade.includes("BIOS: none needed."));
  assert.match(read(guideOf(path.join(roms, "ScummVM"))), /\.scummvm/);
  assert.match(read(guideOf(roms)), /One folder per system/);
});

test("BIOS facts follow bios.js: optional groups and md5 show when a rule has them, and a NeoCD BIOS goes into neocd/", () => {
  const rules = { x: { groups: [["a.bin", { file: "b.bin", md5: "0123" }]], optional: [["opt.rom"]] }, y: { groups: [["neocd_z.rom"]] } };
  const x = folderGuides.biosFiles("x", rules);
  assert.deepEqual(x.required[0].map((f) => f.file), ["a.bin", "b.bin"]);
  assert.equal(x.required[0][1].md5, "0123");
  assert.deepEqual(x.optional[0].map((f) => f.file), ["opt.rom"]);
  assert.equal(folderGuides.biosFiles("y", rules).required[0][0].console, "sdmc:/retroarch/system/neocd/neocd_z.rom");
  assert.deepEqual(folderGuides.biosFiles("none", rules), null);
  assert.deepEqual(folderGuides.biosFiles("z", { z: { groups: [] } }), { required: [], optional: [] }, "missing fields are just empty");
});

test("the BIOS folder, thumbnails and bezels get guides; the BIOS guide lists every rule of bios.js", async () => {
  const layout = storageLayout(tmp());
  fs.mkdirSync(path.join(layout.dirs.retro, "thumbnails"));
  fs.mkdirSync(path.join(layout.dirs.retro, "bezels"));
  await runOn(layout);
  const bios = read(guideOf(path.join(layout.dirs.retro, "retroarch", "system")));
  for (const id of Object.keys(BIOS)) assert.ok(bios.includes(`(\`${id}\`)`), id);
  assert.match(read(guideOf(path.join(layout.dirs.retro, "thumbnails"))), /Named_Boxarts/);
  assert.match(read(guideOf(path.join(layout.dirs.retro, "bezels"))), /_default\.png/);
});

test("no folder is made to hold a guide: a missing mount stays missing", async () => {
  const base = tmp();
  const layout = storageLayout(base);
  fs.rmSync(layout.dirs.patches, { recursive: true });
  const r = await runOn(layout, { enabled: false });
  assert.equal(exists(layout.dirs.patches), false);
  assert.equal(exists(path.join(layout.dirs.retro, "roms")), false, "with retroScaffold off no system folder appears");
  assert.equal(exists(path.join(layout.dirs.retro, "thumbnails")), false);
  assert.ok(exists(guideOf(layout.dirs.games)), "folders that are there still get theirs");
  assert.ok(!r.folderGuides.some((g) => g.path.startsWith(layout.dirs.patches)));
  const gone = { ...layout, dirs: { ...layout.dirs, retro: path.join(base, "nas", "retro") } };
  await scaffold.writeRoleGuides({ systems: DEFAULT_SYSTEMS, layout: gone, retroDir: gone.dirs.retro });
  await runOn(gone);
  assert.equal(exists(path.join(base, "nas")), false);
});

test("with separate mounts the retro folder keeps the storage guide and gets no second one", async () => {
  const base = tmp();
  const dirs = Object.fromEntries(ROLES.filter((r) => r !== "incoming").map((r) => [r, path.join(base, `mnt-${r}`)]));
  dirs.incoming = path.join(dirs.games, "incoming");
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  const layout = { storage: false, root: null, dirs, from: {} };
  await runOn(layout);
  assert.match(read(guideOf(dirs.retro)), /# CookingFoil storage/);
  assert.ok(read(guideOf(dirs.games)).includes("`../mnt-retro/README.md`"), "the storage guide is named by where it is");
  assert.ok(exists(guideOf(dirs.incoming)));
});

test("a guide the user edited, or a README of their own, is never overwritten; a stale one is", async () => {
  const layout = storageLayout(tmp());
  await runOn(layout);
  const games = guideOf(layout.dirs.games);
  const edited = read(games).replace("# Switch games", "# My games");
  fs.writeFileSync(games, edited);
  const keys = guideOf(layout.dirs.keys);
  fs.writeFileSync(keys, "# mine\n");
  const gba = guideOf(path.join(layout.dirs.retro, "roms", "gba"));
  const stale = scaffold.stamp("# old text\n");
  fs.writeFileSync(gba, stale);
  const r = await runOn(layout);
  assert.equal(read(games), edited);
  assert.equal(read(keys), "# mine\n");
  assert.notEqual(read(gba), stale);
  const state = (p) => r.folderGuides.find((g) => g.path === p).state;
  assert.deepEqual([state(games), state(keys), state(gba)], ["edited", "foreign", "written"]);
  assert.equal(guideState(read(gba), read(gba).split("\n").slice(1).join("\n")), "current");
});

test("a second scan reads the guides and writes none: every mtime stays", async () => {
  const layout = storageLayout(tmp());
  fs.mkdirSync(path.join(layout.dirs.retro, "thumbnails"));
  await runOn(layout);
  const files = allGuides(layout.root).map((p) => path.join(layout.root, p));
  assert.ok(files.length > 40);
  const past = new Date(Date.now() - 3_600_000);
  for (const f of files) fs.utimesSync(f, past, past);
  const before = files.map((f) => fs.statSync(f).mtimeMs);
  const r = await runOn(layout);
  assert.ok(r.folderGuides.every((g) => g.state === "current"), JSON.stringify(r.folderGuides.filter((g) => g.state !== "current")));
  assert.deepEqual(files.map((f) => fs.statSync(f).mtimeMs), before);
  assert.deepEqual(fs.readdirSync(layout.dirs.games), ["README.md"], "no temporary file left behind");
});

test("turned off (folderGuides), no folder guide is written", async () => {
  const layout = storageLayout(tmp());
  const r = await runOn(layout, { guides: false });
  assert.deepEqual(r.folderGuides, []);
  assert.deepEqual(allGuides(layout.root), ["README.md"], "the storage guide follows retroScaffold alone");
  assert.ok(!read(guideOf(layout.root)).includes("of their own"));
});

test("the homebrew guide names the files the server writes there", () => {
  const layout = storageLayout(tmp());
  const g = folderGuides.plan({ layout, systems: DEFAULT_SYSTEMS, retroDir: layout.dirs.retro, biosDir: "/x/system", packDir: "/x", storageGuide: guideOf(layout.root), retro: false })
    .find((x) => x.path === guideOf(layout.dirs.homebrew));
  assert.ok(g.body.includes(`\`${MANIFEST}\``));
});

test("the endpoint returns every folder guide with its path and text, from memory", async () => {
  const layout = storageLayout(tmp());
  await runOn(layout);
  const app = express();
  const router = express.Router();
  mountStorageGuideApi(router, () => true, { layout, retroDir: layout.dirs.retro });
  app.use("/admin", router);
  const server = app.listen(0);
  try {
    for (const name of ["readFile", "stat", "readdir"]) mock.method(fsp, name, async () => { throw new Error(`disk read in a request: ${name}`); });
    for (const name of ["readFileSync", "statSync", "readdirSync", "existsSync"]) mock.method(fs, name, () => { throw new Error(`disk read in a request: ${name}`); });
    const body = await (await fetch(`http://127.0.0.1:${server.address().port}/admin/api/storage-guide?format=json`)).json();
    mock.restoreAll();
    const games = body.guides.find((g) => g.path === guideOf(layout.dirs.games));
    assert.equal(games.text, read(guideOf(layout.dirs.games)));
    assert.equal(games.state, "written");
    assert.ok(body.guides.some((g) => g.path === guideOf(path.join(layout.dirs.retro, "roms", "gba"))));
    assert.ok(body.folderGuides.length > 0);
  } finally {
    mock.restoreAll();
    server.close();
  }
});

test("before any write the endpoint lists every guide the server could write", async () => {
  const layout = storageLayout(tmp());
  const app = express();
  const router = express.Router();
  mountStorageGuideApi(router, () => true, { layout, retroDir: layout.dirs.retro });
  app.use("/admin", router);
  const server = app.listen(0);
  try {
    const body = await (await fetch(`http://127.0.0.1:${server.address().port}/admin/api/storage-guide?format=json`)).json();
    assert.ok(body.guides.some((g) => g.path === guideOf(layout.dirs.incoming) && g.state === null && g.text.includes("# Drop box")));
    assert.ok(body.guides.some((g) => g.path === guideOf(path.join(layout.dirs.retro, "roms", "snes"))));
  } finally {
    server.close();
  }
});
