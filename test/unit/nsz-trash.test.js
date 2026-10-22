import { render } from "../../src/helpers/alert-messages.js";
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// After a conversion whose output verified, the original is deleted; with a
// keep time it waits in the keep folder and then goes to the trash. The free
// space floor pauses the queue instead of deleting anything to make room.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "cook-nsz-trash-"));
process.env.COOK_DATA_DIR = path.join(root, "data");
const STUB = path.join(root, "nsz-stub.mjs");
fs.writeFileSync(STUB, `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
const args = process.argv.slice(2);
const out = args[args.indexOf("-o") + 1];
const src = args[args.length - 1];
const size = fs.statSync(src).size;
const base = path.basename(src);
// BADEXIT: verify fails and nsz says so. BADQUIET: nsz exits 0 but its output reports a mismatch. EMPTY: a 0 byte output.
if (base.startsWith("BADEXIT")) { console.error("VerificationException: hash mismatch"); process.exit(1); }
fs.writeFileSync(path.join(out, base.replace(/\\.nsp$/i, ".nsz")), Buffer.alloc(base.startsWith("EMPTY") ? 0 : Math.floor(size / 2)));
if (base.startsWith("BADQUIET")) console.log("Verification failed: hash mismatch");
`, { mode: 0o755 });
process.env.COOK_NSZ_BIN = STUB;

const { createNszQueue, KEEP_DIR_NAME } = await import("../../src/meta/nsz-queue.js");
const trash = await import("../../src/library/trash.js");
const MIB = 1024 ** 2;
const GIB = 1024 ** 3;

let games, S, clock, alerts;
const queues = [];
beforeEach(() => {
  games = fs.mkdtempSync(path.join(root, "games-"));
  S = { enabled: true, autoQueue: true, level: 18, threads: 4, workers: 1, minSizeMb: 1, diskFloorGb: 0, keepHours: 0, keepGb: 0, block: false, xci: false };
  clock = Date.now();
  alerts = [];
});
after(async () => {
  for (const q of queues) await q.shutdown();
  fs.rmSync(root, { recursive: true, force: true });
});

function make(opts = {}) {
  const q = createNszQueue({
    gamesDir: games, stateFile: path.join(games, "..", `${path.basename(games)}.json`), now: () => clock, settings: () => S, lowPriority: false,
    recentWriteMs: 0, idleMs: 0, killGraceMs: 500, freeBytes: async () => 1e15,
    alert: (text, subject) => alerts.push({ text: render(text, "ko"), subject }), autoDelayMs: 10, ...opts,
  });
  queues.push(q);
  return q;
}
const put = (rel, bytes = 2 * MIB, fill = 7) => {
  fs.mkdirSync(path.dirname(path.join(games, rel)), { recursive: true });
  fs.writeFileSync(path.join(games, rel), Buffer.alloc(bytes, fill));
};
const exists = (rel) => fs.existsSync(path.join(games, rel));
const gamesRoot = () => ({ key: "games", dir: games });
async function run(q) {
  await q.init();
  await q.scan();
  q.start();
  await q.pump();
  await q.idle();
}

test("a verified conversion deletes the original: nothing left on disk, nothing in the trash, and the log says so", async () => {
  put("Dir/A.nsp", 2 * MIB, 9);
  const changes = [];
  const q = make({ onSwapped: (c) => changes.push(...c) });
  await run(q);
  assert.ok(!exists("Dir/A.nsp") && exists("Dir/A.nsz"));
  assert.deepEqual(await trash.listRoot(gamesRoot()), [], "the trash is not used");
  assert.ok(!exists(KEEP_DIR_NAME) || fs.readdirSync(path.join(games, KEEP_DIR_NAME)).length === 0, "nothing kept");
  assert.deepEqual(changes, [{ rel: "Dir/A.nsp", op: "remove" }, { rel: "Dir/A.nsz", op: "upsert" }], "the library hears of the removal");
  const events = q.logPage().items.map((e) => [e.event, e.rel, e.sizeBefore, e.reason ?? null]);
  assert.deepEqual(events, [["original-deleted", "Dir/A.nsp", 2 * MIB, "converted"], ["converted", "Dir/A.nsp", 2 * MIB, null]]);
});

for (const [name, why] of [["BADEXIT.nsp", "nsz fails the verify"], ["BADQUIET.nsp", "nsz exits 0 but reports a mismatch"], ["EMPTY.nsp", "the output is 0 bytes"]]) {
  test(`the original stays untouched when ${why}`, async () => {
    put(name, 2 * MIB, 5);
    const q = make();
    await run(q);
    assert.deepEqual(fs.readFileSync(path.join(games, name)), Buffer.alloc(2 * MIB, 5), "the original is where it was, whole");
    assert.ok(!exists(name.replace(/\.nsp$/, ".nsz")), "no output next to it");
    assert.deepEqual(await trash.listRoot(gamesRoot()), []);
    assert.equal(q.view().items.find((i) => i.rel === name).state, "failed");
  });
}

