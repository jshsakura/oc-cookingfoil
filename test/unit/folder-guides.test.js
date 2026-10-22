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
import * as catalog from "../../src/retro/catalog.js";
import * as scaffold from "../../src/retro/scaffold.js";
import * as folderGuides from "../../src/helpers/folder-guides.js";
import * as storageGuide from "../../src/helpers/storage-guide.js";
import { mountStorageGuideApi } from "../../src/routes/admin/storage-guide-api.js";
import { MANIFEST } from "../../src/meta/homebrew.js";

const ROLES = ["incoming", "games", "homebrew", "retro", "patches", "saves", "keys", "data"];
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "folder-guides-"));

function storageLayout(root) {
  const dirs = Object.fromEntries(ROLES.map((r) => [r, path.join(root, r)]));
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  return { storage: true, root, dirs, from: Object.fromEntries(ROLES.map((r) => [r, "storage"])) };
}

function separateLayout(base) {
  const dirs = Object.fromEntries(ROLES.filter((r) => r !== "incoming").map((r) => [r, path.join(base, `mnt-${r}`)]));
  dirs.incoming = path.join(dirs.games, "incoming");
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  return { storage: false, root: null, dirs, from: {} };
}

const runOn = (layout, opts = {}) => scaffold.run({ retroDir: layout.dirs.retro, systems: loadSystems(layout.dirs.retro), layout, enabled: true, ...opts });
const guidesOf = (layout, systems = DEFAULT_SYSTEMS) => folderGuides.folderGuides({
  layout, systems, runnable: scaffold.runnableIds(systems), retroDir: layout.dirs.retro, packDir: path.join(layout.dirs.retro, "retroarch"),
});
const byPath = (list, p) => list.find((g) => g.path === p);

/** Every file (not folder) under `root`, relative, with its size and mtime. */
function files(root) {
  return fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((e) => !e.isDirectory())
    .map((e) => {
      const abs = path.join(e.parentPath ?? e.path, e.name);
      const st = fs.lstatSync(abs);
      return `${path.relative(root, abs)} ${st.size} ${st.mtimeMs}`;
    })
    .sort();
}

afterEach(() => {
  catalog.beforeScan(null);
  mock.restoreAll();
});

function serve(layout) {
  const app = express();
  const router = express.Router();
  mountStorageGuideApi(router, () => true, { layout, retroDir: layout.dirs.retro });
  app.use("/admin", router);
  const server = app.listen(0);
  const url = (p) => `http://127.0.0.1:${server.address().port}/admin/api/storage-guide${p}`;
  return { server, url };
}

function noDisk() {
  for (const name of ["readFile", "stat", "readdir", "writeFile", "mkdir", "rename"]) mock.method(fsp, name, async () => { throw new Error(`disk in a request: ${name}`); });
  for (const name of ["readFileSync", "statSync", "readdirSync", "existsSync", "writeFileSync", "mkdirSync", "opendirSync"]) mock.method(fs, name, () => { throw new Error(`disk in a request: ${name}`); });
}

test("scaffold runs and catalog scans write no file into any folder, on either layout", async () => {
  for (const layout of [storageLayout(tmp()), separateLayout(tmp())]) {
    const top = layout.root ?? path.dirname(layout.dirs.games);
    fs.mkdirSync(path.join(layout.dirs.retro, "thumbnails"));
    fs.mkdirSync(path.join(layout.dirs.retro, "bezels"));
    fs.writeFileSync(path.join(layout.dirs.games, "Game [0100F2C0115B6000][v0].nsp"), "x");
    const before = files(top);
    await runOn(layout);
    catalog.beforeScan((dir, systems) => scaffold.run({ retroDir: dir, systems, layout, enabled: true }));
    await catalog.rescan(layout.dirs.retro);
    await runOn(layout);
    assert.deepEqual(files(top), before, "folders may appear, files never");
    assert.ok(fs.statSync(path.join(layout.dirs.retro, "roms", "gba")).isDirectory(), "folder making still runs");
    catalog.beforeScan(null);
  }
});

