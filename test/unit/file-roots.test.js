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
  const patches = { key: "patches", dir: path.join(base, "patches") };
  const outside = path.join(base, "outside");
  for (const d of [games.dir, retro.dir, patches.dir, outside]) fs.mkdirSync(d, { recursive: true });
  const refreshed = [];
  const fr = createFileRoots({ roots: () => [games, retro, patches], refresh: (keys) => refreshed.push(...keys) });
  return { fr, games, retro, patches, outside, refreshed };
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
  put(games.dir, "notes.txt", "N");
  const across = await fr.move("games", ["notes.txt"], "retro", "");
  assert.deepEqual(across.moved.map((m) => m.to), ["notes.txt"]);
  assert.ok(has(retro.dir, "notes.txt"));
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

// Review 2026-10-27: in the old layout incoming, patches and the data folder can sit inside the games folder.
function nested() {
  const base = path.join(tmp, `n${n++}`);
  const games = { key: "games", dir: path.join(base, "games") };
  const incoming = { key: "incoming", dir: path.join(games.dir, "incoming") };
  const patches = { key: "patches", dir: path.join(games.dir, "patches") };
  const data = path.join(games.dir, "data");
  for (const d of [incoming.dir, patches.dir, data]) fs.mkdirSync(d, { recursive: true });
  put(data, "accounts.json", "secret");
  put(games.dir, "g/a.nsp");
  const fr = createFileRoots({ roots: () => [games, incoming, patches], refresh: () => {}, fences: () => [data] });
  return { fr, games, incoming, patches, data };
}

test("another root or the server's data folder inside a root is neither listed nor touched from it", async () => {
  const { fr, games, incoming } = nested();
  assert.deepEqual((await fr.list("games", "")).items.map((i) => i.name), ["g"]);
  for (const rel of ["incoming", "patches", "data", "data/accounts.json"]) {
    assert.equal(await code(fr.list("games", rel)), "bad-path", rel);
    assert.equal(await code(fr.open("games", rel)), "bad-path", rel);
    assert.equal(await code(fr.rename("games", rel, "x")), "bad-path", rel);
    assert.equal(await code(fr.trash("games", [rel])), "bad-path", rel);
  }
  assert.equal(await code(fr.move("games", ["g/a.nsp"], "games", "patches")), "bad-path");
  assert.equal(await code(fr.move("games", ["g/a.nsp"], "games", "data")), "bad-path");
  assert.ok(has(games.dir, "g/a.nsp"));
  // The nested root is still reachable as itself.
  put(incoming.dir, "drop.nsp");
  assert.deepEqual((await fr.list("incoming", "")).items.map((i) => i.name), ["drop.nsp"]);
});

test("a link to a hidden folder inside the root is neither listed nor followed", async () => {
  const { fr, games } = setup();
  put(games.dir, ".cookingfoil-trash/x/f.nsp");
  put(games.dir, "g/a.nsp");
  fs.symlinkSync(path.join(games.dir, ".cookingfoil-trash"), path.join(games.dir, "tl"));
  assert.deepEqual((await fr.list("games", "")).items.map((i) => i.name), ["g"]);
  assert.equal(await code(fr.list("games", "tl")), "bad-path");
  assert.equal(await code(fr.open("games", "tl/x/f.nsp")), "bad-path");
  assert.equal(await code(fr.move("games", ["g/a.nsp"], "games", "tl")), "bad-path");
  assert.ok(has(games.dir, "g/a.nsp"));
});

test("a name with a control character is refused", async () => {
  const { fr, games } = setup();
  put(games.dir, "a.nsp");
  for (const bad of ["a\nb", "a\rb", "a\tb", "a\x7fb"]) assert.equal(await code(fr.mkdir("games", "", bad)), "bad-name", JSON.stringify(bad));
});

test("a folder named by a title id lists with its game's name, and that name finds it", async () => {
  const { fr, games } = setup();
  put(games.dir, "0100AAAA00000000/save.bin");
  put(games.dir, "0100BBBB00000000/save.bin");
  put(games.dir, "notes.txt");
  const label = (name) => ({ "0100AAAA00000000": "Alpha Quest" })[name] ?? null;
  const out = await fr.list("games", "", { label });
  assert.deepEqual(out.items.map((i) => [i.name, i.title]), [["0100BBBB00000000", null], ["0100AAAA00000000", "Alpha Quest"], ["notes.txt", null]]);
  assert.deepEqual((await fr.list("games", "", { q: "alpha", label })).items.map((i) => i.name), ["0100AAAA00000000"]);
  assert.deepEqual((await fr.list("games", "", { q: "quest", deep: true, label })).items.map((i) => i.name), ["0100AAAA00000000"]);
});

