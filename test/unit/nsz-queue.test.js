import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The NSZ conversion queue against a stub nsz: what it swaps, what it keeps,
// when it waits, and that a stop leaves nothing behind.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "cook-nsz-"));
process.env.COOK_DATA_DIR = path.join(root, "data");
const STUB = path.join(root, "nsz-stub.mjs");
fs.writeFileSync(STUB, `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
const args = process.argv.slice(2);
const out = args[args.indexOf("-o") + 1];
const src = args[args.length - 1];
const mode = process.env.NSZ_STUB_MODE || "ok";
if (process.env.NSZ_STUB_ARGS) fs.writeFileSync(process.env.NSZ_STUB_ARGS, JSON.stringify(args));
const size = fs.statSync(src).size;
const dest = path.join(out, path.basename(src).replace(/\\.nsp$/i, ".nsz").replace(/\\.xci$/i, ".xcz"));
if (mode === "fail" || path.basename(src) === process.env.NSZ_STUB_FAIL) { process.stderr.write("zstd error: something broke"); process.exit(2); }
fs.writeFileSync(dest, Buffer.alloc(mode === "nogain" ? size : Math.floor(size / 2)));
if (mode === "verify") { process.stderr.write("VerificationException: Verification detected hash mismatch!"); process.exit(1); }
if (mode === "touch") fs.appendFileSync(src, "x");
if (mode === "slow") { if (process.env.NSZ_STUB_PID) fs.writeFileSync(process.env.NSZ_STUB_PID, String(process.pid)); setInterval(() => {}, 1000); }
`, { mode: 0o755 });
process.env.COOK_NSZ_BIN = STUB;

const { createNszQueue, WORK_DIR_NAME, KEEP_DIR_NAME } = await import("../../src/meta/nsz-queue.js");
const MIB = 1024 ** 2;
const defaults = () => ({ enabled: true, autoQueue: true, level: 18, threads: 4, workers: 1, minSizeMb: 1, diskFloorGb: 0, keepHours: 0, keepGb: 0, block: false, xci: false });

let games, stateFile, logFile, clock, S, swaps, alerts, inUse, dl, queues = [];
beforeEach(() => {
  games = fs.mkdtempSync(path.join(root, "games-"));
  stateFile = path.join(root, `state-${path.basename(games)}.json`);
  logFile = path.join(root, `log-${path.basename(games)}.jsonl`);
  clock = Date.now();
  S = defaults();
  swaps = [];
  alerts = [];
  inUse = new Set();
  dl = { active: 0, lastEndedAt: 0 };
  delete process.env.NSZ_STUB_MODE;
  delete process.env.NSZ_STUB_ARGS;
  delete process.env.NSZ_STUB_FAIL;
});
after(async () => {
  for (const q of queues) await q.shutdown();
  fs.rmSync(root, { recursive: true, force: true });
});

function make(opts = {}) {
  const q = createNszQueue({
    gamesDir: games, stateFile, logFile, now: () => clock, settings: () => S, lowPriority: false, recentWriteMs: 0, idleMs: 0, killGraceMs: 500,
    downloads: () => dl, fileInUse: (rel) => inUse.has(rel), freeBytes: async () => 1e15,
    onSwapped: (c) => swaps.push(...c), alert: (text, subject) => alerts.push({ text, subject }), autoDelayMs: 10, ...opts,
  });
  queues.push(q);
  return q;
}
const put = (rel, bytes = 2 * MIB) => {
  fs.mkdirSync(path.dirname(path.join(games, rel)), { recursive: true });
  fs.writeFileSync(path.join(games, rel), Buffer.alloc(bytes, 1));
};
const exists = (rel) => fs.existsSync(path.join(games, rel));
const item = (q, rel) => q.view({ limit: 100 }).items.find((i) => i.rel === rel);
async function run(q) {
  await q.init();
  await q.scan();
  q.start();
  await q.pump();
  await q.idle();
}
const until = async (fn, ms = 5000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
};

