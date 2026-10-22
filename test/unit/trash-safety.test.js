import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The trash must never lose a file: two restores racing for one name both
// survive, a half-failed move keeps what it could not put back, a copy that
// stopped halfway is never handed back as the real thing, and a restore never
// writes outside its folder.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trash-safety-"));
const trash = await import("../../src/library/trash.js");
const journal = await import("../../src/library/journal.js");
const safeMove = await import("../../src/library/safe-move.js");

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
const read = (root, rel) => fs.readFileSync(path.join(root.dir, rel), "utf8");
const has = (root, rel) => fs.existsSync(path.join(root.dir, rel));
const visible = (root) => fs.readdirSync(root.dir).filter((x) => !x.startsWith(".")).sort();
const HOME = ".cookingfoil-trash";

test("two entries restored at once onto one name both come back, neither over the other", async () => {
  // The reviewer's repro (rvtrash/scratch/exp2.mjs): the first version was lost for good.
  const root = fresh();
  put(root, "z.nsp", "first-version");
  const a = await trash.trashItems(root, [{ rel: "z.nsp" }], { kind: "game" });
  put(root, "z.nsp", "second");
  const b = await trash.trashItems(root, [{ rel: "z.nsp" }], { kind: "game" });
  const r = await Promise.all([trash.restoreEntry(root, HOME, a.entry), trash.restoreEntry(root, HOME, b.entry)]);
  assert.deepEqual(r.map((x) => x.items[0].to).sort(), ["z (2).nsp", "z.nsp"]);
  assert.deepEqual(visible(root).map((f) => read(root, f)).sort(), ["first-version", "second"]);
  assert.deepEqual(await trash.listRoot(root), []);
});

test("the same entry restored twice at once comes back once; the second is refused and changes nothing", async () => {
  const root = fresh();
  put(root, "one.nsp", "ONE");
  const a = await trash.trashItems(root, [{ rel: "one.nsp" }], { kind: "game" });
  const r = await Promise.allSettled([trash.restoreEntry(root, HOME, a.entry), trash.restoreEntry(root, HOME, a.entry)]);
  assert.deepEqual(r.map((x) => x.status).sort(), ["fulfilled", "rejected"]);
  assert.match(r.find((x) => x.status === "rejected").reason.message, /휴지통에 없는/);
  assert.deepEqual(visible(root), ["one.nsp"]);
  assert.equal(read(root, "one.nsp"), "ONE");
});

test("a no-clobber move never replaces a file or a folder that holds something", async () => {
  const root = fresh();
  put(root, "a", "A");
  put(root, "b", "B");
  assert.equal(await safeMove.moveNoClobber(path.join(root.dir, "a"), path.join(root.dir, "b")), false);
  assert.deepEqual([read(root, "a"), read(root, "b")], ["A", "B"]);
  put(root, "d1/x", "X");
  put(root, "d2/y", "Y");
  assert.equal(await safeMove.moveNoClobber(path.join(root.dir, "d1"), path.join(root.dir, "d2")), false);
  assert.deepEqual([read(root, "d1/x"), read(root, "d2/y")], ["X", "Y"]);
  assert.equal(await safeMove.moveNoClobber(path.join(root.dir, "d1"), path.join(root.dir, "d3")), true);
  assert.equal(read(root, "d3/x"), "X");
  // Without hard links the name is claimed first, and a taken one is still refused.
  safeMove._setIo({ link: async () => { throw Object.assign(new Error("no links"), { code: "EPERM" }); } });
  try {
    assert.equal(await safeMove.moveNoClobber(path.join(root.dir, "a"), path.join(root.dir, "b")), false);
    assert.equal(await safeMove.moveNoClobber(path.join(root.dir, "a"), path.join(root.dir, "c")), true);
    assert.deepEqual([read(root, "b"), read(root, "c"), has(root, "a")], ["B", "A", false]);
  } finally {
    safeMove._setIo(null);
  }
});

test("an undo and a restore aimed at one place both keep their file", async () => {
  const incoming = fresh("incoming");
  const games = fresh("games");
  put(incoming, "zelda.nsp", "TRASHED");
  const t = await trash.trashItems(incoming, [{ rel: "zelda.nsp" }], { kind: "game" });
  put(games, "Zelda/zelda.nsp", "MOVED");
  const line = await journal.recordMove({ action: "organize", fromRoot: incoming, from: "zelda.nsp", toRoot: games, to: "Zelda/zelda.nsp" });
  const r = await Promise.allSettled([journal.undoMove([incoming, games], line.id), trash.restoreEntry(incoming, HOME, t.entry)]);
  const bodies = visible(incoming).map((f) => read(incoming, f)).sort();
  assert.ok(bodies.includes("TRASHED"), "the restored file is there");
  if (r[0].status === "fulfilled") assert.ok(bodies.includes("MOVED"), "and the undone one");
  else assert.equal(read(games, "Zelda/zelda.nsp"), "MOVED", "or the undo was refused and left it where it was");
});

