import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// What the trash and the journal leave behind when the server stops at the
// wrong moment, or keeps running for a long time: an undone file stays where
// the admin put it however long the journal grows, a copy cut short across
// disks is cleaned up, and a restore cut short between its two steps neither
// leaves the file twice nor refuses forever.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trash-recovery-"));
const trash = await import("../../src/library/trash.js");
const journal = await import("../../src/library/journal.js");
const safeMove = await import("../../src/library/safe-move.js");
const SAFE_MOVE_URL = pathToFileURL(path.resolve("src/library/safe-move.js")).href;
const TRASH_URL = pathToFileURL(path.resolve("src/library/trash.js")).href;

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
const has = (root, rel) => fs.existsSync(path.join(root.dir, rel));
const HOME = ".cookingfoil-trash";
const partialsIn = (dir) => fs.readdirSync(dir).filter((f) => f.startsWith(safeMove.PARTIAL_PREFIX));

/** Runs `body` in a new node process that has `S` (safe-move) and `T` (trash) imported; it is expected to exit on its own. */
function crashIn(body) {
  const script = `const S = await import(${JSON.stringify(SAFE_MOVE_URL)}); const T = await import(${JSON.stringify(TRASH_URL)}); ${body}`;
  return spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
}

/** An organize move from the drop box into the games folder, undone: the file is held in the drop box. */
async function undoneOrganize() {
  const incoming = fresh("incoming");
  const games = fresh("games");
  const roots = [{ key: "games", dir: games.dir }, { key: "incoming", dir: incoming.dir }];
  put(games, "T/a.nsp", "aaaa");
  const op = await journal.recordMove({ action: "organize", fromRoot: incoming, from: "a.nsp", toRoot: games, to: "T/a.nsp" });
  await journal.undoMove(roots, op.id);
  return { incoming, games, roots, op };
}

test("an undone file stays held in the drop box however many moves the journal compacts after it", async () => {
  // The reviewer's repro (rvtrash2/scratch/exp4.mjs): after ~2,600 more moves the hold was gone and the file sorted again.
  const { incoming, games, roots } = await undoneOrganize();
  assert.deepEqual(journal.undoneHeld(roots, "incoming").map((h) => h.rel), ["a.nsp"]);
  put(games, "T/b.nsp", "b");
  const more = journal.JOURNAL_KEEP + journal.JOURNAL_SLACK + journal.TRIM_EVERY + 5;
  for (let i = 0; i < more; i++) await journal.recordMove({ action: "organize", fromRoot: incoming, from: `x${i}.nsp`, toRoot: games, to: "T/b.nsp", now: 10_000 + i });
  const lines = fs.readFileSync(path.join(games.dir, HOME, journal.JOURNAL_FILE), "utf8").trim().split("\n").length;
  assert.ok(lines <= journal.JOURNAL_KEEP + journal.JOURNAL_SLACK + journal.TRIM_EVERY + 3, `the journal was compacted (${lines} lines)`);
  assert.deepEqual(journal.undoneHeld(roots, "incoming").map((h) => h.rel), ["a.nsp"], "the hold survived the compaction");
  assert.ok(has(incoming, "a.nsp"));
});

test("a released hold is dropped by the next compaction like any old move", async () => {
  const { incoming, games, roots, op } = await undoneOrganize();
  await journal.releaseUndone(roots, op.id);
  put(games, "T/b.nsp", "b");
  const more = journal.JOURNAL_KEEP + journal.JOURNAL_SLACK + journal.TRIM_EVERY + 5;
  for (let i = 0; i < more; i++) await journal.recordMove({ action: "organize", fromRoot: incoming, from: `x${i}.nsp`, toRoot: games, to: "T/b.nsp", now: 10_000 + i });
  const text = fs.readFileSync(path.join(games.dir, HOME, journal.JOURNAL_FILE), "utf8");
  assert.ok(!text.includes(op.id), "nothing of the released move is kept");
  assert.deepEqual(journal.undoneHeld(roots, "incoming"), []);
});

test("every held file is listed with its release, however far back in the journal its move is", async () => {
  const { incoming, games, roots, op } = await undoneOrganize();
  put(games, "T/b.nsp", "b");
  for (let i = 0; i < 150; i++) await journal.recordMove({ action: "organize", fromRoot: incoming, from: `x${i}.nsp`, toRoot: games, to: "T/b.nsp", now: Date.now() + 1000 + i });
  const page = await journal.listJournal(roots, { limit: 100 });
  assert.ok(!page.items.some((o) => o.id === op.id), "the move itself is past the page");
  assert.deepEqual(page.held.map((o) => [o.id, o.from, o.held]), [[op.id, "a.nsp", true]]);
  await journal.releaseUndone(roots, op.id);
  assert.deepEqual((await journal.listJournal(roots, { limit: 100 })).held, []);
});

