import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

// The patch information store lives in the data dir: a fresh one for this file.
process.env.COOK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "patches-data-"));
const { kindOf, readMeta, patchId, scanDir: scanRaw, scan, list, forTitle, countFor, requiredFor, koreanFor, locate, infoOf, openForDownload, reset, loadCache, hashed, withInfo } =
  await import("../../src/meta/user-patches.js");
const { splitPath, fitsUstar, header, archiveSize } = await import("../../src/helpers/ustar.js");
const { tarEntries } = await import("../../src/routes/patches.js");
// What a scan read, with each patch's information as it is served.
const scanDir = async (...args) => (await scanRaw(...args)).map((p) => withInfo(p));

const TID = "0100F2C0115B6000";
const CHEAT = `atmosphere/contents/${TID}/cheats/ABCDEF0123456789.txt`;

function makeRoot(layout) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patches-"));
  for (const [rel, body] of Object.entries(layout)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  }
  return root;
}

beforeEach(async () => {
  await hashed();
  reset();
});

test("files map to kinds only under the paths the game owns", () => {
  assert.equal(kindOf(CHEAT, TID), "cheats");
  assert.equal(kindOf(`atmosphere/contents/${TID.toLowerCase()}/romfs/a/b.bin`, TID), "romfs");
  assert.equal(kindOf(`atmosphere/contents/${TID}/exefs/main.npdm`, TID), "exefs");
  assert.equal(kindOf(`atmosphere/contents/${TID}/flags/boot2.flag`, TID), "");
  assert.equal(kindOf("atmosphere/exefs_patches/60fps/ABCD.ips", TID), "exefs_patches");
  assert.equal(kindOf(`SaltySD/plugins/FPSLocker/patches/${TID}/ABCD.bin`, TID), "fpslocker");
  assert.equal(kindOf("atmosphere/contents/0100000000010000/cheats/x.txt", TID), null);
  assert.equal(kindOf("atmosphere/exefs_patches/x.ips", TID), null);
  assert.equal(kindOf("switch/evil.nro", TID), null);
  // the game's own ids belong to it (sub program, update, add-on content); another game's do not
  const sub = TID.slice(0, 15) + "2";
  assert.equal(kindOf(`atmosphere/contents/${sub}/romfs/a.bin`, TID), "romfs");
  assert.equal(kindOf(`atmosphere/contents/${sub.toLowerCase()}/romfs.bin`, TID), "");
  assert.equal(kindOf("atmosphere/contents/0100F2C0115B6800/romfs/a.bin", TID), "romfs");
  assert.equal(kindOf("atmosphere/contents/0100F2C0115B7001/romfs/a.bin", TID), "romfs");
  assert.equal(kindOf("atmosphere/contents/0100F2C0115B8000/romfs/a.bin", TID), null);
  assert.equal(kindOf("atmosphere/contents/0100F2C0115B4001/romfs/a.bin", TID), null);
  assert.equal(kindOf(`atmosphere/contents/${TID.slice(0, 15)}/romfs/a.bin`, TID), null);
  assert.equal(kindOf(`atmosphere/contents/${TID}/../x`, TID), null);
});

test("patch.json fields are trimmed strings and anything else is dropped", () => {
  assert.deepEqual(readMeta({ name: " 60 FPS ", version: 1.2, author: {}, description: "" }), { name: "60 FPS", version: "1.2" });
  assert.deepEqual(readMeta({ name: "Data", required: true }), { name: "Data", required: true }, "a patch the game needs");
  assert.deepEqual(readMeta({ name: "Data", required: "true" }), { name: "Data" }, "only a real boolean");
  assert.deepEqual(readMeta({ name: "Data", update_version: 2097152 }), { name: "Data", update_version: 2097152 }, "the update it was made for");
  assert.deepEqual(readMeta({ name: "Data", update_version: "2097152" }), { name: "Data", update_version: 2097152 });
  for (const bad of [0, -65536, 1.5, "v2097152", 2 ** 40, null]) assert.equal(readMeta({ update_version: bad }).update_version, undefined, String(bad));
});

test("ids are url safe and stable for a folder name", () => {
  const id = patchId(TID, "60프레임");
  assert.match(id, /^[0-9A-F]{16}-[0-9a-f]{12}$/);
  assert.equal(id, patchId(TID, "60프레임".normalize("NFD")));
});

