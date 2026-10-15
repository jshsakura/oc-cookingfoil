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
if (mode === "fail") { process.stderr.write("zstd error: something broke"); process.exit(2); }
fs.writeFileSync(dest, Buffer.alloc(mode === "nogain" ? size : Math.floor(size / 2)));
if (mode === "verify") { process.stderr.write("VerificationException: Verification detected hash mismatch!"); process.exit(1); }
if (mode === "touch") fs.appendFileSync(src, "x");
if (mode === "slow") { if (process.env.NSZ_STUB_PID) fs.writeFileSync(process.env.NSZ_STUB_PID, String(process.pid)); setInterval(() => {}, 1000); }
`, { mode: 0o755 });
process.env.COOK_NSZ_BIN = STUB;

const { createNszQueue, WORK_DIR_NAME } = await import("../../src/meta/nsz-queue.js");
const MIB = 1024 ** 2;
const defaults = () => ({ enabled: true, autoQueue: true, level: 18, threads: 4, workers: 1, minSizeMb: 1, diskFloorGb: 0, block: false, xci: false });

let games, stateFile, S, swaps, alerts, inUse, dl, queues = [];
beforeEach(() => {
  games = fs.mkdtempSync(path.join(root, "games-"));
  stateFile = path.join(root, `state-${path.basename(games)}.json`);
  S = defaults();
  swaps = [];
  alerts = [];
  inUse = new Set();
  dl = { active: 0, lastEndedAt: 0 };
  delete process.env.NSZ_STUB_MODE;
  delete process.env.NSZ_STUB_ARGS;
});
after(async () => {
  for (const q of queues) await q.shutdown();
  fs.rmSync(root, { recursive: true, force: true });
});

function make(opts = {}) {
  const q = createNszQueue({
    gamesDir: games, stateFile, settings: () => S, lowPriority: false, recentWriteMs: 0, idleMs: 0, killGraceMs: 500,
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

test("below the free space floor the run pauses with the reason and an alert", async () => {
  put("A.nsp");
  S.diskFloorGb = 150;
  const q = make({ freeBytes: async () => 10 * 1024 ** 3 });
  await run(q);
  const v = q.view();
  assert.equal(v.running, false);
  assert.equal(v.pausedReason, "disk");
  assert.equal(item(q, "A.nsp").state, "waiting");
  assert.match(alerts.at(-1).text, /남은 공간/);
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
  assert.equal(q.clearFinished(), 5);
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
