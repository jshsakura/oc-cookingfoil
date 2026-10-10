import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { kindOf, readMeta, patchId, scanDir, scan, list, forTitle, countFor, openForDownload, reset } from "../../src/meta/user-patches.js";
import { splitPath, fitsUstar, header, archiveSize } from "../../src/helpers/ustar.js";
import { tarEntries } from "../../src/routes/patches.js";

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

beforeEach(() => reset());

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
  assert.equal(kindOf(`atmosphere/contents/${TID}/../x`, TID), null);
});

test("patch.json fields are trimmed strings and anything else is dropped", () => {
  assert.deepEqual(readMeta({ name: " 60 FPS ", version: 1.2, author: {}, description: "" }), { name: "60 FPS", version: "1.2" });
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

test("ustar keeps long paths in the prefix field and refuses what cannot fit", () => {
  assert.equal(splitPath("a/b").prefix.length, 0);
  const long = "d".repeat(120) + "/" + "f".repeat(90);
  assert.equal(splitPath(long).prefix.toString(), "d".repeat(120));
  assert.equal(splitPath("d".repeat(160) + "/f"), null);
  assert.equal(fitsUstar("x/" + "f".repeat(101)), false);
  assert.equal(header({ path: "a.txt", size: 3 }).length, 512);
});

test("a download is a ustar archive tar can read, of exactly the announced size", async () => {
  const deep = `atmosphere/contents/${TID}/romfs/` + "긴폴더이름/".repeat(10) + "data.bin";
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