test("there is a guide for each role folder, retro/roms, every system folder, the BIOS folder, thumbnails and bezels", () => {
  const layout = storageLayout(tmp());
  const all = guidesOf(layout);
  const paths = all.map((g) => g.path);
  for (const role of ROLES) assert.ok(paths.includes(role), role);
  for (const s of Object.values(DEFAULT_SYSTEMS)) assert.ok(paths.includes(`retro/roms/${s.folder}`), s.folder);
  for (const p of ["retro/roms", "retro/retroarch/system", "retro/thumbnails", "retro/bezels"]) assert.ok(paths.includes(p), p);
  assert.equal(new Set(paths).size, paths.length, "no path twice");
  for (const g of all) {
    for (const k of ["path", "dir", "role", "title", "purpose", "accepts", "structure", "naming", "server", "doNotPut", "text"]) assert.ok(k in g, `${g.path}: ${k}`);
    assert.equal(g.dir, path.join(layout.root, ...g.path.split("/")), "on a storage layout the path is relative to the storage root");
    // The BIOS folder's guide has one line per system bios.js knows; the rest of it stays short like the others.
    const lines = g.text.split("\n").length - (g.role === "bios" ? g.bios.length : 0);
    assert.ok(lines < 45, `${g.path}: ${lines} lines`);
    assert.ok(!/[—–]/.test(g.text), `${g.path} has a dash`);
    assert.ok(!/[가-힣]/.test(g.text), `${g.path} has Korean`);
  }
});

test("with separate mounts a guide's path is its role path, and dir is where the folder is", () => {
  const layout = separateLayout(tmp());
  const all = guidesOf(layout);
  assert.equal(byPath(all, "incoming").dir, layout.dirs.incoming, "the drop box inside games is still incoming");
  assert.equal(byPath(all, "games").dir, layout.dirs.games);
  assert.equal(byPath(all, "retro/roms/snes").dir, path.join(layout.dirs.retro, "roms", "snes"));
});

test("a system folder's guide comes from the system table: extensions, core, BIOS and art paths", () => {
  const all = guidesOf(storageLayout(tmp()));
  const gba = byPath(all, "retro/roms/gba");
  assert.equal(gba.role, "system");
  assert.equal(gba.system, "gba");
  assert.deepEqual(gba.accepts, DEFAULT_SYSTEMS.gba.extensions);
  assert.deepEqual(gba.core, {
    file: "mgba_libretro_libnx.nro", folder: "retro/retroarch/cores", consolePath: "sdmc:/retroarch/cores/mgba_libretro_libnx.nro", note: folderGuides.CORE_NOTE,
  });
  assert.match(folderGuides.CORE_NOTE, /Switch \.nro built with libnx[^\n]*\.dll, \.so or \.dylib/);
  assert.deepEqual(gba.bios.required, [], "the GBA BIOS is optional");
  assert.deepEqual(gba.bios.optional.map((g) => g.map((f) => f.file)), [["gba_bios.bin"]]);
  assert.match(gba.title, /^Game Boy Advance ROMs \(gba\)$/);
  assert.ok(gba.text.includes("BIOS, optional: `retro/retroarch/system/gba_bios.bin`"), gba.text);
  assert.ok(gba.text.includes("`retro/thumbnails/gba/Named_Boxarts/<ROM name>.png`") && gba.text.includes("`retro/bezels/gba/<ROM name>.png`"));
  assert.ok(gba.text.includes("`incoming/gba/`"));
  const segacd = byPath(all, "retro/roms/segacd");
  assert.deepEqual(segacd.bios.required[0].map((f) => f.file), BIOS.segacd.groups[0]);
  for (const f of BIOS.segacd.groups[0]) assert.ok(segacd.text.includes(`\`retro/retroarch/system/${f}\` (console: \`sdmc:/retroarch/system/${f}\`)`), f);
  assert.match(segacd.text, /\(Disc 1\)/);
  const arcade = byPath(all, "retro/roms/arcade");
  assert.deepEqual(arcade.arcade.biosSets, biosSets().map((b) => `${b}.zip`));
  assert.ok(arcade.arcade.example.loads.length > 0);
  assert.match(arcade.text, /\.zip loads [a-z0-9]+\.zip/);
  assert.match(byPath(all, "retro/roms/ScummVM").text, /\.scummvm/);
  assert.match(byPath(all, "retro/roms").text, /One folder per system/);
});