test("an undo whose follow-up fails still records the hold: the file back in the drop box is not sorted again", async () => {
  const incoming = fresh("incoming");
  const games = fresh("games");
  const roots = [{ key: "games", dir: games.dir }, { key: "incoming", dir: incoming.dir }];
  put(games, "T/a.nsp", "aaaa");
  const op = await journal.recordMove({ action: "organize", fromRoot: incoming, from: "a.nsp", toRoot: games, to: "T/a.nsp" });
  const out = await journal.undoMove(roots, op.id, { after: async () => { throw new Error("patch paths not rewritten"); } });
  assert.ok(has(incoming, "a.nsp"), "the file is back");
  assert.match(out.warning, /patch paths not rewritten/);
  assert.deepEqual(journal.undoneHeld(roots, "incoming").map((h) => h.rel), ["a.nsp"]);
  await assert.rejects(journal.undoMove(roots, op.id), /이미 되돌린/);
});

test("an undo of a move the journal no longer has, by the time the lock is taken, is a 404 and not a crash", async () => {
  const { roots, op } = await undoneOrganize();
  await assert.rejects(journal.undoMove(roots, "0123456789ab"), (err) => err.status === 404);
  await assert.rejects(journal.releaseUndone(roots, "0123456789ab"), (err) => err.status === 404);
  assert.ok(op.id);
});

test("a copy across disks cut short by a stop leaves a marked partial, and the next sweep removes it", async () => {
  // The reviewer's repro (rvtrash2/scratch/exp5.mjs, second step): the partial stayed in the library forever.
  const root = fresh();
  put(root, "src.nsp", "z".repeat(5000));
  fs.mkdirSync(path.join(root.dir, "A"));
  const from = path.join(root.dir, "src.nsp");
  const to = path.join(root.dir, "A/b.nsp");
  const r = crashIn(`let n = 0;
    S._setIo({ link: async () => { if (n++ === 0) throw Object.assign(new Error("x"), { code: "EXDEV" }); process.exit(8); } });
    await S.moveAcross(${JSON.stringify(from)}, ${JSON.stringify(to)});`);
  assert.equal(r.status, 8, r.stderr);
  const left = fs.readdirSync(path.join(root.dir, "A"));
  assert.equal(left.filter((f) => f.endsWith(".json")).length, 1, "the partial has its marker");
  assert.equal(partialsIn(path.join(root.dir, "A")).length, 2);
  const out = await safeMove.sweepPartials([root.dir], { recursive: true });
  assert.deepEqual([out.removed, out.left], [1, []]);
  assert.deepEqual(fs.readdirSync(path.join(root.dir, "A")), [], "partial and marker are gone");
  assert.equal(fs.readFileSync(from, "utf8").length, 5000, "the original was never touched");
});

test("a sweep leaves alone a partial still being copied, one without our marker, and one whose bytes live nowhere else", async () => {
  const root = fresh();
  put(root, "src.nsp", "z".repeat(5000));
  const dir = path.join(root.dir, "A");
  fs.mkdirSync(dir);
  // Someone else's file that happens to share the prefix: no marker, so not ours.
  fs.writeFileSync(path.join(dir, `${safeMove.PARTIAL_PREFIX}0123456789-theirs.nsp`), "T");
  // A copy from a run that died, whose source and target are both gone: it may be the only copy.
  fs.writeFileSync(path.join(dir, `${safeMove.PARTIAL_PREFIX}abcdefabcd-only.nsp`), "ONLY");
  fs.writeFileSync(path.join(dir, `${safeMove.PARTIAL_PREFIX}abcdefabcd.json`), JSON.stringify({ pid: 999999, boot: "gone", startedAt: 1, from: path.join(root.dir, "nowhere"), to: path.join(dir, "only.nsp") }));
  let during = null;
  await safeMove.withPartial(path.join(root.dir, "src.nsp"), path.join(dir, "b.nsp"), async (part) => {
    await fs.promises.writeFile(part, "half");
    during = await safeMove.sweepPartials([root.dir], { recursive: true });
    assert.ok(fs.existsSync(part), "the running copy is untouched");
  });
  assert.equal(during.removed, 0);
  assert.deepEqual(during.left.map((l) => path.basename(l.path)), [`${safeMove.PARTIAL_PREFIX}abcdefabcd-only.nsp`]);
  assert.equal(during.left[0].bytes, 4);
  assert.deepEqual(fs.readdirSync(dir).sort(), [`${safeMove.PARTIAL_PREFIX}0123456789-theirs.nsp`, `${safeMove.PARTIAL_PREFIX}abcdefabcd-only.nsp`, `${safeMove.PARTIAL_PREFIX}abcdefabcd.json`].sort(), "the running copy's partial and marker went with it");
});

