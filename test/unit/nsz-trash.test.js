import { render } from "../../src/helpers/alert-messages.js";
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// After a conversion the original goes to the games folder's trash, never
// straight to deletion, and the free space floor pauses the queue instead of
// deleting anything to make room.
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
fs.writeFileSync(path.join(out, path.basename(src).replace(/\\.nsp$/i, ".nsz")), Buffer.alloc(Math.floor(size / 2)));
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

test("a converted original goes to the trash, recorded as the queue's doing, and comes back whole", async () => {
  put("Dir/A.nsp", 2 * MIB, 9);
  await run(make());
  assert.ok(!exists("Dir/A.nsp") && exists("Dir/A.nsz"));
  const [entry] = await trash.listRoot(gamesRoot());
  assert.deepEqual([entry.kind, entry.action, entry.by, entry.size], ["nsz-original", "nsz-converted", { type: "job", name: "nsz" }, 2 * MIB]);
  assert.deepEqual(entry.items.map((i) => i.rel), ["Dir/A.nsp"]);
  await trash.restoreEntry(gamesRoot(), entry.home, entry.entry);
  assert.deepEqual(fs.readFileSync(path.join(games, "Dir/A.nsp")), Buffer.alloc(2 * MIB, 9));
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
  await run(make());
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