test("a valid patch is listed with its kinds, size and hash; patch.json never ships", async () => {
  const root = makeRoot({
    [`${TID}/치트 모음/${CHEAT}`]: "[inf hp]\n04000000 0 0\n",
    [`${TID}/치트 모음/patch.json`]: JSON.stringify({ name: "무한 체력", version: "1.0", game_version: "1.2.0" }),
    [`${TID}/치트 모음/.DS_Store`]: "x",
  });
  const [p] = await scanDir(root);
  assert.equal(p.name, "무한 체력");
  assert.deepEqual(p.kinds, ["cheats"]);
  assert.equal(p.files, 1);
  assert.equal(p.size, 22);
  assert.match(p.hash, /^[0-9a-f]{64}$/);
  assert.equal(p.game_version, "1.2.0");
  assert.equal(p.update_version, null, "no update named");
});

test("one stray file, a symlink or a non-base folder drops the patch", async () => {
  const root = makeRoot({
    [`${TID}/bad/${CHEAT}`]: "x",
    [`${TID}/bad/switch/evil.nro`]: "x",
    [`${TID}/linked/${CHEAT}`]: "x",
    [`0100F2C0115B6800/upd/${CHEAT}`]: "x",
    [`${TID}/ok/${CHEAT}`]: "x",
  });
  fs.symlinkSync("/etc/passwd", path.join(root, TID, "linked", "atmosphere", "contents", TID, "cheats", "p.txt"));
  const names = (await scanDir(root)).map((p) => p.name);
  assert.deepEqual(names, ["ok"]);
});

test("a patch with a file the console can't create is left out", async () => {
  const root = makeRoot({
    [`${TID}/korean/atmosphere/contents/${TID}/romfs/한글.bin`]: "x",
    [`${TID}/colon/atmosphere/contents/${TID}/romfs/a:b.bin`]: "x",
    [`${TID}/ok/atmosphere/contents/${TID}/romfs/Battle wild.ogg`]: "x",
  });
  assert.deepEqual((await scanDir(root)).map((p) => p.name), ["ok"], "a space inside a name is fine");
});

test("the listing, per-title view and count follow the scan", async () => {
  const root = makeRoot({ [`${TID}/a/${CHEAT}`]: "x", [`${TID}/b/${CHEAT}`]: "y" });
  let changed = 0;
  await scan({ root, onChange: () => changed++ });
  await scan({ root, onChange: () => changed++ });
  assert.equal(changed, 1);
  assert.equal(countFor(TID.toLowerCase()), 2);
  assert.equal(forTitle(TID).length, 2);
  assert.equal((await list()).length, 2);
  assert.equal("folder" in forTitle(TID)[0], false);
});

test("a game counts the patches marked required as the ones it does not start without", async () => {
  const patchInfo = await import("../../src/meta/patch-info.js");
  const root = makeRoot({ [`${TID}/a/${CHEAT}`]: "x", [`${TID}/b/${CHEAT}`]: "y" });
  await scan({ root });
  assert.equal(requiredFor(TID), 0);
  const [first] = await list();
  patchInfo.set(locate(first.id).key, { ...infoOf(first.id), required: true });
  assert.equal(requiredFor(TID.toLowerCase()), 1);
  assert.equal(countFor(TID), 2);
});

test("a game counts its Korean translations by folder or by the name given to it", async () => {
  const patchInfo = await import("../../src/meta/patch-info.js");
  const root = makeRoot({
    [`${TID}/한글패치/${CHEAT}`]: "x",
    [`${TID}/한국어 음성 패치/${CHEAT}`]: "y",
    [`${TID}/치트/${CHEAT}`]: "z",
    [`${TID}/fps/${CHEAT}`]: "w",
  });
  await scan({ root });
  assert.equal(koreanFor(TID.toLowerCase()), 2, "cheats and an fps lock are not translations");
  const fps = (await list()).find((p) => p.name === "fps");
  patchInfo.set(locate(fps.id).key, { ...infoOf(fps.id), ko: { name: "통합 모드 한글" } });
  assert.equal(koreanFor(TID), 3, "a Korean name the admin gave counts");
  assert.equal(koreanFor("0100000000001000"), 0);
});

test("ustar keeps long paths in the prefix field and refuses what cannot fit", () => {
  assert.equal(splitPath("a/b").prefix.length, 0);
  const long = "d".repeat(120) + "/" + "f".repeat(90);
  assert.equal(splitPath(long).prefix.toString(), "d".repeat(120));
  assert.equal(splitPath("d".repeat(160) + "/f"), null);
  assert.equal(fitsUstar("x/" + "f".repeat(101)), false);
  assert.equal(header({ path: "a.txt", size: 3 }).length, 512);
});