test("a file is compressed, verified, swapped next to the original, and the bytes saved are counted", async () => {
  put("Game [0100000000010000][v0].nsp");
  process.env.NSZ_STUB_ARGS = path.join(root, "args.json");
  const q = make();
  await run(q);
  assert.ok(!exists("Game [0100000000010000][v0].nsp"));
  assert.ok(exists("Game [0100000000010000][v0].nsz"));
  const i = item(q, "Game [0100000000010000][v0].nsp");
  assert.equal(i.state, "done");
  assert.equal(i.savedBytes, MIB);
  assert.equal(q.totals().savedBytes, MIB);
  assert.deepEqual(swaps.map((s) => s.op), ["remove", "upsert"]);
  const args = JSON.parse(fs.readFileSync(process.env.NSZ_STUB_ARGS, "utf8"));
  assert.equal(args[0], "--keys");
  assert.deepEqual(args.slice(2, 8), ["-C", "-V", "-l", "18", "-t", "4"]);
  assert.ok(!args.includes("-B"), "solid unless block compression is on");
  assert.ok(args[args.indexOf("-o") + 1].startsWith(path.join(games, WORK_DIR_NAME)));
  assert.deepEqual(fs.readdirSync(path.join(games, WORK_DIR_NAME)), []);
  // The queue is kept on disk.
  await q.shutdown();
  assert.equal(JSON.parse(fs.readFileSync(stateFile, "utf8")).items[0].state, "done");
  // An alert says the queue is empty.
  assert.match(alerts.at(-1).text, /모두 처리했습니다/);
});

test("block compression adds -B", async () => {
  put("A.nsp");
  S.block = true;
  process.env.NSZ_STUB_ARGS = path.join(root, "args-b.json");
  await run(make());
  assert.ok(JSON.parse(fs.readFileSync(process.env.NSZ_STUB_ARGS, "utf8")).includes("-B"));
});

test("a verify failure keeps the original and says the source may be damaged", async () => {
  put("A.nsp");
  process.env.NSZ_STUB_MODE = "verify";
  const q = make();
  await run(q);
  assert.ok(exists("A.nsp"));
  assert.ok(!exists("A.nsz"));
  const i = item(q, "A.nsp");
  assert.equal(i.state, "failed");
  assert.match(i.reason, /해시/);
  assert.equal(q.view().failures[0].rel, "A.nsp");
});

test("a compression error keeps the original with a trimmed reason", async () => {
  put("A.nsp");
  process.env.NSZ_STUB_MODE = "fail";
  const q = make();
  await run(q);
  assert.ok(exists("A.nsp"));
  const i = item(q, "A.nsp");
  assert.equal(i.state, "failed");
  assert.match(i.reason, /압축하지 못했습니다.*zstd error/);
  assert.ok(i.reason.length <= 400);
});

test("a result no smaller than the original is refused", async () => {
  put("A.nsp");
  process.env.NSZ_STUB_MODE = "nogain";
  const q = make();
  await run(q);
  assert.ok(exists("A.nsp") && !exists("A.nsz"));
  assert.match(item(q, "A.nsp").reason, /줄어들지 않습니다/);
});

test("a source that changed while it was compressed waits for later and is kept", async () => {
  put("A.nsp");
  process.env.NSZ_STUB_MODE = "touch";
  const q = make();
  await run(q);
  assert.ok(exists("A.nsp") && !exists("A.nsz"));
  const i = item(q, "A.nsp");
  assert.equal(i.state, "busy");
  assert.ok(i.retryAt > Date.now());
});

test("a file being downloaded is left alone and tried later", async () => {
  put("A.nsp");
  inUse.add("A.nsp");
  process.env.NSZ_STUB_ARGS = path.join(root, "args-never.json");
  fs.rmSync(process.env.NSZ_STUB_ARGS, { force: true });
  const q = make();
  await run(q);
  assert.equal(item(q, "A.nsp").state, "busy");
  assert.ok(!fs.existsSync(process.env.NSZ_STUB_ARGS), "nsz never ran");
  assert.ok(exists("A.nsp"));
});

test("a .nsz already beside the original fails without touching either", async () => {
  put("A.nsp");
  fs.writeFileSync(path.join(games, "A.nsz"), "old");
  const q = make();
  await run(q);
  assert.equal(item(q, "A.nsp").state, "failed");
  assert.match(item(q, "A.nsp").reason, /이미 있습니다/);
  assert.equal(fs.readFileSync(path.join(games, "A.nsz"), "utf8"), "old");
});

test("a file starts when its own size fits in the free space, and the run pauses when it does not", async () => {
  put("A.nsp");
  const q = make({ freeBytes: async () => 512 * 1024 ** 2 });
  await run(q);
  const v = q.view();
  assert.equal(v.running, false);
  assert.equal(v.pausedReason, "disk");
  assert.equal(item(q, "A.nsp").state, "waiting");
  assert.match(alerts.at(-1).text, /작업 공간이 모자라/);
});

