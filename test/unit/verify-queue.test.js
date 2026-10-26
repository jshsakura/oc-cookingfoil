import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createVerifyQueue, msUntilHours } from "../../src/meta/verify-queue.js";

// The file check queue against a stub verifier and an in-memory store: what it
// checks first, when it hashes, when it waits, and what it keeps.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "cook-verifyq-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));

const HOUR = 3600_000;

/** catalogStore's shape, in memory. */
function memoryStore(initial = null) {
  let scan = initial ? { at: 1, items: new Map(initial.map((r) => [r.path, r])) } : null;
  return {
    load: () => (scan ? { at: scan.at, items: [...scan.items.values()] } : null),
    replace(items, at) { scan = { at, items: new Map(items.map((r) => [r.path, { ...r }])) }; },
    put(item) { (scan ??= { at: 0, items: new Map() }).items.set(item.path, { ...item }); },
    remove(...ids) { for (const id of ids) scan?.items.delete(id); },
    rows: () => (scan ? Object.fromEntries(scan.items) : {}),
  };
}

let games, verdicts, calls, toolsReady, dl, inUse, verdictChanges, jobs, hooks, knowns;
beforeEach(() => {
  games = fs.mkdtempSync(path.join(root, "games-"));
  verdicts = {};
  calls = [];
  toolsReady = true;
  dl = { active: 0, lastEndedAt: 0 };
  inUse = new Set();
  verdictChanges = 0;
  jobs = [];
  hooks = {};
  knowns = [];
});

function addFile(rel, { size = 100, ageMs = HOUR } = {}) {
  const abs = path.join(games, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, Buffer.alloc(size));
  const t = new Date(Date.now() - ageMs);
  fs.utimesSync(abs, t, t);
  return rel;
}

const catalog = () => fs.readdirSync(games, { recursive: true }).filter((n) => fs.statSync(path.join(games, n)).isFile()).map((rel) => ({ rel, size: fs.statSync(path.join(games, rel)).size }));

function makeQueue(store, opts = {}) {
  return createVerifyQueue({
    gamesDir: games,
    store,
    verifier: {
      tools: async () => (toolsReady ? { bin: "nstool", keys: "k" } : null),
      verify: async (abs, opts) => {
        const { hash } = opts;
        const rel = path.relative(games, abs);
        calls.push({ rel, hash });
        knowns.push(opts.known);
        if (hooks[rel]) return hooks[rel](opts);
        if (verdicts[rel] === "throw") throw new Error("nstool exit 1");
        const verdict = verdicts[rel] ?? "ok";
        return { verdict, reason: verdict, checks: { signature: verdict === "modified" ? "fail" : "pass", hash: hash ? "pass" : "skip" } };
      },
    },
    catalog,
    downloads: () => dl,
    fileInUse: (rel) => inUse.has(rel),
    onVerdict: () => { verdictChanges++; },
    track: (o) => { const j = { o, steps: [], ended: null, step: (n, d) => j.steps.push(d), total() {}, done: (t) => { j.ended = ["done", t]; }, fail: (e) => { j.ended = ["fail", e]; }, discard: () => { j.ended = ["discard"]; } }; jobs.push(j); return j; },
    idleMs: 0,
    autoDelayMs: 0,
    ...opts,
  });
}

async function settle(q) {
  await q.sync();
  await q.idle();
}

test("on the first start every file already there is recorded as seen and gets signatures only, newest first", async () => {
  addFile("old.nsp", { ageMs: 3 * HOUR });
  addFile("new.nsz", { ageMs: HOUR });
  addFile("readme.txt");
  const store = memoryStore();
  const q = makeQueue(store);

  await settle(q);

  assert.deepEqual(calls, [{ rel: "new.nsz", hash: false }, { rel: "old.nsp", hash: false }]);
  assert.deepEqual(Object.keys(store.rows()).sort(), ["new.nsz", "old.nsp"]);
  assert.equal(store.rows()["old.nsp"].verdict, "ok");
  assert.equal(store.rows()["old.nsp"].hashDone, false);
  assert.equal(jobs.length, 1);
  assert.deepEqual(jobs[0].ended, ["done", "2개"]);
});

test("a file that appears after the first start is checked with the whole-file hash", async () => {
  addFile("old.nsp");
  const store = memoryStore();
  const q = makeQueue(store);
  await settle(q);
  calls = [];

  addFile("fresh.xci");
  await settle(q);

  assert.deepEqual(calls, [{ rel: "fresh.xci", hash: true }]);
  assert.equal(store.rows()["fresh.xci"].hashDone, true);
});