test("a download is a ustar archive tar can read, of exactly the announced size", async () => {
  const deep = `atmosphere/contents/${TID}/romfs/` + "long-folder-name/".repeat(10) + "data.bin";
  const root = makeRoot({ [`${TID}/한글/${CHEAT}`]: "cheat\n", [`${TID}/한글/${deep}`]: Buffer.alloc(700, 1) });
  await scan({ root });
  const [p] = await list();
  const opened = await openForDownload(p.id, root);
  const entries = tarEntries(opened.entries);
  const chunks = [];
  const { header: h, padding, TRAILER } = await import("../../src/helpers/ustar.js");
  for (const e of entries) {
    chunks.push(h(e));
    if (!e.dir) chunks.push(fs.readFileSync(e.abs), padding(e.size));
  }
  chunks.push(TRAILER);
  const tar = Buffer.concat(chunks);
  assert.equal(tar.length, archiveSize(entries));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "untar-"));
  execFileSync("tar", ["-xf", "-", "-C", out], { input: tar });
  assert.equal(fs.readFileSync(path.join(out, CHEAT), "utf8"), "cheat\n");
  assert.equal(fs.statSync(path.join(out, deep)).size, 700);
  assert.equal(fs.existsSync(path.join(out, "patch.json")), false);
});

test("an unknown or vanished patch cannot be downloaded", async () => {
  const root = makeRoot({ [`${TID}/a/${CHEAT}`]: "x" });
  await scan({ root });
  const [p] = await list();
  assert.equal(await openForDownload(`${TID}-000000000000`, root), null);
  fs.rmSync(path.join(root, TID, "a"), { recursive: true });
  assert.equal(await openForDownload(p.id, root), null);
});

function cacheRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patches-cache-"));
  const cacheFile = path.join(root, "..", path.basename(root) + ".json");
  const put = (rel, body) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  };
  return { root, cacheFile, put };
}
const BIG = "0100000000010000/Big/atmosphere/contents/0100000000010000/romfs/a.bin";
const SMALL = "0100000000020000/Small/atmosphere/contents/0100000000020000/cheats/0123456789ABCDEF.txt";

test("the listing and hashes survive a restart", async () => {
  const { root, cacheFile, put } = cacheRoot();
  put(BIG, "aaaa");
  put(SMALL, "[x]");
  await scan({ root, cacheFile });
  await hashed();
  const before = await list();
  assert.ok(before.every((p) => /^[0-9a-f]{64}$/.test(p.hash)));
  const saved = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
  assert.equal(saved.patches.length, 2);
  assert.equal(Object.keys(saved.hashes).length, 2);

  // A restart: nothing in memory, the saved listing answers at once.
  reset();
  assert.equal(loadCache(cacheFile), true);
  assert.deepEqual((await list({ root, cacheFile })).map((p) => p.hash), before.map((p) => p.hash));
  await hashed(); // the refresh list() started in the background
  assert.equal(loadCache(path.join(root, "missing.json")), false);
});

test("a patch still being hashed is listed at once and gets its hash afterwards", async () => {
  const { root, cacheFile, put } = cacheRoot();
  put(BIG, "aaaa");
  put(SMALL, "[x]");
  const first = await scan({ root, cacheFile });
  assert.equal(first.length, 2, "both patches are listed before any file is read");
  assert.ok(first.every((p) => p.hash === null));
  assert.equal("unhashed" in (await list())[0], false, "the internal mark never reaches a console");
  await hashed();
  assert.ok((await list()).every((p) => /^[0-9a-f]{64}$/.test(p.hash)));

  // A changed file: the patch keeps its old hash until it has been read again.
  const old = forTitle("0100000000010000")[0].hash;
  put(BIG, "bbbbbb");
  await scan({ root, cacheFile });
  assert.equal(forTitle("0100000000010000")[0].hash, old);
  await hashed();
  assert.notEqual(forTitle("0100000000010000")[0].hash, old);
});

test("a scan asked for while one runs reads what changed meanwhile", async () => {
  const { root, cacheFile, put } = cacheRoot();
  put(SMALL, "[x]");
  await scan({ root, cacheFile });
  const running = scan({ root, cacheFile });
  const asked = scan({ root, cacheFile });
  assert.notEqual(asked, running, "not the scan that started before the change");
  await running;
  put(SMALL.replace("/Small/", "/Second/"), "[y]");
  await asked;
  assert.deepEqual(forTitle("0100000000020000").map((p) => p.name), ["Second", "Small"]);
});