test("with room for the file and no floor, a small disk still converts", async () => {
  put("A.nsp");
  const q = make({ freeBytes: async () => 2 * 1024 ** 3 });
  await run(q);
  assert.equal(item(q, "A.nsp").state, "done");
});

test("no new file starts while a console downloads; one already running finishes", async () => {
  put("A.nsp");
  put("B.nsp", 3 * MIB);
  dl = { active: 1, lastEndedAt: 0 };
  const q = make({ idleMs: 150 });
  await q.init();
  await q.scan();
  q.start();
  await q.pump();
  await new Promise((r) => setTimeout(r, 100));
  let v = q.view();
  assert.equal(v.waitingFor, "downloads");
  assert.equal(v.totals.running + v.totals.done, 0);
  // The download ends: after the quiet time the queue goes on.
  dl = { active: 0, lastEndedAt: Date.now() };
  await until(() => q.totals().done === 2);
  v = q.view();
  assert.equal(v.waitingFor, null);
  assert.ok(exists("A.nsz") && exists("B.nsz"));
});

test("a download that starts during a conversion does not cut it", async () => {
  put("A.nsp");
  process.env.NSZ_STUB_MODE = "slow";
  const q = make();
  await q.init();
  await q.scan();
  q.start();
  await until(() => q.totals().running === 1);
  dl = { active: 2, lastEndedAt: 0 };
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(q.totals().running, 1);
  await q.pause();
});

test("pause stops nsz, drops its partial output and puts the file back to waiting", async () => {
  put("A.nsp");
  process.env.NSZ_STUB_MODE = "slow";
  process.env.NSZ_STUB_PID = path.join(root, "pid");
  fs.rmSync(process.env.NSZ_STUB_PID, { force: true });
  const q = make();
  await q.init();
  await q.scan();
  q.start();
  await until(() => fs.existsSync(process.env.NSZ_STUB_PID) && q.view().active[0]?.outBytes > 0);
  const pid = Number(fs.readFileSync(process.env.NSZ_STUB_PID, "utf8"));
  await q.pause();
  assert.equal(item(q, "A.nsp").state, "waiting");
  assert.deepEqual(fs.readdirSync(path.join(games, WORK_DIR_NAME)), []);
  assert.throws(() => process.kill(pid, 0), "the child is gone");
  assert.ok(exists("A.nsp") && !exists("A.nsz"));
  delete process.env.NSZ_STUB_PID;
});

test("on start a running file waits again and the work folder is emptied", async () => {
  put("A.nsp");
  fs.mkdirSync(path.join(games, WORK_DIR_NAME, "abcdefabcdef"), { recursive: true });
  fs.writeFileSync(path.join(games, WORK_DIR_NAME, "abcdefabcdef", "A.nsz"), "partial");
  fs.writeFileSync(stateFile, JSON.stringify({ version: 1, running: false, items: [{ id: "abcdefabcdef", rel: "A.nsp", kind: "nsp", size: 2 * MIB, state: "running", startedAt: 1 }] }));
  const q = make();
  await q.init();
  assert.equal(item(q, "A.nsp").state, "waiting");
  assert.ok(!fs.existsSync(path.join(games, WORK_DIR_NAME)));
  assert.equal(JSON.parse(fs.readFileSync(stateFile, "utf8")).items[0].state, "waiting");
});

test("new library files at least the minimum size are queued by themselves; small ones are not", async () => {
  S.minSizeMb = 100;
  const lib = [{ rel: "Big.nsp", size: 200 * MIB, name: "Big Game", titleId: "0100000000020000", baseTitleId: "0100000000020000" }, { rel: "Small.nsp", size: 5 * MIB }, { rel: "Big.nsz", size: 300 * MIB }];
  const q = make({ catalog: () => lib });
  await q.init();
  // Paused by the admin, so the new file only waits (an idle queue would start it).
  await q.pause();
  q.onLibraryUpdate();
  await until(() => q.view().total === 1);
  const i = q.view().items[0];
  assert.deepEqual([i.rel, i.name, i.titleId, i.state], ["Big.nsp", "Big Game", "0100000000020000", "waiting"]);
  // Off: nothing more is added.
  S.autoQueue = false;
  lib.push({ rel: "Big2.nsp", size: 200 * MIB });
  q.onLibraryUpdate();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(q.view().total, 1);
});

