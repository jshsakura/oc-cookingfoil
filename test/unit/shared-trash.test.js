import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The shared trash moves, never deletes: a file or a folder goes into
// <root>/.cookingfoil-trash with a manifest and comes back byte for byte, a
// restore never writes over what took its place, and only emptying deletes.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "shared-trash-"));
const trash = await import("../../src/library/trash.js");
const journal = await import("../../src/library/journal.js");

let n = 0;
function fresh(key = "games") {
  const dir = path.join(tmp, `${key}-${n++}`);
  fs.mkdirSync(dir, { recursive: true });
  return { key, dir };
}
const put = (root, rel, body = "x") => {
  fs.mkdirSync(path.dirname(path.join(root.dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(root.dir, rel), body);
};
const read = (root, rel) => fs.readFileSync(path.join(root.dir, rel));
const has = (root, rel) => fs.existsSync(path.join(root.dir, rel));
const by = { type: "admin", name: "boss" };

test("a trashed file leaves its place, is listed with who and why, and comes back byte for byte", async () => {
  const root = fresh();
  const bytes = Buffer.from([0, 1, 2, 3, 250, 251, 252, 253]);
  put(root, "Zelda/Zelda [0100000000010000][v0].nsp", bytes);
  const out = await trash.trashItems(root, [{ rel: "Zelda/Zelda [0100000000010000][v0].nsp" }], { kind: "game", action: "library-file-remove", by, name: "Zelda" });
  assert.ok(!has(root, "Zelda/Zelda [0100000000010000][v0].nsp"));
  assert.match(out.entry, /^\d{4}-\d{2}-\d{2}\/game-[0-9a-f]{10}$/);
  assert.ok(has(root, `.cookingfoil-trash/${out.entry}/Zelda/Zelda [0100000000010000][v0].nsp`));

  const [item] = await trash.listRoot(root);
  assert.equal(item.id, out.id);
  assert.deepEqual([item.kind, item.action, item.by, item.name, item.size, item.missing], ["game", "library-file-remove", by, "Zelda", 8, 0]);
  assert.deepEqual(item.items.map((i) => [i.rel, i.type, i.size, i.present]), [["Zelda/Zelda [0100000000010000][v0].nsp", "file", 8, true]]);

  const back = await trash.restoreEntry(root, item.home, item.entry);
  assert.deepEqual(back.items, [{ rel: "Zelda/Zelda [0100000000010000][v0].nsp", to: "Zelda/Zelda [0100000000010000][v0].nsp" }]);
  assert.deepEqual(read(root, "Zelda/Zelda [0100000000010000][v0].nsp"), bytes);
  assert.deepEqual(await trash.listRoot(root), [], "a restored entry leaves the trash");
});

test("a folder (a patch, a save, a homebrew app) goes whole and comes back whole", async () => {
  const root = fresh("patches");
  put(root, "0100000000010000/한글패치/atmosphere/contents/0100000000010000/romfs/data.bin", "DATA");
  put(root, "0100000000010000/한글패치/patch.json", "{}");
  const out = await trash.trashItems(root, [{ rel: "0100000000010000/한글패치" }], { kind: "patch", action: "patch-remove", by });
  assert.ok(!has(root, "0100000000010000/한글패치"));
  const [item] = await trash.listRoot(root);
  assert.deepEqual([item.items[0].type, item.items[0].files, item.size], ["dir", 2, 6]);
  await trash.restoreEntry(root, item.home, item.entry);
  assert.equal(read(root, "0100000000010000/한글패치/atmosphere/contents/0100000000010000/romfs/data.bin").toString(), "DATA");
  assert.ok(has(root, "0100000000010000/한글패치/patch.json"));
  assert.ok(out.id.startsWith("patches|.cookingfoil-trash|"));
});

test("a restore never overwrites: a taken place gets the item back beside it under a numbered name", async () => {
  const root = fresh();
  put(root, "A/Game.nsp", "OLD");
  const first = await trash.trashItems(root, [{ rel: "A/Game.nsp" }], { kind: "game" });
  put(root, "A/Game.nsp", "NEW");
  put(root, "A/Game (2).nsp", "TAKEN TOO");
  const r = await trash.restoreEntry(root, ".cookingfoil-trash", first.entry);
  assert.deepEqual(r.renamed, [{ rel: "A/Game.nsp", to: "A/Game (3).nsp" }]);
  assert.equal(read(root, "A/Game.nsp").toString(), "NEW", "what took the place stays as it is");
  assert.equal(read(root, "A/Game (2).nsp").toString(), "TAKEN TOO");
  assert.equal(read(root, "A/Game (3).nsp").toString(), "OLD");
  // A folder is numbered after its whole name.
  put(root, "Patch/a.txt", "1");
  const dir = await trash.trashItems(root, [{ rel: "Patch" }], { kind: "patch" });
  put(root, "Patch/b.txt", "2");
  const d = await trash.restoreEntry(root, ".cookingfoil-trash", dir.entry);
  assert.deepEqual(d.renamed, [{ rel: "Patch", to: "Patch (2)" }]);
  assert.equal(read(root, "Patch (2)/a.txt").toString(), "1");
});

test("emptying is the one permanent delete, and it only reaches the server's own trash", async () => {
  const root = fresh();
  put(root, "x.nsp", "12345");
  const out = await trash.trashItems(root, [{ rel: "x.nsp" }], { kind: "game" });
  assert.equal(await trash.emptyEntry(root, ".cookingfoil-trash", out.entry) >= 5, true);
  assert.deepEqual(await trash.listRoot(root), []);
  assert.ok(!has(root, "x.nsp"));
  // Paths that try to leave the trash are refused.
  await assert.rejects(trash.emptyEntry(root, ".cookingfoil-trash", "../../x"), /맞지 않습니다/);
  await assert.rejects(trash.emptyEntry(root, "..", "2026-01-01/game-0123456789"), /맞지 않습니다/);
  await assert.rejects(trash.restoreEntry(root, "../elsewhere/.cookingfoil-trash", "2026-01-01/game-0123456789"), /맞지 않습니다/);
  await assert.rejects(trash.trashItems(root, [{ rel: "../outside.nsp" }], {}), /옮길 수 없는 경로/);
  await assert.rejects(trash.trashItems(root, [{ rel: ".cookingfoil-trash/x" }], {}), /옮길 수 없는 경로/);
});

test("several items are one entry, all or none: a failure puts back what had moved", async () => {
  const root = fresh();
  put(root, "a.nsp", "A");
  await assert.rejects(trash.trashItems(root, [{ rel: "a.nsp" }, { rel: "missing.nsp" }], { kind: "game" }), /없습니다/);
  assert.equal(read(root, "a.nsp").toString(), "A", "the first one is back");
  assert.deepEqual(await trash.listRoot(root), []);
});

test("a file on another disk under the root goes to the trash of the top-most folder on that disk, not by copy", async () => {
  const root = fresh();
  put(root, "mount/Big/Big.nsp", "BIG");
  put(root, "local.nsp", "L");
  // Everything under <root>/mount is "another filesystem": renames across it fail as they would.
  const mount = path.join(root.dir, "mount");
  const devOf = (p) => (path.resolve(p) === mount || path.resolve(p).startsWith(mount + path.sep) ? 2 : 1);
  const renames = [];
  trash._setIo({
    stat: async (p) => ({ ...(await fs.promises.lstat(p)), dev: devOf(p) }),
    rename: async (a, b) => {
      if (devOf(a) !== devOf(b)) throw Object.assign(new Error("EXDEV: cross-device link"), { code: "EXDEV" });
      renames.push([a, b]);
      return fs.promises.rename(a, b);
    },
  });
  const cp = fs.promises.cp;
  let copies = 0;
  fs.promises.cp = async (...a) => { copies++; return cp(...a); };
  try {
    const out = await trash.trashItems(root, [{ rel: "mount/Big/Big.nsp" }, { rel: "local.nsp" }], { kind: "game", by });
    assert.equal(copies, 0, "no bytes are copied");
    assert.deepEqual(out.entries.map((e) => e.home).sort(), [".cookingfoil-trash", "mount/.cookingfoil-trash"]);
    assert.ok(has(root, `mount/.cookingfoil-trash/${out.entries.find((e) => e.home !== ".cookingfoil-trash").entry}/mount/Big/Big.nsp`));
    // The root remembers the other home, so the list finds it.
    const listed = await trash.listRoot(root);
    assert.deepEqual(listed.map((e) => e.home).sort(), [".cookingfoil-trash", "mount/.cookingfoil-trash"]);
    for (const e of listed) await trash.restoreEntry(root, e.home, e.entry);
    assert.equal(read(root, "mount/Big/Big.nsp").toString(), "BIG");
    assert.equal(read(root, "local.nsp").toString(), "L");
  } finally {
    trash._setIo(null);
    fs.promises.cp = cp;
  }
});

test("with no folder on its own disk to take it, a file is copied, checked, and only then removed", async () => {
  const root = fresh();
  put(root, "lone.nsp", "LONE BYTES");
  trash._setIo({ rename: async () => { throw Object.assign(new Error("EXDEV"), { code: "EXDEV" }); } });
  try {
    const out = await trash.trashItems(root, [{ rel: "lone.nsp" }], { kind: "game" });
    assert.ok(!has(root, "lone.nsp"));
    assert.equal(read(root, `.cookingfoil-trash/${out.entry}/lone.nsp`).toString(), "LONE BYTES");
    await trash.restoreEntry(root, ".cookingfoil-trash", out.entry);
    assert.equal(read(root, "lone.nsp").toString(), "LONE BYTES", "and copied back the same way");
  } finally {
    trash._setIo(null);
  }
});

test("the trash survives a restart: a new process lists it from the folders alone, with no index", async () => {
  const root = fresh();
  put(root, "keep.nsp", "K");
  await trash.trashItems(root, [{ rel: "keep.nsp" }], { kind: "game", by, action: "library-file-remove" });
  // No database is involved: a separate process with nothing in memory reads the same list.
  for (const db of ["cookingfoil.db", "cookingfoil.db-wal"]) fs.rmSync(path.join(tmp, db), { force: true });
  const script = `const t=await import(${JSON.stringify(new URL("../../src/library/trash.js", import.meta.url).href)});
    const l=await t.listRoot(${JSON.stringify(root)});process.stdout.write(JSON.stringify(l.map((e)=>[e.items[0].rel,e.action,e.by.name])));`;
  const outText = execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.deepEqual(JSON.parse(outText), [["keep.nsp", "library-file-remove", "boss"]]);
});

test("retro's old .trash entries move into the shared folder in place, list and restore with their art-map key", async () => {
  const root = fresh("retro");
  put(root, ".trash/2026-10-14/md-0123456789/roms/md/Game.zip", "ROM");
  put(root, ".trash/2026-10-14/md-0123456789/manifest.json", JSON.stringify({
    id: "md-0123456789", system: "md", name: "Game", file: "Game.zip", size: 3, trashedAt: 1, files: ["roms/md/Game.zip"],
    artMap: { system: "md", key: "Game", value: "Game (Japan)" },
  }));
  put(root, "art-map/md.json", "{}");
  assert.equal(await trash.migrateLegacy(root), 1);
  assert.ok(!has(root, ".trash"), "the old folder is gone once empty");
  const [item] = await trash.listRoot(root);
  assert.deepEqual([item.home, item.entry, item.kind, item.name], [".cookingfoil-trash", "2026-10-14/md-0123456789", "retro-game", "Game"]);
  await trash.restoreEntry(root, item.home, item.entry);
  assert.equal(read(root, "roms/md/Game.zip").toString(), "ROM");
  assert.deepEqual(JSON.parse(read(root, "art-map/md.json")), { Game: "Game (Japan)" });
});

test("a retro .trash entry that cannot be renamed stays and is still listed and restored from there", async () => {
  const root = fresh("retro");
  put(root, ".trash/2026-10-14/md-abcdefabcd/roms/md/B.zip", "B");
  put(root, ".trash/2026-10-14/md-abcdefabcd/manifest.json", JSON.stringify({ id: "md-abcdefabcd", system: "md", name: "B", trashedAt: 2, files: ["roms/md/B.zip"] }));
  trash._setIo({ rename: async () => { throw Object.assign(new Error("EXDEV"), { code: "EXDEV" }); } });
  try {
    assert.equal(await trash.migrateLegacy(root), 0);
  } finally {
    trash._setIo(null);
  }
  const [item] = await trash.listRoot(root);
  assert.equal(item.home, ".trash");
  await trash.restoreEntry(root, item.home, item.entry);
  assert.equal(read(root, "roms/md/B.zip").toString(), "B");
});

test("a journaled move is undone only while its old place is free and the file is the one moved", async () => {
  const incoming = fresh("incoming");
  const games = fresh("games");
  const roots = [incoming, games];
  put(games, "Zelda/Zelda [0100000000010000][v0].nsp", "Z");
  const line = await journal.recordMove({ action: "organize", by: { type: "job", name: "organize" }, fromRoot: incoming, from: "zelda.nsp", toRoot: games, to: "Zelda/Zelda [0100000000010000][v0].nsp" });
  assert.match(line.id, /^[0-9a-f]{12}$/);
  assert.ok(has(games, ".cookingfoil-trash/journal.jsonl"), "kept on disk beside the trash");
  let { items } = await journal.listJournal(roots);
  assert.deepEqual(items.map((o) => [o.from, o.to, o.undoable]), [["zelda.nsp", "Zelda/Zelda [0100000000010000][v0].nsp", true]]);

  // Something took the old place: refused, nothing moves.
  put(incoming, "zelda.nsp", "OTHER");
  await assert.rejects(journal.undoMove(roots, line.id), /원래 자리에 다른 파일/);
  fs.rmSync(path.join(incoming.dir, "zelda.nsp"));
  // The file changed since: refused.
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(path.join(games.dir, "Zelda/Zelda [0100000000010000][v0].nsp"), later, later);
  await assert.rejects(journal.undoMove(roots, line.id), /바뀌어/);
  const st = { at: line.mtimeMs / 1000 };
  fs.utimesSync(path.join(games.dir, "Zelda/Zelda [0100000000010000][v0].nsp"), st.at, st.at);

  const out = await journal.undoMove(roots, line.id, { by });
  assert.deepEqual([out.from, out.to], ["zelda.nsp", "Zelda/Zelda [0100000000010000][v0].nsp"]);
  assert.equal(read(incoming, "zelda.nsp").toString(), "Z");
  assert.ok(!has(games, "Zelda"), "the folder the move made and left empty goes");
  ({ items } = await journal.listJournal(roots));
  assert.deepEqual([items[0].undone?.by, items[0].undoable], [by, false]);
  await assert.rejects(journal.undoMove(roots, line.id), /이미 되돌린/);
});

test("a legacy .trash entry whose name the new folder already has stays where it is, and both are listed", async () => {
  const root = fresh("retro");
  const m = (name) => JSON.stringify({ id: "md-0123456789", system: "md", name, trashedAt: 3, files: [`roms/md/${name}.zip`] });
  put(root, ".trash/2026-10-14/md-0123456789/roms/md/Old.zip", "OLD");
  put(root, ".trash/2026-10-14/md-0123456789/manifest.json", m("Old"));
  put(root, ".cookingfoil-trash/2026-10-14/md-0123456789/roms/md/New.zip", "NEW");
  put(root, ".cookingfoil-trash/2026-10-14/md-0123456789/manifest.json", m("New"));
  assert.equal(await trash.migrateLegacy(root), 0, "nothing is renamed over the entry already there");
  const list = await trash.listRoot(root);
  assert.deepEqual(list.map((e) => [e.home, e.name]).sort(), [[".cookingfoil-trash", "New"], [".trash", "Old"]]);
  assert.equal(read(root, ".cookingfoil-trash/2026-10-14/md-0123456789/roms/md/New.zip").toString(), "NEW");
});

test("a .trash folder in any folder but retro is someone else's: never listed, never migrated", async () => {
  const root = fresh("games");
  put(root, ".trash/2026-10-14/md-0123456789/roms/md/X.zip", "X");
  put(root, ".trash/2026-10-14/md-0123456789/manifest.json", JSON.stringify({ id: "md-0123456789", system: "md", name: "X", trashedAt: 3, files: ["roms/md/X.zip"] }));
  assert.deepEqual(await trash.listRoot(root), []);
  assert.ok(!trash.homesOf(root).includes(".trash"));
  assert.ok(has(root, ".trash/2026-10-14/md-0123456789/roms/md/X.zip"));
});

test("a legacy .trash day folder with stray files or a broken manifest is left alone, the good entries still move", async () => {
  const root = fresh("retro");
  put(root, ".trash/2026-10-14/md-abcdefabcd/roms/md/G.zip", "G");
  put(root, ".trash/2026-10-14/md-abcdefabcd/manifest.json", JSON.stringify({ id: "md-abcdefabcd", system: "md", name: "G", trashedAt: 3, files: ["roms/md/G.zip"] }));
  put(root, ".trash/2026-10-14/md-bbbbbbbbbb/manifest.json", "{ not json");
  put(root, ".trash/2026-10-14/notes.txt", "mine");
  assert.equal(await trash.migrateLegacy(root), 1);
  assert.ok(has(root, ".trash/2026-10-14/notes.txt") && has(root, ".trash/2026-10-14/md-bbbbbbbbbb/manifest.json"), "what is not a trash entry stays");
  assert.deepEqual((await trash.listRoot(root)).map((e) => e.name), ["G"]);
});