test("a download never waits for the patch to be hashed", async () => {
  const { root, cacheFile, put } = cacheRoot();
  put(BIG, "aaaa");
  await scan({ root, cacheFile });
  const id = forTitle("0100000000010000")[0].id;
  const early = await openForDownload(id, root);
  assert.equal(early.patch.hash, null, "sent at once, before its hash exists");
  assert.equal(early.entries.length, 1);
  await hashed();
  assert.match((await openForDownload(id, root)).patch.hash, /^[0-9a-f]{64}$/);
});

test("a renamed folder keeps its hashes, and a missing file's hash is kept for a week", async () => {
  const { root, cacheFile, put } = cacheRoot();
  put(BIG, "aaaa");
  put(SMALL, "[x]");
  await scan({ root, cacheFile });
  await hashed();
  const big = forTitle("0100000000010000")[0].hash;

  fs.renameSync(path.join(root, "0100000000010000", "Big"), path.join(root, "0100000000010000", "Renamed"));
  const moved = await scan({ root, cacheFile });
  assert.equal(moved.find((p) => p.folder === "Renamed").hash, big, "no file had to be read again");

  // Out of sight for a moment: the hash stays, so coming back costs nothing.
  fs.rmSync(path.join(root, "0100000000020000"), { recursive: true });
  await scan({ root, cacheFile });
  await hashed();
  const saved = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
  assert.equal(Object.keys(saved.hashes).length, 3, "the old path, the new one and the missing file");

  // A week later the ones still missing are forgotten.
  for (const [abs, entry] of Object.entries(saved.hashes)) if (!fs.existsSync(abs)) entry.seen = Date.now() - 8 * 24 * 3600_000;
  fs.writeFileSync(cacheFile, JSON.stringify(saved));
  reset();
  loadCache(cacheFile);
  put(`0100000000030000/New/atmosphere/contents/0100000000030000/cheats/0123456789ABCDEF.txt`, "[y]");
  await scan({ root, cacheFile });
  await hashed();
  assert.equal(Object.keys(JSON.parse(fs.readFileSync(cacheFile, "utf8")).hashes).length, 2);
});

test("a patch for a title nobody knows carries no game block", async () => {
  const { gameOf } = await import("../../src/routes/patches.js");
  assert.equal(gameOf("0100FFFFFFFF0000", "https://shop.example"), null);
});

test("a patch's metadata folder is not part of it: it is listed, shipped and hashed without it", async () => {
  const body = { [`${TID}/한글/${CHEAT}`]: "cheat\n" };
  const plain = makeRoot(body);
  const art = makeRoot({ ...body, [`${TID}/한글/metadata/icon.webp`]: "pic", [`${TID}/한글/metadata/banner.jpg`]: "pic", [`${TID}/한글/metadata/notes.txt`]: "x" });
  await scan({ root: plain });
  await hashed();
  const [a] = await list();
  reset();
  await scan({ root: art });
  await hashed();
  const [b] = await list();
  assert.ok(b, "a patch with pictures is listed, not rejected");
  assert.equal(b.files, 1);
  assert.equal(b.hash, a.hash);
  const opened = await openForDownload(b.id, art);
  assert.deepEqual(tarEntries(opened.entries).map((e) => e.path).filter((p) => !p.endsWith("/")), [CHEAT]);

  fs.writeFileSync(path.join(art, TID, "한글", "metadata", "icon.webp"), "another picture");
  reset();
  await scan({ root: art });
  await hashed();
  assert.ok(b.hash);
  assert.equal((await list())[0].hash, b.hash, "changing only a picture is not an update");
});

test("a picture-named file outside metadata/ is the patch's own content", async () => {
  const root = makeRoot({ [`${TID}/한글/${CHEAT}`]: "cheat\n", [`${TID}/한글/icon.jpg`]: "x" });
  await scan({ root });
  assert.equal((await list()).length, 0, "a game patch cannot ship a file at its root");
});

test("a homebrew app's patch ships everything but its metadata folder", async () => {
  const root = makeRoot({ "homebrew/game/mod/data.bin": "x", "homebrew/game/mod/icon.jpg": "the app's new icon", "homebrew/game/mod/metadata/banner.webp": "pic" });
  await scan({ root });
  const [p] = await list();
  assert.equal(p.files, 2);
  const opened = await openForDownload(p.id, root);
  assert.deepEqual(opened.entries.map((e) => e.path).sort(), ["switch/game/data.bin", "switch/game/icon.jpg"]);
});