test("a removed file is not queued again by itself, but a library scan brings it back", async () => {
  put("A.nsp");
  const q = make({ catalog: () => [{ rel: "A.nsp", size: 2 * MIB }] });
  await q.init();
  await q.scan();
  assert.ok(await q.remove(item(q, "A.nsp").id));
  q.onLibraryUpdate();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(q.view().total, 0);
  assert.equal((await q.scan()).added, 1);
});

test("XCI files are left out unless that setting is on", async () => {
  put("A.xci");
  put("B.nsp");
  const q = make();
  await q.init();
  await q.scan();
  assert.deepEqual(q.view().items.map((i) => i.rel), ["B.nsp"]);
  S.xci = true;
  await q.scan();
  q.start();
  await q.pump();
  await q.idle();
  assert.ok(exists("A.xcz") && !exists("A.xci"));
});

test("the list filters, pages, moves to the front, retries and clears finished rows", async () => {
  for (let n = 0; n < 5; n++) put(`G${n}.nsp`, (2 + n) * MIB);
  const q = make();
  await q.init();
  const r = await q.scan();
  assert.equal(r.added, 5);
  assert.deepEqual(q.view().items.map((i) => i.rel), ["G4.nsp", "G3.nsp", "G2.nsp", "G1.nsp", "G0.nsp"], "largest first");
  const page = q.view({ offset: 2, limit: 2 });
  assert.deepEqual([page.total, page.items.length, page.items[0].rel], [5, 2, "G2.nsp"]);
  assert.ok(q.moveTop(item(q, "G0.nsp").id));
  assert.equal(q.view().items[0].rel, "G0.nsp");
  assert.deepEqual(await q.preview(), { files: 5, bytes: 20 * MIB });
  process.env.NSZ_STUB_MODE = "fail";
  q.start();
  await q.pump();
  await q.idle();
  // Five nsz failures in a row pause the run.
  assert.equal(q.view().pausedReason, "failures");
  assert.equal(q.view({ filter: "failed" }).total, 5);
  delete process.env.NSZ_STUB_MODE;
  assert.equal(q.retry("all"), 5);
  q.start();
  await q.pump();
  await q.idle();
  assert.equal(q.view({ filter: "done" }).total, 5);
  assert.equal(await q.clearFinished(), 5);
  assert.equal(q.view().total, 0);
});

test("turned off, nothing starts", async () => {
  put("A.nsp");
  S.enabled = false;
  const q = make();
  await run(q);
  assert.equal(q.view().status, "off");
  assert.ok(exists("A.nsp") && !exists("A.nsz"));
});

test("a run ends once the queue is empty and nothing keeps going", async () => {
  put("A.nsp");
  const q = make();
  await run(q);
  assert.equal(item(q, "A.nsp").state, "done");
  const v = q.view();
  assert.deepEqual([v.running, v.status, v.pausedReason], [false, "idle", null]);
  await until(() => fs.existsSync(stateFile) && JSON.parse(fs.readFileSync(stateFile, "utf8")).running === false);
});

test("a new library file starts an idle queue; an admin pause keeps it stopped", async () => {
  const lib = [];
  const q = make({ catalog: () => lib });
  await q.init();
  put("A.nsp");
  lib.push({ rel: "A.nsp", size: 2 * MIB });
  q.onLibraryUpdate();
  await until(() => item(q, "A.nsp")?.state === "done");
  await q.idle();
  assert.equal(q.view().status, "idle");
  await q.pause();
  put("B.nsp");
  lib.push({ rel: "B.nsp", size: 2 * MIB });
  q.onLibraryUpdate();
  await until(() => item(q, "B.nsp"));
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual([item(q, "B.nsp").state, q.view().status], ["waiting", "paused"]);
});

test("a failed file is never tried again by itself, only by 재시도", async () => {
  put("A.nsp");
  const lib = [{ rel: "A.nsp", size: 2 * MIB }];
  const q = make({ catalog: () => lib });
  process.env.NSZ_STUB_MODE = "nogain";
  await run(q);
  assert.equal(item(q, "A.nsp").state, "failed");
  delete process.env.NSZ_STUB_MODE;
  // Library rebuilds and a library scan leave it failed.
  q.onLibraryUpdate();
  await new Promise((r) => setTimeout(r, 50));
  await q.scan();
  await q.idle();
  assert.equal(item(q, "A.nsp").state, "failed");
  assert.match(item(q, "A.nsp").reason, /줄어들지 않습니다/);
  assert.equal(q.retry(item(q, "A.nsp").id), 1);
  await q.pump();
  await q.idle();
  assert.equal(item(q, "A.nsp").state, "done");
});