test("a folder's size leaves out a fenced folder inside it", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "fr-size-"));
  const games = { key: "games", dir: path.join(base, "games") };
  const data = path.join(games.dir, "Box/data");
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(data, "secret"), "1234567890");
  fs.writeFileSync(path.join(games.dir, "Box/a.nsp"), "12");
  const fr = createFileRoots({ roots: () => [games], refresh: () => {}, fences: () => [data] });
  assert.deepEqual(await fr.sizes("games", ["Box"]), { Box: { bytes: 2, files: 1, dirs: 0 } });
  fs.rmSync(base, { recursive: true, force: true });
});

test("a game's folder is not moved into another game's folder, but a file or a folder inside one still moves", async () => {
  const { fr, games } = setup();
  put(games.dir, "Neon Abyss 2/game.nsp");
  put(games.dir, "Titan Quest/game.nsp");
  put(games.dir, "Titan Quest/Extras/note.txt");
  put(games.dir, "loose.nsp");
  const nested = await fr.move("games", ["Neon Abyss 2"], "games", "Titan Quest");
  assert.deepEqual([nested.moved, nested.skipped], [[], [{ rel: "Neon Abyss 2", code: "game-into-game" }]]);
  assert.ok(has(games.dir, "Neon Abyss 2/game.nsp"), "left where it was");
  const file = await fr.move("games", ["loose.nsp"], "games", "Titan Quest");
  assert.equal(file.moved.length, 1);
  const inner = await fr.move("games", ["Titan Quest/Extras"], "games", "Neon Abyss 2");
  assert.equal(inner.moved.length, 1);
  // Into a folder inside a game is into the game.
  put(games.dir, "Titan Quest/Extras/more.txt");
  const deeper = await fr.move("games", ["Neon Abyss 2"], "games", "Titan Quest/Extras");
  assert.deepEqual(deeper.skipped, [{ rel: "Neon Abyss 2", code: "game-into-game" }]);
  // Picked together with a loose file into a plain folder: the file does not make the folder a game's.
  fs.mkdirSync(path.join(games.dir, "Plain"));
  put(games.dir, "one.nsp");
  const together = await fr.move("games", ["one.nsp", "Neon Abyss 2"], "games", "Plain");
  assert.deepEqual(together.moved.map((m) => m.to), ["Plain/one.nsp", "Plain/Neon Abyss 2"]);
});

test("a Switch game is not moved or copied where it would not be read as one, a plain file still is", async () => {
  const { fr, games, retro, patches } = setup();
  put(games.dir, "lone.nsp");
  put(games.dir, "Shelf/Some Game/game.xci");
  put(games.dir, "readme.txt");
  const moved = await fr.move("games", ["lone.nsp", "Shelf", "readme.txt"], "retro", "");
  assert.deepEqual(moved.skipped, [{ rel: "lone.nsp", code: "game-wrong-root" }, { rel: "Shelf", code: "game-wrong-root" }]);
  assert.deepEqual(moved.moved.map((m) => m.to), ["readme.txt"]);
  const copied = await fr.copy("games", ["lone.nsp"], "patches", "");
  assert.deepEqual([copied.copied, copied.skipped], [[], [{ rel: "lone.nsp", code: "game-wrong-root" }]]);
  assert.ok(has(games.dir, "lone.nsp") && has(games.dir, "Shelf/Some Game/game.xci") && !has(retro.dir, "lone.nsp") && !has(patches.dir, "lone.nsp"));
});

test("a title's patch folder is not moved into another title's folder, a patch inside one still moves", async () => {
  const { fr, patches } = setup();
  put(patches.dir, "0100AAAA00000000/Korean/atmosphere/main");
  put(patches.dir, "0100BBBB00000000/Cheats/x.txt");
  const nested = await fr.move("patches", ["0100AAAA00000000"], "patches", "0100BBBB00000000");
  assert.deepEqual(nested.skipped, [{ rel: "0100AAAA00000000", code: "title-into-title" }]);
  const inner = await fr.move("patches", ["0100BBBB00000000/Cheats"], "patches", "0100AAAA00000000");
  assert.equal(inner.moved.length, 1);
});