test("two undos of one move at once: one moves it back, the other is refused", async () => {
  const incoming = fresh("incoming");
  const games = fresh("games");
  put(games, "G/g.nsp", "G");
  const line = await journal.recordMove({ action: "organize", fromRoot: incoming, from: "g.nsp", toRoot: games, to: "G/g.nsp" });
  const r = await Promise.allSettled([journal.undoMove([incoming, games], line.id), journal.undoMove([incoming, games], line.id)]);
  assert.deepEqual(r.map((x) => x.status).sort(), ["fulfilled", "rejected"]);
  assert.equal(read(incoming, "g.nsp"), "G");
});

test("a journal line whose paths leave the folder is refused, not followed", async () => {
  const incoming = fresh("incoming");
  const games = fresh("games");
  put(games, "G/g.nsp", "G");
  const line = await journal.recordMove({ action: "organize", fromRoot: incoming, from: "g.nsp", toRoot: games, to: "G/g.nsp" });
  // Edited by hand to point outside.
  const file = path.join(games.dir, HOME, "journal.jsonl");
  fs.writeFileSync(file, `${JSON.stringify({ ...line, from: "../escaped.nsp" })}\n`);
  await assert.rejects(journal.undoMove([incoming, games], line.id), /작업 기록에 없는|맞지 않/);
  assert.ok(!fs.existsSync(path.join(path.dirname(incoming.dir), "escaped.nsp")));
  assert.ok(has(games, "G/g.nsp"));
});

test("a half-failed move keeps in the trash what it could not put back, and says so", async () => {
  const root = fresh();
  put(root, "a.nsp", "A");
  put(root, "b.nsp", "B");
  // b.nsp fails to move; meanwhile something new took a.nsp's old place, so a cannot go back.
  trash._setIo({
    rename: async (from, to) => {
      if (path.basename(from) === "b.nsp") {
        put(root, "a.nsp", "NEW");
        throw Object.assign(new Error("denied"), { code: "EACCES" });
      }
      return fs.promises.rename(from, to);
    },
  });
  try {
    await assert.rejects(trash.trashItems(root, [{ rel: "a.nsp" }, { rel: "b.nsp" }], { kind: "game" }), /휴지통에 남/);
  } finally {
    trash._setIo(null);
  }
  assert.equal(read(root, "a.nsp"), "NEW", "what took the place is untouched");
  assert.equal(read(root, "b.nsp"), "B");
  const [left] = await trash.listRoot(root);
  assert.deepEqual(left.items.map((i) => [i.rel, i.present]), [["a.nsp", true]]);
  await trash.restoreEntry(root, left.home, left.entry);
  assert.equal(read(root, "a (2).nsp"), "A", "the first file is still there to restore");
});

test("exactName: a taken place refuses the whole entry and leaves it in the trash", async () => {
  const root = fresh("retro");
  put(root, "cores/x_libretro_libnx.nro", "USER CORE");
  put(root, "cores/x_libretro_libnx.info", "INFO");
  const t = await trash.trashItems(root, [{ rel: "cores/x_libretro_libnx.nro" }, { rel: "cores/x_libretro_libnx.info" }], { kind: "retro-core" });
  put(root, "cores/x_libretro_libnx.info", "OTHER");
  await assert.rejects(trash.restoreEntry(root, HOME, t.entry, { exactName: true }), (err) => err.status === 409 && /자리에 다른 파일/.test(err.message));
  assert.ok(!has(root, "cores/x_libretro_libnx.nro"), "nothing came back, not even the free one");
  assert.equal(read(root, "cores/x_libretro_libnx.info"), "OTHER");
  assert.equal((await trash.listRoot(root)).length, 1);
  fs.rmSync(path.join(root.dir, "cores/x_libretro_libnx.info"));
  const r = await trash.restoreEntry(root, HOME, t.entry, { exactName: true });
  assert.deepEqual(r.renamed, []);
  assert.equal(read(root, "cores/x_libretro_libnx.nro"), "USER CORE");
});

test("a retro game whose name is taken is refused, so its art and art-map key never part from it", async () => {
  const root = fresh("retro");
  put(root, "roms/snes/Mario.zip", "ROM");
  put(root, "thumbnails/Nintendo - Super Nintendo Entertainment System/Named_Boxarts/Mario.png", "ART");
  const t = await trash.trashItems(root, [{ rel: "roms/snes/Mario.zip" }, { rel: "thumbnails/Nintendo - Super Nintendo Entertainment System/Named_Boxarts/Mario.png" }], { kind: "retro-game" });
  put(root, "roms/snes/Mario.zip", "OTHER ROM");
  await assert.rejects(trash.restoreEntry(root, HOME, t.entry), /자리에 다른 파일/);
  assert.equal((await trash.listRoot(root)).length, 1);
});