test("a failed rename of the output leaves the original in place", async () => {
  put("R.nsp", 2 * MIB, 4);
  const q = make();
  await q.init();
  await q.scan();
  const realRename = fs.promises.rename;
  // The swap into place fails: fs/promises is the same object the queue calls.
  fs.promises.rename = async (from, to) => {
    if (String(to).endsWith("R.nsz")) throw new Error("EXDEV: rename failed");
    return realRename(from, to);
  };
  try {
    q.start();
    await q.pump();
    await q.idle();
  } finally {
    fs.promises.rename = realRename;
  }
  assert.deepEqual(fs.readFileSync(path.join(games, "R.nsp")), Buffer.alloc(2 * MIB, 4));
  assert.ok(!exists("R.nsz"));
  assert.equal(q.view().items.find((i) => i.rel === "R.nsp").state, "failed");
});

test("with a keep time the original is kept, not deleted", async () => {
  S.keepHours = 6;
  put("Keep.nsp", 2 * MIB, 6);
  await run(make());
  const [id] = fs.readdirSync(path.join(games, KEEP_DIR_NAME));
  assert.deepEqual(fs.readFileSync(path.join(games, KEEP_DIR_NAME, id, "Keep.nsp")), Buffer.alloc(2 * MIB, 6));
  assert.deepEqual(await trash.listRoot(gamesRoot()), []);
});

test("a kept original past its time, over the cap, emptied now or removed with its row goes to the trash", async () => {
  S.keepHours = 6;
  put("A.nsp");
  put("B.nsp");
  put("C.nsp");
  const q = make();
  await run(q);
  assert.equal(fs.readdirSync(path.join(games, KEEP_DIR_NAME)).length, 3);
  clock += 6 * 3600_000 + 1;
  await q.purgeDue();
  const held = await trash.listRoot(gamesRoot());
  assert.equal(held.length, 3, "nothing is deleted: all three are in the trash");
  assert.deepEqual(held.map((e) => e.items[0].rel).sort(), ["A.nsp", "B.nsp", "C.nsp"], "each under the path it had in the library");
  assert.ok(held.every((e) => e.action === "nsz-kept-age"));
  assert.deepEqual(fs.readdirSync(path.join(games, KEEP_DIR_NAME)), []);

  clock = Date.now();
  put("D.nsp");
  await run(q);
  assert.deepEqual(await q.purgeKept(), { removed: 1, bytes: 2 * MIB });
  assert.equal((await trash.listRoot(gamesRoot())).length, 4);
});

test("below the free space floor the queue pauses, deletes nothing and says what the trash holds", async () => {
  put("Old.nsp", 3 * MIB);
  await trash.trashItems(gamesRoot(), [{ rel: "Old.nsp" }], { kind: "game" });
  const before = await trash.listRoot(gamesRoot());
  assert.equal(before.length, 1);
  S.keepHours = 6;
  put("Kept.nsp");
  const q = make();
  await run(q);
  S.diskFloorGb = 50;
  put("Next.nsp");
  const low = make({ freeBytes: async () => 10 * GIB });
  await run(low);
  const v = low.view();
  assert.deepEqual([v.running, v.pausedReason], [false, "disk"]);
  assert.ok(exists("Next.nsp") && !exists("Next.nsz"), "nothing converted");
  assert.equal(fs.readdirSync(path.join(games, KEEP_DIR_NAME)).length, 1, "the kept original stays kept");
  assert.equal((await trash.listRoot(gamesRoot())).length, 1, "the trash is left as it is");
  assert.equal(v.trash.bytes, 3 * MIB);
  assert.match(alerts.at(-1).text, /휴지통/);
  assert.match(alerts.at(-1).text, /비우면/);
});

test("the pause says what kept originals hold, and never promises space from an empty trash", async () => {
  S.keepHours = 6;
  put("Kept2.nsp", 2 * MIB);
  const first = make();
  await run(first);
  // Its state (the kept original) is on disk before the next queue reads it.
  await first.shutdown();
  S.diskFloorGb = 50;
  put("Next2.nsp");
  const low = make({ freeBytes: async () => 10 * GIB, trashBytes: async () => 0 });
  await run(low);
  const v = low.view();
  assert.equal(v.pausedReason, "disk");
  assert.equal(v.kept.bytes, 2 * MIB);
  assert.equal(v.trash.bytes, 0);
  const text = alerts.at(-1).text;
  assert.match(text, /보관 중인 변환 원본에/);
  assert.match(text, /휴지통은 비어 있고/);
  assert.doesNotMatch(text, /휴지통에 [^,.]*가 있으며/, "no promise that an empty trash frees space");
});

test("a run that keeps its originals does not say they are in the trash", async () => {
  S.keepHours = 6;
  put("K3.nsp");
  await run(make());
  const drained = alerts.find((a) => a.subject.startsWith("drained-"));
  assert.ok(drained);
  assert.doesNotMatch(drained.text, /원본은 휴지통에 있어/);
  assert.match(drained.text, /보관/);
});