test("a partial another live process is copying is left alone; one from this process's earlier run is not", async () => {
  const root = fresh();
  put(root, "src.nsp", "S");
  const dir = path.join(root.dir, "A");
  fs.mkdirSync(dir);
  const mark = (hex, info) => {
    fs.writeFileSync(path.join(dir, `${safeMove.PARTIAL_PREFIX}${hex}-x.nsp`), "P");
    fs.writeFileSync(path.join(dir, `${safeMove.PARTIAL_PREFIX}${hex}.json`), JSON.stringify({ from: path.join(root.dir, "src.nsp"), to: path.join(dir, "x.nsp"), ...info }));
  };
  // The parent of this test is alive and is not this process: another server, mid-copy.
  mark("1111111111", { pid: process.ppid, boot: "other", startedAt: Date.now() - 1000 });
  // A container restart reuses the pid (often 1): same pid, another boot, so it is a dead run of ours.
  mark("2222222222", { pid: process.pid, boot: "before-restart", startedAt: Date.now() - 1000 });
  // Started after the operation that sweeps: never touched.
  mark("3333333333", { pid: 999999, boot: "x", startedAt: Date.now() + 60_000 });
  const out = await safeMove.sweepPartials([dir]);
  assert.equal(out.removed, 1);
  assert.deepEqual(partialsIn(dir).filter((f) => !f.endsWith(".json")).sort(), [`${safeMove.PARTIAL_PREFIX}1111111111-x.nsp`, `${safeMove.PARTIAL_PREFIX}3333333333-x.nsp`]);
});

test("a restore runs the sweep first: a partial left beside its target by an earlier stop goes", async () => {
  const root = fresh();
  put(root, "A/a.nsp", "A");
  const t = await trash.trashItems(root, [{ rel: "A/a.nsp" }], { kind: "game" });
  fs.writeFileSync(path.join(root.dir, "A", `${safeMove.PARTIAL_PREFIX}4444444444-a.nsp`), "PART");
  fs.writeFileSync(path.join(root.dir, "A", `${safeMove.PARTIAL_PREFIX}4444444444.json`), JSON.stringify({ pid: 999999, boot: "old", startedAt: 1, from: path.join(root.dir, HOME, t.entry, "A/a.nsp"), to: path.join(root.dir, "A/a.nsp") }));
  await trash.restoreEntry(root, HOME, t.entry);
  assert.deepEqual(fs.readdirSync(path.join(root.dir, "A")), ["a.nsp"]);
});

test("a restore stopped between link and unlink: the next restore finishes it, even under exactName", async () => {
  // The reviewer's repro (rvtrash2/scratch/exp5.mjs, first step): the same file in the library and the trash, and a retro game refused forever.
  const root = fresh("retro");
  put(root, "roms/md/a.zip", "game-bytes");
  const t = await trash.trashItems(root, [{ rel: "roms/md/a.zip" }], { kind: "retro-game" });
  const r = crashIn(`S._setIo({ link: async (a, b) => { await (await import("node:fs/promises")).link(a, b); process.exit(7); } });
    await T.restoreEntry(${JSON.stringify(root)}, ${JSON.stringify(HOME)}, ${JSON.stringify(t.entry)});`);
  assert.equal(r.status, 7, r.stderr);
  assert.equal(fs.statSync(path.join(root.dir, "roms/md/a.zip")).nlink, 2, "the crash left two names for one file");
  const back = await trash.restoreEntry(root, HOME, t.entry);
  assert.deepEqual(back.items, [{ rel: "roms/md/a.zip", to: "roms/md/a.zip" }]);
  assert.equal(fs.statSync(path.join(root.dir, "roms/md/a.zip")).nlink, 1);
  assert.equal(fs.readFileSync(path.join(root.dir, "roms/md/a.zip"), "utf8"), "game-bytes");
  assert.deepEqual(await trash.listRoot(root), []);
});

test("at start the trash's copy of a file that is also in the library under the same inode or the same bytes is dropped", async () => {
  const root = fresh();
  put(root, "A/linked.nsp", "LINKED");
  put(root, "A/copied.nsp", "COPIED");
  put(root, "A/other.nsp", "OTHER");
  const a = await trash.trashItems(root, [{ rel: "A/linked.nsp" }], { kind: "game" });
  const b = await trash.trashItems(root, [{ rel: "A/copied.nsp" }], { kind: "game" });
  const c = await trash.trashItems(root, [{ rel: "A/other.nsp" }], { kind: "game" });
  // A restore that linked and stopped; a copy across disks that was placed and stopped before the original went.
  fs.linkSync(path.join(root.dir, HOME, a.entry, "A/linked.nsp"), path.join(root.dir, "A/linked.nsp"));
  fs.copyFileSync(path.join(root.dir, HOME, b.entry, "A/copied.nsp"), path.join(root.dir, "A/copied.nsp"));
  const st = fs.statSync(path.join(root.dir, HOME, b.entry, "A/copied.nsp"));
  fs.utimesSync(path.join(root.dir, "A/copied.nsp"), st.atime, st.mtime);
  // Same name, different bytes: a real second file, kept.
  put(root, "A/other.nsp", "OTHE2");
  assert.equal(await trash.dropTwins(root), 2);
  const left = await trash.listRoot(root);
  assert.deepEqual(left.map((e) => e.entry), [c.entry]);
  assert.equal(fs.readFileSync(path.join(root.dir, "A/linked.nsp"), "utf8"), "LINKED");
  assert.equal(fs.readFileSync(path.join(root.dir, "A/copied.nsp"), "utf8"), "COPIED");
});