test("a copy across disks that stopped halfway is never listed as whole or restored", async () => {
  const root = fresh();
  put(root, "big.nsp", "0123456789".repeat(100));
  const t = await trash.trashItems(root, [{ rel: "big.nsp" }], { kind: "game" });
  // As if the server stopped mid-copy: the trash copy is shorter than the manifest says.
  fs.truncateSync(path.join(root.dir, HOME, t.entry, "big.nsp"), 10);
  put(root, "big.nsp", "0123456789".repeat(100));
  const [e] = await trash.listRoot(root);
  assert.equal(e.items[0].incomplete, true);
  assert.equal(e.incomplete, 1);
  await assert.rejects(trash.restoreEntry(root, HOME, t.entry), /불완전/);
  assert.deepEqual(visible(root), ["big.nsp"], "no truncated copy lands beside the original");
});

test("a copy across disks is made under a dot name, checked, and a bad copy is dropped with the original kept", async () => {
  const root = fresh();
  put(root, "lone.nsp", "LONE BYTES");
  trash._setIo({ rename: async (a, b) => {
    if (path.basename(a).startsWith(safeMove.PARTIAL_PREFIX)) return fs.promises.rename(a, b);
    throw Object.assign(new Error("EXDEV"), { code: "EXDEV" });
  } });
  const cp = fs.promises.cp;
  const seen = [];
  fs.promises.cp = async (from, to, opts) => {
    seen.push(path.basename(to));
    await cp(from, to, opts);
    fs.truncateSync(to, 3);
  };
  try {
    await assert.rejects(trash.trashItems(root, [{ rel: "lone.nsp" }], { kind: "game" }), /복사본이 원본과 달라/);
  } finally {
    fs.promises.cp = cp;
    trash._setIo(null);
  }
  assert.ok(seen[0].startsWith(safeMove.PARTIAL_PREFIX), "copied under a dot name first");
  assert.equal(read(root, "lone.nsp"), "LONE BYTES");
  assert.deepEqual(await trash.listRoot(root), []);
});

test("a restore whose folder became a link to outside is refused and stays in the trash", async () => {
  const root = fresh();
  const outside = path.join(tmp, `outside-${n++}`);
  fs.mkdirSync(outside);
  put(root, "sub/z.nsp", "Z");
  const t = await trash.trashItems(root, [{ rel: "sub/z.nsp" }], { kind: "game" });
  fs.rmSync(path.join(root.dir, "sub"), { recursive: true });
  fs.symlinkSync(outside, path.join(root.dir, "sub"));
  await assert.rejects(trash.restoreEntry(root, HOME, t.entry), /폴더 밖/);
  assert.deepEqual(fs.readdirSync(outside), []);
  assert.equal((await trash.listRoot(root)).length, 1);
});

test("restore keys only go back into art-map files, never any json in the folder", async () => {
  const root = fresh("retro");
  put(root, "roms/md/G.zip", "G");
  const t = await trash.trashItems(root, [{ rel: "roms/md/G.zip" }], {
    kind: "retro-game",
    restoreKeys: [{ file: "art-map/md.json", key: "G", value: "G (Japan)" }, { file: "custom_entries.json", key: "x", value: 1 }],
  });
  await trash.restoreEntry(root, HOME, t.entry);
  assert.deepEqual(JSON.parse(read(root, "art-map/md.json")), { G: "G (Japan)" });
  assert.ok(!has(root, "custom_entries.json"));
});

test("a trash home under a dot folder is still listed", async () => {
  const root = fresh();
  put(root, ".hidden-disk/.cookingfoil-trash/2026-01-01/game-0123456789/x.nsp", "X");
  put(root, ".hidden-disk/.cookingfoil-trash/2026-01-01/game-0123456789/manifest.json", JSON.stringify({ version: 1, kind: "game", trashedAt: 1, items: [{ rel: "x.nsp", type: "file", size: 1 }] }));
  put(root, ".cookingfoil-trash/homes.json", JSON.stringify([".hidden-disk/.cookingfoil-trash"]));
  assert.deepEqual((await trash.listRoot(root)).map((e) => e.home), [".hidden-disk/.cookingfoil-trash"]);
});

test("a home whose disk is not there is reported, not silently dropped", async () => {
  const root = fresh();
  put(root, ".cookingfoil-trash/homes.json", JSON.stringify(["usb/.cookingfoil-trash"]));
  const out = await trash.unavailableHomes(root);
  assert.deepEqual(out, ["usb/.cookingfoil-trash"]);
});

test("the journal stays bounded: old lines are dropped once it grows past its limit", async () => {
  const incoming = fresh("incoming");
  const games = fresh("games");
  put(games, "a.nsp", "A");
  for (let i = 0; i < journal.JOURNAL_KEEP + 50; i++) {
    await journal.recordMove({ action: "organize", fromRoot: incoming, from: `x${i}.nsp`, toRoot: games, to: "a.nsp", now: i });
  }
  const { total } = await journal.listJournal([incoming, games], { limit: 1 });
  assert.ok(total <= journal.JOURNAL_KEEP + journal.JOURNAL_SLACK + journal.TRIM_EVERY, `${total} lines kept`);
});