test("a restart keeps the records: nothing is checked again and a file added while it was down gets the hash", async () => {
  addFile("old.nsp");
  const store = memoryStore();
  await settle(makeQueue(store));
  calls = [];

  addFile("while-down.nsp");
  const q2 = makeQueue(store);
  await q2.init();
  await settle(q2);

  assert.deepEqual(calls, [{ rel: "while-down.nsp", hash: true }]);
});

test("a replaced file (size changed) is checked again, hash included", async () => {
  addFile("game.nsp", { size: 100 });
  const store = memoryStore();
  const q = makeQueue(store);
  await settle(q);
  calls = [];

  addFile("game.nsp", { size: 200 });
  await settle(q);
  assert.deepEqual(calls, [{ rel: "game.nsp", hash: true }]);
  assert.equal(store.rows()["game.nsp"].size, 200);
});

test("an mtime-only change runs the signatures again and keeps the hash results", async () => {
  addFile("old.nsp");
  const store = memoryStore();
  await settle(makeQueue(store));
  addFile("game.nsp", { size: 200 });
  hooks["game.nsp"] = ({ onHashed }) => { onHashed("aa", true); return { verdict: "ok", reason: "ok", checks: { signature: "pass", hash: "pass" } }; };
  const q = makeQueue(store);
  await settle(q);
  assert.equal(store.rows()["game.nsp"].hashDone, true);
  calls = [];
  knowns = [];

  // Same size, new mtime: a restart (which looks at every file) finds it.
  addFile("game.nsp", { size: 200, ageMs: 2 * HOUR });
  const q2 = makeQueue(store);
  await settle(q2);
  assert.deepEqual(calls, [{ rel: "game.nsp", hash: false }]);
  assert.deepEqual(knowns, [{ aa: true }]);
  assert.equal(store.rows()["game.nsp"].hashDone, true);
  assert.equal(store.rows()["game.nsp"].stale, undefined);
});

test("a renamed file keeps its record instead of being hashed again", async () => {
  addFile("old.nsp");
  const store = memoryStore();
  const gone = memoryStore();
  const q = makeQueue(store, { goneStore: gone });
  await settle(q);
  addFile("game.nsp");
  verdicts["game.nsp"] = "modified";
  await settle(q);
  calls = [];

  fs.mkdirSync(path.join(games, "moved"));
  fs.renameSync(path.join(games, "game.nsp"), path.join(games, "moved/game.nsp"));
  await settle(q);

  assert.deepEqual(calls, []);
  assert.equal(store.rows()["moved/game.nsp"].verdict, "modified");
  assert.equal(store.rows()["moved/game.nsp"].hashDone, true);
  assert.equal(store.rows()["game.nsp"], undefined);
  assert.equal(q.integrityOf("moved/game.nsp"), "modified");
});

test("a file that went away and comes back later, even after a restart, takes its old record back", async () => {
  addFile("keep.nsp");
  const store = memoryStore();
  const gone = memoryStore();
  const q = makeQueue(store, { goneStore: gone });
  await settle(q);
  addFile("game.nsp");
  await settle(q);
  const parked = path.join(root, `parked-${path.basename(games)}`);
  fs.renameSync(path.join(games, "game.nsp"), parked);
  await settle(q);
  assert.equal(store.rows()["game.nsp"], undefined);
  calls = [];

  fs.renameSync(parked, path.join(games, "back.nsp"));
  const q2 = makeQueue(store, { goneStore: gone });
  await settle(q2);
  assert.deepEqual(calls, []);
  assert.equal(store.rows()["back.nsp"].hashDone, true);
  assert.deepEqual(gone.rows(), {});
});

test("when a look lists fewer than half the known files, nothing is forgotten", async () => {
  for (let i = 0; i < 12; i++) addFile(`d${i < 8 ? "/lost" : ""}/g${i}.nsp`);
  const store = memoryStore();
  const q = makeQueue(store);
  await settle(q);
  fs.rmSync(path.join(games, "d/lost"), { recursive: true });
  await settle(q);
  assert.equal(Object.keys(store.rows()).length, 12);

  // A smaller drop is a real removal.
  for (let i = 8; i < 10; i++) fs.rmSync(path.join(games, `d/g${i}.nsp`));
  for (let i = 0; i < 8; i++) addFile(`d/lost/g${i}.nsp`);
  await settle(q);
  assert.equal(Object.keys(store.rows()).length, 10);
});