test("the BIOS folder's guide lists every rule of bios.js and where it goes on the console", () => {
  const all = guidesOf(storageLayout(tmp()));
  const bios = byPath(all, "retro/retroarch/system");
  assert.equal(bios.consolePath, "sdmc:/retroarch/system/");
  for (const id of Object.keys(BIOS).filter((id) => DEFAULT_SYSTEMS[id])) {
    assert.ok(bios.bios.some((b) => b.system === id), id);
    assert.ok(bios.text.includes(`(\`${id}\`)`), id);
  }
  assert.match(byPath(all, "retro/thumbnails").text, /Named_Boxarts/);
  assert.match(byPath(all, "retro/bezels").text, /_default\.png/);
});

test("BIOS facts follow the real bios.js: every group of every system, and a NeoCD BIOS goes into neocd/", () => {
  for (const [id, rule] of Object.entries(BIOS)) {
    const b = folderGuides.biosFiles(id);
    const extra = rule.extra ?? [];
    assert.deepEqual(b.required.map((g) => g.map((f) => f.file)), rule.groups, id);
    assert.deepEqual(b.optional.map((g) => g.map((f) => f.file)), extra.filter((x) => !x.required).map((x) => x.files), `${id}: optional`);
    assert.deepEqual(b.forExt.map((g) => [g.ext, g.files.map((f) => f.file)]), extra.filter((x) => x.required && x.ext).map((x) => [x.ext, x.files]), `${id}: by extension`);
    for (const f of [...b.required.flat(), ...b.optional.flat()]) assert.equal(f.console, `sdmc:/retroarch/system/${f.file}`, `${id} ${f.file}`);
  }
  assert.ok(byPath(guidesOf(storageLayout(tmp())), "retro/roms/nes").text.includes("BIOS, required for .fds games: `retro/retroarch/system/disksys.rom`"), "the FDS BIOS is named with its games");
  assert.deepEqual(folderGuides.biosFiles("msx").required.map((g) => g.length), [1, 1], "two groups, each needed");
  assert.equal(folderGuides.biosFiles("segacd").required[0].length, 3, "one group met by any of three files");
  assert.ok(BIOS.neocd.groups[0].every((f) => f.startsWith("neocd/")));
  assert.equal(folderGuides.biosFiles("neocd").required[0][0].console, `sdmc:/retroarch/system/${BIOS.neocd.groups[0][0]}`);
  assert.equal(folderGuides.biosFiles("snes"), null, "a system bios.js does not list needs none");
  assert.ok(byPath(guidesOf(storageLayout(tmp())), "retro/roms/snes").text.includes("BIOS: none needed."));
});

test("the guides say deletes go to a trash only in the retro folder for now, from one constant", () => {
  const all = guidesOf(storageLayout(tmp()));
  assert.match(folderGuides.TRASH_NOTE, /only[^\n]*retro/);
  for (const p of ["retro", "retro/roms", "retro/roms/gba", "games"]) assert.ok(byPath(all, p).text.includes(folderGuides.TRASH_NOTE), p);
  const text = folderGuides.storageText({ systems: DEFAULT_SYSTEMS, runnable: scaffold.runnableIds(DEFAULT_SYSTEMS), layout: storageLayout(tmp()), retroDir: "/s/retro", packDir: "/s/retro/retroarch" });
  assert.ok(text.includes(folderGuides.TRASH_NOTE));
});

test("no guide tells anyone the server writes a README.md", () => {
  const layout = storageLayout(tmp());
  const texts = [...guidesOf(layout).map((g) => g.text), folderGuides.storageText({ systems: DEFAULT_SYSTEMS, runnable: [], layout, retroDir: layout.dirs.retro, packDir: path.join(layout.dirs.retro, "retroarch") })];
  for (const t of texts) {
    assert.ok(!/(writes|keeps|holds?) (a |this |its own )?README\.md/i.test(t), t.split("\n")[0]);
    assert.ok(!/cookingfoil-guide/.test(t));
  }
});

test("the homebrew guide names the files the server writes there and where apps go on the console", () => {
  const hb = byPath(guidesOf(storageLayout(tmp())), "homebrew");
  assert.ok(hb.text.includes(`\`${MANIFEST}\``));
  assert.equal(hb.consolePath, "sdmc:/switch/");
  assert.deepEqual(hb.accepts, [".nro"]);
});