// ── 선택한 것만 변환 ─────────────────────────────────────────────────────
test("a selected run converts only the chosen rows and then stops; the rest keep waiting", async () => {
  for (const n of ["A", "B", "C"]) put(`${n}.nsp`);
  const q = make();
  await q.init();
  await q.scan();
  assert.equal(q.runSelected([item(q, "A.nsp").id, item(q, "C.nsp").id, "0123456789ab"]), 2);
  await q.pump();
  await q.idle();
  assert.deepEqual(["A.nsp", "B.nsp", "C.nsp"].map((r) => item(q, r).state), ["done", "waiting", "done"]);
  const v = q.view();
  assert.deepEqual([v.running, v.status, v.only], [false, "idle", 0]);
  assert.equal(q.runSelected(["0123456789ab"]), 0, "nothing waiting among them");
});

// ── kept originals ───────────────────────────────────────────────────
const keptFile = (q, rel) => path.join(games, KEEP_DIR_NAME, item(q, rel).id, path.basename(rel));
const logLines = () => fs.readFileSync(logFile, "utf8").trim().split("\n").map((l) => JSON.parse(l));

test("with a keep time the original moves into the keep folder, the library hears of both and the log says converted", async () => {
  S.keepHours = 6;
  put("Dir/A.nsp");
  const q = make();
  await run(q);
  assert.ok(!exists("Dir/A.nsp") && exists("Dir/A.nsz"));
  assert.ok(fs.existsSync(keptFile(q, "Dir/A.nsp")));
  const i = item(q, "Dir/A.nsp");
  assert.deepEqual([i.state, i.keptAt, i.keptBytes, i.keepUntil], ["done", clock, 2 * MIB, clock + 6 * 3600_000]);
  assert.deepEqual(swaps, [{ rel: "Dir/A.nsp", op: "remove" }, { rel: "Dir/A.nsz", op: "upsert" }]);
  assert.deepEqual(q.view().kept.count, 1);
  const [line] = logLines();
  assert.deepEqual([line.event, line.from, line.to, line.sizeBefore, line.sizeAfter], ["converted", "Dir/A.nsp", "Dir/A.nsz", 2 * MIB, MIB]);
  // A library scan never queues the kept original.
  assert.equal((await q.scan()).added, 0);
});

test("끝난 것 삭제 clears a kept row and deletes its original with it", async () => {
  S.keepHours = 6;
  put("A.nsp");
  const q = make();
  await run(q);
  const kept = keptFile(q, "A.nsp");
  assert.equal(await q.clearFinished(), 1);
  assert.ok(!fs.existsSync(path.dirname(kept)) && exists("A.nsz"));
  assert.deepEqual([q.view().total, q.view().kept.count], [0, 0]);
  const last = logLines().at(-1);
  assert.deepEqual([last.event, last.reason], ["original-deleted", "cleared"]);
});

test("빼기 on a kept row deletes its original", async () => {
  S.keepHours = 6;
  put("A.nsp");
  const q = make();
  await run(q);
  const kept = keptFile(q, "A.nsp");
  assert.ok(await q.remove(item(q, "A.nsp").id));
  assert.ok(!fs.existsSync(kept) && exists("A.nsz"));
  assert.equal(logLines().at(-1).reason, "removed");
});

test("a keep time of 0 deletes the original at once", async () => {
  put("A.nsp");
  const q = make();
  await run(q);
  assert.ok(!exists("A.nsp") && exists("A.nsz"));
  assert.ok(!fs.existsSync(path.join(games, KEEP_DIR_NAME)));
  assert.equal(item(q, "A.nsp").keptAt, undefined);
});

test("a kept original past its time is deleted, its row leaves the list and the log keeps it", async () => {
  S.keepHours = 6;
  put("A.nsp");
  const q = make();
  await run(q);
  const kept = keptFile(q, "A.nsp");
  assert.equal(await q.purgeDue(), 0, "not yet");
  clock += 6 * 3600_000 + 1;
  assert.equal(await q.purgeDue(), 1);
  assert.ok(!fs.existsSync(kept) && exists("A.nsz"));
  assert.equal(q.view().total, 0);
  const last = logLines().at(-1);
  assert.deepEqual([last.event, last.reason, last.rel], ["original-deleted", "age", "A.nsp"]);
  assert.deepEqual(q.logPage({ q: "a.nsp" }).items.map((e) => e.event), ["original-deleted", "converted"]);
});