test("a hash stopped for a download resumes after the NCAs it already read", async () => {
  addFile("old.nsp");
  const store = memoryStore();
  const q = makeQueue(store, { yieldPollMs: 5 });
  await settle(q);
  addFile("big.nsp");
  let first = true;
  hooks["big.nsp"] = async ({ onHashed, signal, known }) => {
    if (!first) return { verdict: "ok", reason: "ok", checks: { signature: "pass", hash: "pass" }, known };
    first = false;
    onHashed("aa", true);
    dl = { active: 1, lastEndedAt: 0 };
    await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
    setTimeout(() => { dl = { active: 0, lastEndedAt: 0 }; }, 20);
    throw Object.assign(new Error("aborted"), { name: "AbortError" });
  };
  await settle(q);
  await new Promise((r) => setTimeout(r, 80));
  await q.idle();
  assert.deepEqual(calls.filter((c) => c.rel === "big.nsp"), [{ rel: "big.nsp", hash: true }, { rel: "big.nsp", hash: true }]);
  assert.deepEqual(knowns.at(-1), { aa: true });
  assert.equal(store.rows()["big.nsp"].hashDone, true);
});

test("a modified or damaged verdict is kept, exposed, and tells the shop to rebuild; a removed file is forgotten", async () => {
  addFile("mod.nsp");
  addFile("fine.nsp");
  verdicts["mod.nsp"] = "modified";
  const store = memoryStore();
  const q = makeQueue(store);
  await settle(q);

  assert.equal(q.integrityOf("mod.nsp"), "modified");
  assert.equal(q.integrityOf("fine.nsp"), null);
  assert.equal(verdictChanges, 1);
  const v = q.view();
  assert.deepEqual(v.counts, { ok: 1, modified: 1, damaged: 0, unchecked: 0, misnamed: 0 });
  assert.deepEqual(v.flagged.map((f) => f.path), ["mod.nsp"]);

  fs.rmSync(path.join(games, "mod.nsp"));
  await settle(q);
  assert.equal(q.integrityOf("mod.nsp"), null);
  assert.equal(store.rows()["mod.nsp"], undefined);
  assert.equal(verdictChanges, 2);
});

test("nothing starts while a console downloads; it resumes once downloads are quiet", async () => {
  addFile("game.nsp");
  dl = { active: 1, lastEndedAt: 0 };
  const q = makeQueue(memoryStore(), { idleMs: 50 });
  await settle(q);
  assert.equal(calls.length, 0);
  assert.equal(q.view().status, "downloads");

  dl = { active: 0, lastEndedAt: Date.now() };
  await new Promise((r) => setTimeout(r, 150));
  await q.idle();
  assert.equal(calls.length, 1);
});

test("a file written in the last minute or being downloaded waits", async () => {
  addFile("landing.nsp", { ageMs: 1000 });
  addFile("busy.nsp");
  inUse.add("busy.nsp");
  const q = makeQueue(memoryStore());
  await settle(q);
  assert.equal(calls.length, 0);
  assert.equal(q.view().pending, 2);
  q.shutdown();
});

test("without nstool or keys nothing runs, and the files stay pending", async () => {
  toolsReady = false;
  addFile("game.nsp");
  const q = makeQueue(memoryStore());
  await settle(q);
  assert.equal(calls.length, 0);
  assert.equal(q.view().status, "tool");
  assert.equal(q.view().pending, 1);
});

test("the full hash pass queues every file that has not had its hash; a recheck starts one over", async () => {
  addFile("a.nsp");
  addFile("b.nsp");
  const store = memoryStore();
  const q = makeQueue(store);
  await settle(q);
  calls = [];

  assert.equal(q.hashAll(), 2);
  await q.idle();
  assert.deepEqual(calls.map((c) => c.hash), [true, true]);
  assert.equal(q.hashAll(), 0);

  calls = [];
  assert.equal(q.recheck("a.nsp"), true);
  await q.idle();
  assert.deepEqual(calls, [{ rel: "a.nsp", hash: true }]);
  assert.equal(q.recheck("nope.nsp"), false);
});