test("a folder path is taken only in its plain relative form", () => {
  for (const bad of ["", "/games", "../games", "games/..", "retro/../games", "retro//roms", "retro\\roms", "./games", "games\0", "retro/./roms"]) {
    assert.equal(storageGuide.cleanPath(bad), null, JSON.stringify(bad));
  }
  assert.equal(storageGuide.cleanPath("retro/roms/gba/"), "retro/roms/gba", "a trailing slash is fine");
  assert.equal(storageGuide.cleanPath(["a", "b"]), null);
});

test("the endpoint returns every folder guide, and one folder by path, from memory", async () => {
  const layout = storageLayout(tmp());
  await runOn(layout);
  const { server, url } = serve(layout);
  try {
    noDisk();
    const all = await (await fetch(url("?format=json"))).json();
    const md = await fetch(url(""));
    const one = await fetch(url("/folder?path=retro/roms/gba"));
    const role = await fetch(url("/folder?path=games"));
    mock.restoreAll();
    assert.match(all.text, /# CookingFoil storage/);
    assert.ok(all.folders.some((f) => f.folder === "gba"), "the scan's fields are still there");
    assert.ok(Array.isArray(all.made) && Array.isArray(all.failed) && all.enabled === true);
    assert.equal("guide" in all, false, "no file, so no file state");
    assert.ok(all.guides.length > ROLES.length + Object.keys(DEFAULT_SYSTEMS).length);
    assert.ok(all.guides.every((g) => typeof g.text === "string" && !("state" in g)));
    assert.equal(md.status, 200);
    assert.match(md.headers.get("content-type"), /text\/markdown/);
    assert.equal(one.status, 200);
    const gba = (await one.json()).guide;
    assert.equal(gba.path, "retro/roms/gba");
    assert.equal(gba.core.file, "mgba_libretro_libnx.nro");
    assert.equal((await role.json()).guide.role, "games");
    assert.equal((await fetch(url("/folder?path=retro/roms/gba&format=md"))).headers.get("content-type").split(";")[0], "text/markdown");
  } finally {
    mock.restoreAll();
    server.close();
  }
});

test("the folder endpoint refuses a traversal and names the known paths for an unknown one", async () => {
  const layout = storageLayout(tmp());
  const { server, url } = serve(layout);
  try {
    for (const bad of ["../etc", "/etc/passwd", "retro/../../etc", "retro%2F..%2F..%2Fetc", ""]) {
      const r = await fetch(url(`/folder?path=${bad}`));
      assert.equal(r.status, 400, bad);
    }
    const r = await fetch(url("/folder?path=retro/roms/nope"));
    assert.equal(r.status, 404);
    const body = await r.json();
    assert.ok(body.known.includes("retro/roms/gba") && body.known.includes("incoming"));
    assert.equal((await fetch(url("/folder?path=a&path=b"))).status, 400, "one path only");
  } finally {
    server.close();
  }
});

test("the guides are computed once, not per request", async () => {
  const layout = storageLayout(tmp());
  const first = storageGuide.current({ layout, retroDir: layout.dirs.retro });
  assert.equal(storageGuide.current({ layout, retroDir: layout.dirs.retro }), first, "the same object: no recompute per request");
  assert.ok(first.guides.some((g) => g.path === "incoming" && g.text.includes("# Drop box")));
  assert.ok(first.guides.some((g) => g.path === "retro/roms/snes"));
});

test("a scan with another system list replaces the guides", async () => {
  const layout = storageLayout(tmp());
  await runOn(layout);
  const before = storageGuide.current({ layout, retroDir: layout.dirs.retro });
  assert.ok(!before.text.includes("| Atari 2600 |"));
  fs.mkdirSync(path.join(layout.dirs.retro, "retroarch", "cores"), { recursive: true });
  fs.writeFileSync(path.join(layout.dirs.retro, "retroarch", "cores", "stella_libretro_libnx.nro"), "x");
  await runOn(layout);
  const after = storageGuide.current({ layout, retroDir: layout.dirs.retro });
  assert.notEqual(after, before);
  assert.ok(after.text.includes("| Atari 2600 |"));
  assert.ok(after.guides.some((g) => g.path === "retro/roms/Atari - 2600" && !g.text.includes("no such core")));
});
