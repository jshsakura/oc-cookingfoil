import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The admin file browser works on folders under the library roots. Whatever
// path it is handed, it never reads or writes outside the root, never shows the
// server's own dot folders, never overwrites, and a delete always goes to the trash.
const { createFileRoots, FileError } = await import("../../src/library/file-roots.js");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "file-roots-"));
let n = 0;
function setup() {
  const base = path.join(tmp, `s${n++}`);
  const games = { key: "games", dir: path.join(base, "games") };
  const retro = { key: "retro", dir: path.join(base, "retro") };
  const outside = path.join(base, "outside");
  for (const d of [games.dir, retro.dir, outside]) fs.mkdirSync(d, { recursive: true });
  const refreshed = [];
  const fr = createFileRoots({ roots: () => [games, retro], refresh: (keys) => refreshed.push(...keys) });
  return { fr, games, retro, outside, refreshed };
}
const put = (dir, rel, body = "x") => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), body);
};
const has = (dir, rel) => fs.existsSync(path.join(dir, rel));
const code = (p) => p.then(() => "ok", (e) => (e instanceof FileError ? e.code : `threw ${e.message}`));

test("a folder lists its folders first, then files, without the server's dot folders", async () => {
  const { fr, games } = setup();
  put(games.dir, "b.nsp", "12345");
  put(games.dir, "A Game/a.nsp");
  put(games.dir, ".cookingfoil-trash/x/y.nsp");
  put(games.dir, ".upload-staging/z.part");
  const out = await fr.list("games", "");
  assert.deepEqual(out.items.map((i) => [i.name, i.type]), [["A Game", "dir"], ["b.nsp", "file"]]);
  assert.equal(out.items[1].size, 5);
  assert.equal(out.items[1].rel, "b.nsp");
  assert.equal(out.path, "");
  assert.equal(out.parent, null);
  assert.deepEqual(out.counts, { dirs: 1, files: 1 });
});

test("a sub folder lists with its parent, and pages and sorts on the server", async () => {
  const { fr, games } = setup();
  for (let i = 0; i < 5; i++) put(games.dir, `Sub/f${i}.nsp`, "x".repeat(i + 1));
  const page = await fr.list("games", "Sub", { sort: "size", order: "desc", page: 2, perPage: 2 });
  assert.equal(page.path, "Sub");
  assert.equal(page.parent, "");
  assert.equal(page.total, 5);
  assert.equal(page.pages, 3);
  assert.deepEqual(page.items.map((i) => i.name), ["f2.nsp", "f1.nsp"]);
  assert.equal(page.items[0].rel, "Sub/f2.nsp");
  const found = await fr.list("games", "Sub", { q: "F3" });
  assert.deepEqual(found.items.map((i) => i.name), ["f3.nsp"]);
});

test("a path that climbs out, names a dot folder or an unknown root is refused", async () => {
  const { fr } = setup();
  assert.equal(await code(fr.list("games", "../outside")), "bad-path");
  assert.equal(await code(fr.list("games", "a/../../outside")), "bad-path");
  assert.equal(await code(fr.list("games", ".cookingfoil-trash")), "bad-path");
  assert.equal(await code(fr.list("games", "x\0y")), "bad-path");
  assert.equal(await code(fr.list("data", "")), "no-root");
  assert.equal(await code(fr.list("games", "missing")), "not-found");
});

test("a link that leads out of the root is neither listed nor followed", async () => {
  const { fr, games, outside } = setup();
  put(outside, "secret.txt", "s");
  fs.symlinkSync(outside, path.join(games.dir, "out"));
  fs.symlinkSync(path.join(outside, "secret.txt"), path.join(games.dir, "secret.txt"));
  put(games.dir, "Real/r.nsp");
  fs.symlinkSync(path.join(games.dir, "Real"), path.join(games.dir, "inside"));
  const out = await fr.list("games", "");
  assert.deepEqual(out.items.map((i) => i.name).sort(), ["Real", "inside"]);
  assert.equal(await code(fr.list("games", "out")), "bad-path");
  assert.equal(await code(fr.open("games", "secret.txt")), "bad-path");
  assert.equal(await code(fr.rename("games", "out", "x")), "bad-path");
});

test("a new folder is made once; the same name again is refused", async () => {
  const { fr, games, refreshed } = setup();
  const made = await fr.mkdir("games", "", "New Folder");
  assert.equal(made.rel, "New Folder");
  assert.ok(fs.statSync(path.join(games.dir, "New Folder")).isDirectory());
  assert.equal(await code(fr.mkdir("games", "", "New Folder")), "exists");
  assert.deepEqual(refreshed, ["games"]);
});