test("after five failures in a row the queue stops until the admin asks again", async () => {
  for (let i = 0; i < 6; i++) { addFile(`f${i}.nsp`, { ageMs: HOUR + i }); verdicts[`f${i}.nsp`] = "throw"; }
  const q = makeQueue(memoryStore());
  await settle(q);
  assert.equal(calls.length, 5);
  assert.equal(q.view().status, "paused");
  assert.equal(jobs[0].ended[0], "fail");

  // The file asked for goes first; the others that failed are tried again after it.
  verdicts["f5.nsp"] = "ok";
  q.recheck("f5.nsp");
  await q.idle();
  assert.deepEqual(calls[5], { rel: "f5.nsp", hash: true });
  assert.equal(q.get("f5.nsp").verdict, "ok");
  assert.equal(calls.length, 11);
  q.shutdown();
});

test("after the stop for failures the queue tries again by itself", async () => {
  for (let i = 0; i < 5; i++) { addFile(`f${i}.nsp`); verdicts[`f${i}.nsp`] = "throw"; }
  const q = makeQueue(memoryStore(), { resumeMs: 30 });
  await settle(q);
  assert.equal(q.view().status, "paused");
  assert.ok(q.view().resumeAt > Date.now() - 1000);
  for (let i = 0; i < 5; i++) verdicts[`f${i}.nsp`] = "ok";
  await new Promise((r) => setTimeout(r, 80));
  await q.idle();
  assert.equal(calls.length, 10);
  assert.equal(q.view().status, "idle");
  assert.equal(q.view().resumeAt, null);
});

test("outside the admin's hours nothing is read; a file the admin asks for goes at once", async () => {
  addFile("a.nsp");
  addFile("b.nsp");
  const q = makeQueue(memoryStore(), { msUntilAllowed: () => HOUR });
  await settle(q);
  assert.equal(calls.length, 0);
  assert.equal(q.view().status, "schedule");

  q.recheck("b.nsp");
  await q.idle();
  assert.deepEqual(calls.map((c) => c.rel), ["b.nsp"]);
  q.shutdown();
});

test("the hours: inside is now, outside waits for the start, a window may run past midnight, off never", () => {
  const at = (h, m = 0) => new Date(2026, 9, 16, h, m);
  assert.equal(msUntilHours("always", at(15)), 0);
  assert.equal(msUntilHours("2-7", at(3)), 0);
  assert.equal(msUntilHours("2-7", at(1, 30)), 30 * 60_000);
  assert.equal(msUntilHours("2-7", at(7)), 19 * HOUR);
  assert.equal(msUntilHours("22-6", at(23)), 0);
  assert.equal(msUntilHours("22-6", at(5)), 0);
  assert.equal(msUntilHours("22-6", at(12)), 10 * HOUR);
  assert.equal(msUntilHours("off", at(3)), Infinity);
});

test("stopping from the activity menu aborts the file in progress and starts nothing until the next library update", async () => {
  addFile("a.nsp", { ageMs: 3 * HOUR });
  addFile("b.nsp", { ageMs: 2 * HOUR });
  addFile("c.nsp", { ageMs: HOUR });
  const store = memoryStore();
  const q = makeQueue(store);
  let first = true;
  hooks["c.nsp"] = async ({ signal }) => {
    if (!first) return { verdict: "ok", reason: "ok", checks: { signature: "pass", hash: "skip" } };
    first = false;
    jobs[0].o.cancel();
    assert.equal(signal.aborted, true);
    throw Object.assign(new Error("aborted"), { name: "AbortError" });
  };

  await settle(q);

  assert.deepEqual(calls.map((c) => c.rel), ["c.nsp"]);
  assert.equal(store.rows()["c.nsp"].verdict, undefined);
  assert.deepEqual(jobs[0].ended, ["discard"]);
  assert.equal(q.view().status, "stopped");
  q.pump();
  await q.idle();
  assert.equal(calls.length, 1);

  q.onLibraryUpdate();
  await new Promise((r) => setTimeout(r, 20));
  await q.idle();
  assert.deepEqual(calls.map((c) => c.rel), ["c.nsp", "c.nsp", "b.nsp", "a.nsp"]);
  assert.equal(q.view().status, "idle");
});