test("on start the kept originals past their time are deleted", async () => {
  S.keepHours = 6;
  put("A.nsp");
  const q = make();
  await run(q);
  const kept = keptFile(q, "A.nsp");
  await q.shutdown();
  clock += 7 * 3600_000;
  const q2 = make();
  await q2.init();
  assert.ok(!fs.existsSync(kept));
  assert.equal(q2.view().total, 0);
});

test("over the size cap the oldest kept original goes first", async () => {
  S.keepHours = 6;
  S.keepGb = (3 * MIB) / 1024 ** 3;
  put("A.nsp", 2 * MIB);
  const q = make();
  await run(q);
  clock += 1000;
  put("B.nsp", 2 * MIB);
  await q.scan();
  q.start();
  await q.pump();
  await q.idle();
  assert.equal(item(q, "A.nsp"), undefined);
  assert.ok(fs.existsSync(keptFile(q, "B.nsp")));
  assert.equal(logLines().find((l) => l.event === "original-deleted").reason, "cap");
});

test("short of space, kept originals are deleted oldest first before the run pauses", async () => {
  S.keepHours = 6;
  put("A.nsp");
  let low = false;
  // Free space is short exactly while an original is kept.
  const q = make({ freeBytes: async () => (low && fs.readdirSync(path.join(games, KEEP_DIR_NAME)).length ? 0 : 1e15) });
  await run(q);
  low = true;
  put("B.nsp");
  await q.scan();
  q.start();
  await q.pump();
  await q.idle();
  assert.equal(item(q, "A.nsp"), undefined);
  assert.equal(item(q, "B.nsp").state, "done", "converted after making room");
  assert.equal(logLines().find((l) => l.event === "original-deleted").reason, "space");
});

test("지금 비우기 deletes every kept original", async () => {
  S.keepHours = 6;
  put("A.nsp");
  put("B.nsp");
  const q = make();
  await run(q);
  assert.deepEqual(await q.purgeKept(), { removed: 2, bytes: 4 * MIB });
  assert.deepEqual(fs.readdirSync(path.join(games, KEEP_DIR_NAME)), []);
  assert.equal(q.view().kept.count, 0);
});

test("a failed file keeps its original, is marked failed and the queue goes on with the next", async () => {
  put("A.nsp", 3 * MIB);
  put("B.nsp", 2 * MIB);
  process.env.NSZ_STUB_FAIL = "A.nsp";
  const q = make();
  await run(q);
  assert.deepEqual([item(q, "A.nsp").state, item(q, "B.nsp").state], ["failed", "done"]);
  assert.ok(exists("A.nsp") && !exists("A.nsz"), "the original is untouched");
  assert.ok(!exists("B.nsp") && exists("B.nsz"));
  assert.equal(q.view().pausedReason, null, "one failure does not pause the run");
});

test("a failure goes to the log too", async () => {
  put("A.nsp");
  process.env.NSZ_STUB_MODE = "fail";
  await run(make());
  const [line] = logLines();
  assert.equal(line.event, "failed");
  assert.match(line.reason, /압축하지 못했습니다/);
});

test("a lost state file does not delete kept originals until they pass the keep time", async () => {
  S.keepHours = 6;
  put("A.nsp");
  const q = make();
  await run(q);
  const kept = keptFile(q, "A.nsp");
  await q.shutdown();
  fs.rmSync(stateFile);
  await make().init();
  assert.ok(fs.existsSync(kept));
  clock += 7 * 3600_000;
  await make().init();
  assert.ok(!fs.existsSync(kept));
});

test("with the keep folder missing at start (the disk not mounted yet) the kept records stay", async () => {
  S.keepHours = 6;
  put("A.nsp");
  const q = make();
  await run(q);
  const kept = keptFile(q, "A.nsp");
  await q.shutdown();
  const keepDir = path.join(games, KEEP_DIR_NAME), aside = `${games}-aside`;
  fs.renameSync(keepDir, aside);
  const q2 = make();
  await q2.init();
  assert.ok(item(q2, "A.nsp")?.keptAt);
  await q2.shutdown();
  fs.renameSync(aside, keepDir);
  const q3 = make();
  await q3.init();
  assert.ok(fs.existsSync(kept));
  assert.ok(item(q3, "A.nsp")?.keptAt);
});