test("a name with a slash, a dot start, dots only or nothing is refused", async () => {
  const { fr, games } = setup();
  put(games.dir, "a.nsp");
  for (const bad of ["x/y", "x\\y", ".hidden", "..", ".", "", "   ", "a\0b", "x".repeat(256)]) {
    assert.equal(await code(fr.mkdir("games", "", bad)), "bad-name", JSON.stringify(bad));
    assert.equal(await code(fr.rename("games", "a.nsp", bad)), "bad-name", JSON.stringify(bad));
  }
});

test("a rename keeps the folder, never overwrites, and is journaled for undo", async () => {
  const { fr, games, refreshed } = setup();
  put(games.dir, "D/a.nsp", "A");
  put(games.dir, "D/b.nsp", "B");
  const r = await fr.rename("games", "D/a.nsp", "c.nsp", { by: { type: "admin", name: "t" } });
  assert.equal(r.rel, "D/c.nsp");
  assert.ok(has(games.dir, "D/c.nsp") && !has(games.dir, "D/a.nsp"));
  assert.equal(await code(fr.rename("games", "D/c.nsp", "b.nsp")), "exists");
  assert.equal(fs.readFileSync(path.join(games.dir, "D/b.nsp"), "utf8"), "B");
  const journal = fs.readFileSync(path.join(games.dir, ".cookingfoil-trash", "journal.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(journal.map((j) => [j.action, j.from, j.to]), [["rename", "D/a.nsp", "D/c.nsp"]]);
  assert.deepEqual(refreshed, ["games"]);
});

test("a move takes several items into a folder, across roots too, and stops at a taken name", async () => {
  const { fr, games, retro, refreshed } = setup();
  put(games.dir, "a.nsp", "A");
  put(games.dir, "B/b.nsp", "B");
  fs.mkdirSync(path.join(games.dir, "Into"));
  const r = await fr.move("games", ["a.nsp", "B"], "games", "Into");
  assert.deepEqual(r.moved.map((m) => m.to), ["Into/a.nsp", "Into/B"]);
  assert.ok(has(games.dir, "Into/B/b.nsp"));
  put(games.dir, "a.nsp", "again");
  const clash = await fr.move("games", ["a.nsp"], "games", "Into");
  assert.deepEqual(clash.moved, []);
  assert.deepEqual(clash.skipped.map((s) => [s.rel, s.code]), [["a.nsp", "exists"]]);
  const across = await fr.move("games", ["a.nsp"], "retro", "");
  assert.deepEqual(across.moved.map((m) => m.to), ["a.nsp"]);
  assert.ok(has(retro.dir, "a.nsp"));
  assert.deepEqual([...new Set(refreshed)].sort(), ["games", "retro"]);
});

test("a folder is never moved into itself or its own sub folder", async () => {
  const { fr, games } = setup();
  put(games.dir, "A/B/x.nsp");
  const r = await fr.move("games", ["A"], "games", "A/B");
  assert.deepEqual(r.moved, []);
  assert.deepEqual(r.skipped.map((s) => s.code), ["into-itself"]);
  assert.ok(has(games.dir, "A/B/x.nsp"));
});

test("a delete goes to the root's trash, where it can be restored from", async () => {
  const { fr, games, refreshed } = setup();
  put(games.dir, "D/a.nsp");
  put(games.dir, "b.nsp");
  const out = await fr.trash("games", ["D/a.nsp", "b.nsp"], { by: { type: "admin", name: "t" } });
  assert.ok(!has(games.dir, "D/a.nsp") && !has(games.dir, "b.nsp"));
  assert.deepEqual(out.files.sort(), ["D/a.nsp", "b.nsp"]);
  assert.ok(fs.readdirSync(path.join(games.dir, ".cookingfoil-trash")).length > 0);
  assert.equal(await code(fr.trash("games", [""])), "bad-path");
  assert.deepEqual(refreshed, ["games"]);
});

test("open gives a file to send and refuses a folder", async () => {
  const { fr, games } = setup();
  put(games.dir, "D/a.nsp", "abc");
  const f = await fr.open("games", "D/a.nsp");
  assert.equal(f.size, 3);
  assert.equal(f.name, "a.nsp");
  assert.equal(path.resolve(f.abs), path.join(games.dir, "D", "a.nsp"));
  assert.equal(await code(fr.open("games", "D")), "not-a-file");
});