test("each check keeps what the file is, and a file named for another title shows as misnamed", async () => {
  const id = (titleId) => ({ titleId, version: 0, kind: "base", baseTitleId: titleId, titleIds: [titleId] });
  const named = addFile("Game [0100000000010000][v0].nsp");
  const wrong = addFile("Other [0100000000020000][v0].nsp");
  const plain = addFile("no id.nsz");
  hooks[named] = () => ({ verdict: "ok", reason: "ok", checks: {}, identity: id("0100000000010000") });
  hooks[wrong] = () => ({ verdict: "ok", reason: "ok", checks: {}, identity: id("0100000000030000") });
  hooks[plain] = () => ({ verdict: "ok", reason: "ok", checks: {}, identity: id("0100000000040000") });
  const q = makeQueue(memoryStore());
  await settle(q);

  const v = q.view();
  assert.equal(v.counts.misnamed, 1);
  assert.deepEqual(v.flagged.map((f) => [f.path, f.verdict, f.contentId]), [[wrong, "misnamed", "0100000000030000"]]);
  const st = fs.statSync(path.join(games, plain));
  assert.equal(q.identityOf(plain, { size: st.size, mtimeMs: st.mtimeMs }).titleId, "0100000000040000");
  assert.equal(q.identityOf(plain, { size: st.size + 1, mtimeMs: st.mtimeMs }), null, "a changed file is read again");
});

test("a record kept from before identities were read is checked once more, without a hash", async () => {
  const rel = addFile("kept.nsp");
  const st = fs.statSync(path.join(games, rel));
  const store = memoryStore([{ path: rel, size: st.size, mtimeMs: st.mtimeMs, verdict: "ok", reason: "ok", checks: {}, at: 1, wantHash: false, hashDone: false }]);
  hooks[rel] = () => ({ verdict: "ok", reason: "ok", checks: {}, identity: { titleId: "0100000000010000", version: 0, kind: "base", baseTitleId: "0100000000010000", titleIds: ["0100000000010000"] } });
  const q = makeQueue(store);
  await settle(q);
  assert.deepEqual(calls, [{ rel, hash: false }]);
  assert.equal(store.rows()[rel].identity.titleId, "0100000000010000");
  calls = [];
  await settle(q);
  assert.deepEqual(calls, [], "read once");
});

test("files found damaged in one run are told once, together, and again only after they were found fine", async () => {
  for (const rel of ["cut-a.nsp", "cut-b.nsp", "fine.nsp"]) addFile(rel);
  const cut = { verdict: "damaged", reason: "truncated", checks: {}, detail: { present: 0.73, ncas: [{ id: "a".repeat(32), type: "Program" }] } };
  hooks["cut-a.nsp"] = () => cut;
  hooks["cut-b.nsp"] = () => cut;
  const told = [];
  const store = memoryStore();
  const q = makeQueue(store, { onDamaged: (list) => told.push(list.map((f) => f.path).sort()) });
  await settle(q);
  assert.deepEqual(told, [["cut-a.nsp", "cut-b.nsp"]], "one notice for the run");
  assert.deepEqual(q.view().flagged.find((f) => f.path === "cut-a.nsp").detail, cut.detail, "the admin list shows why");

  assert.ok(q.recheck("cut-a.nsp"));
  await settle(q);
  assert.equal(told.length, 1, "still damaged: not told again");

  hooks["cut-a.nsp"] = () => ({ verdict: "ok", reason: "ok", checks: {} });
  q.recheck("cut-a.nsp");
  await settle(q);
  hooks["cut-a.nsp"] = () => cut;
  q.recheck("cut-a.nsp");
  await settle(q);
  assert.deepEqual(told.at(-1), ["cut-a.nsp"], "damaged again after a fine check");
});

test("a damaged record from before detail was kept is read once more and told once", async () => {
  const rel = addFile("old-cut.nsp");
  const st = fs.statSync(path.join(games, rel));
  const store = memoryStore([{ path: rel, size: st.size, mtimeMs: st.mtimeMs, verdict: "damaged", reason: "unreadable", checks: {}, at: 1, wantHash: false, hashDone: false, identity: null }]);
  hooks[rel] = () => ({ verdict: "damaged", reason: "truncated", checks: {}, detail: { present: 0.72, ncas: [] } });
  const told = [];
  const q = makeQueue(store, { onDamaged: (list) => told.push(list.map((f) => f.reason)) });
  await settle(q);
  assert.deepEqual(calls, [{ rel, hash: false }]);
  assert.equal(store.rows()[rel].reason, "truncated");
  assert.deepEqual(told, [["truncated"]]);
  calls = [];
  await settle(q);
  assert.deepEqual(calls, [], "read once");
});