test("the trash bytes the pause counts are the ones on the games folder's own disk", async () => {
  const service = await import("../../src/library/trash-service.js");
  const g = { key: "games", dir: games };
  const inc = { key: "incoming", dir: path.join(games, "incoming") };
  put("incoming/i.nsp", 1 * MIB);
  put("own.nsp", 2 * MIB);
  put("usb/far.nsp", 4 * MIB);
  await trash.trashItems(inc, [{ rel: "i.nsp" }], { kind: "game" });
  await trash.trashItems(g, [{ rel: "own.nsp" }], { kind: "game" });
  const far = await trash.trashItems(g, [{ rel: "usb/far.nsp" }], { kind: "game" });
  // As if usb/ were another disk whose trash lives on it.
  fs.mkdirSync(path.join(games, "usb", ".cookingfoil-trash"), { recursive: true });
  fs.renameSync(path.join(games, ".cookingfoil-trash", far.entry), path.join(games, "usb", ".cookingfoil-trash", far.entry.split("/")[0] + "-x"));
  fs.mkdirSync(path.join(games, "usb", ".cookingfoil-trash", far.entry.split("/")[0]), { recursive: true });
  fs.renameSync(path.join(games, "usb", ".cookingfoil-trash", far.entry.split("/")[0] + "-x"), path.join(games, "usb", ".cookingfoil-trash", far.entry));
  fs.writeFileSync(path.join(games, ".cookingfoil-trash", "homes.json"), JSON.stringify(["usb/.cookingfoil-trash"]));
  const usb = path.join(games, "usb");
  const devOf = (p) => (p === usb || p.startsWith(usb + path.sep) ? 2 : 1);
  assert.equal(await service.bytesOnDisk(games, [g, inc], devOf), 3 * MIB, "the drop box's trash counts, the other disk's does not");
});

test("an orphan kept folder goes to the trash under its real hidden path, and a restore puts it back there, out of the shop", async () => {
  S.keepHours = 1;
  const dir = path.join(games, KEEP_DIR_NAME, "lost-id");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "Lost.nsp"), Buffer.alloc(MIB, 3));
  put("Lost.nsz", MIB / 2);
  // Two hours on: the folder is past its keep time.
  clock = Date.now() + 2 * 3600_000;
  const q = make();
  await q.init();
  const [entry] = await trash.listRoot(gamesRoot());
  assert.deepEqual([entry.action, entry.items.map((i) => i.rel)], ["nsz-kept-orphan", [`${KEEP_DIR_NAME}/lost-id`]], "the dot is kept: the path is where it really was");
  const back = await trash.restoreEntry(gamesRoot(), entry.home, entry.entry);
  assert.deepEqual(back.items.map((i) => i.to), [`${KEEP_DIR_NAME}/lost-id`]);
  assert.ok(exists(`${KEEP_DIR_NAME}/lost-id/Lost.nsp`) && !exists("lost-id") && !exists("cookingfoil-nsz-keep"), "back in the hidden keep folder, nothing visible");
  // The restore starts its keep time again: a start within the hour does not send it straight back.
  clock = Date.now() + 30 * 60_000;
  const again = make();
  await again.init();
  assert.ok(exists(`${KEEP_DIR_NAME}/lost-id/Lost.nsp`));
  assert.deepEqual(await trash.listRoot(gamesRoot()), []);
  // Past the keep time again it goes back to the trash, under the same hidden path.
  clock = Date.now() + 2 * 3600_000;
  await make().init();
  assert.deepEqual((await trash.listRoot(gamesRoot())).map((e) => e.items[0].rel), [`${KEEP_DIR_NAME}/lost-id`]);
});

test("the pause counts copies a stop cut short until they are removed", async () => {
  S.diskFloorGb = 50;
  put("Next4.nsp");
  // A copy from a dead run whose bytes live nowhere else: it is kept, and the pause names it.
  put(".cookingfoil-partial-abcdefabcd-x.nsp", 3 * MIB);
  fs.writeFileSync(path.join(games, ".cookingfoil-partial-abcdefabcd.json"), JSON.stringify({ pid: 999999, boot: "old", startedAt: 1, from: path.join(games, "gone.nsp"), to: path.join(games, "x.nsp") }));
  // One whose original is still there: removed before the count.
  put("Dir/src.nsp", MIB);
  put("Dir/.cookingfoil-partial-1234512345-y.nsp", 5 * MIB);
  fs.writeFileSync(path.join(games, "Dir/.cookingfoil-partial-1234512345.json"), JSON.stringify({ pid: 999999, boot: "old", startedAt: 1, from: path.join(games, "Dir/src.nsp"), to: path.join(games, "Dir/y.nsp") }));
  const low = make({ freeBytes: async () => 10 * GIB, trashBytes: async () => 0 });
  await run(low);
  assert.equal(low.view().pausedReason, "disk");
  assert.ok(!exists("Dir/.cookingfoil-partial-1234512345-y.nsp"), "the removable one went");
  assert.equal(low.view().partial.bytes, 3 * MIB);
  assert.match(alerts.at(-1).text, /끊긴 복사본 /);
});
