import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

// A picture put into a game's folder by hand is taken once and never stays in the
// slot: it becomes the slot's WebP and goes, and every other hand file of that slot
// moves to the folder's .replaced/. Nothing of that decision lives anywhere else, so
// a folder copied with new inodes, a lost index or a touch cannot bring one back.
const data = fs.mkdtempSync(path.join(os.tmpdir(), "cook-game-art-hand-"));
process.env.COOK_DATA_DIR = data;
process.env.COOK_EXTRACT_ICONS = "off";
process.env.COOK_TITLEDB_AUTO_FETCH = "false";
process.env.COOK_ESHOP_ARTWORK = "false";
after(() => fs.rmSync(data, { recursive: true, force: true }));

const { default: sharp } = await import("sharp");
const gameMeta = await import("../../src/meta/game-meta.js");
const customArt = await import("../../src/meta/custom-art.js");
const { GAMES_DIR } = gameMeta;
// A hand file is taken at once here: its quiet time is the watch's, for the tests that need one.
gameMeta.setQuiet(0);

const picture = (color, format = "png") => sharp({ create: { width: 64, height: 64, channels: 3, background: color } })[format]().toBuffer();
const folder = (id, name = "Game") => {
  const dir = path.join(GAMES_DIR, `${name} [${id}]`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
const ago = (file, seconds) => {
  const t = new Date(Date.now() - seconds * 1000);
  fs.utimesSync(file, t, t);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const colorOf = async (file) => (await sharp(file).stats()).dominant;
const green = async (file) => (await colorOf(file)).g > 200;
// What rsync -a or cp -a to another disk does, or a restore: the same names, sizes and mtimes, new inodes.
const recopy = (dir) => {
  execFileSync("cp", ["-a", dir, `${dir}.copy`]);
  fs.rmSync(dir, { recursive: true });
  fs.renameSync(`${dir}.copy`, dir);
};
const hand = (dir) => fs.readdirSync(dir).filter((n) => /\.(png|jpe?g)$/i.test(n));

// A hand file put there, then an upload to the same slot within the watch's quiet time.
async function uploadOverHand(id) {
  const dir = folder(id);
  fs.writeFileSync(path.join(dir, "icon.png"), await picture("#ff0000"));
  await customArt.put(id, "icon", null, await picture("#00ff00"));
  await gameMeta.scan();
  return dir;
}

test("an upload moves the hand file waiting in its slot to .replaced/, so a folder copied with new inodes keeps the upload", async () => {
  const ID = "0100000000B10000";
  const dir = await uploadOverHand(ID);
  assert.deepEqual(hand(dir), []);
  assert.deepEqual(fs.readdirSync(path.join(dir, ".replaced")), ["icon.png"]);
  recopy(dir);
  await gameMeta.rescan(ID);
  assert.ok(await green(path.join(dir, "icon.webp")), "the upload stays");
  assert.ok(await green(path.join(dir, "icon.orig.webp")), "and its original");

  // A picture put there later is the newest thing done: it wins.
  fs.writeFileSync(path.join(dir, "icon.png"), await picture("#0000ff"));
  await gameMeta.rescan(ID);
  assert.ok((await colorOf(path.join(dir, "icon.webp"))).b > 200);
  assert.deepEqual(hand(dir), []);
});

test("of two hand files in one slot the newest is taken and the other moves to .replaced/; a copy with new inodes changes nothing", async () => {
  const ID = "0100000000B20000";
  const dir = folder(ID);
  fs.writeFileSync(path.join(dir, "icon.jpg"), await picture("#ff0000", "jpeg"));
  ago(path.join(dir, "icon.jpg"), 60);
  fs.writeFileSync(path.join(dir, "icon.png"), await picture("#00ff00"));
  await gameMeta.scan();
  assert.ok(await green(path.join(dir, "icon.webp")));
  assert.deepEqual(hand(dir), []);
  assert.deepEqual(fs.readdirSync(path.join(dir, ".replaced")), ["icon.jpg"]);
  recopy(dir);
  await gameMeta.rescan(ID);
  assert.ok(await green(path.join(dir, "icon.webp")), "the newer picture stays");
});

test("with the index lost, a new process finds no hand file to take over the upload", () => {
  const own = fs.mkdtempSync(path.join(os.tmpdir(), "cook-game-art-index-"));
  const script = `
    import fs from "fs";
    import path from "path";
    const { default: sharp } = await import("sharp");
    const gameMeta = await import(${JSON.stringify(path.join(import.meta.dirname, "../../src/meta/game-meta.js"))});
    const customArt = await import(${JSON.stringify(path.join(import.meta.dirname, "../../src/meta/custom-art.js"))});
    const ID = "0100000000B30000";
    const dir = path.join(gameMeta.GAMES_DIR, "Game [" + ID + "]");
    const png = (c) => sharp({ create: { width: 64, height: 64, channels: 3, background: c } }).png().toBuffer();
    if (process.argv[1] === "setup") {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "icon.png"), await png("#ff0000"));
      await customArt.put(ID, "icon", null, await png("#00ff00"));
    }
    await gameMeta.scan();
    process.stdout.write(String((await sharp(path.join(dir, "icon.webp")).stats()).dominant.g));
    process.exit(0);`;
  const run = (phase) => Number(execFileSync(process.execPath, ["--no-warnings", "--input-type=module", "-e", script, phase], {
    env: { ...process.env, COOK_DATA_DIR: own }, encoding: "utf8",
  }));
  try {
    assert.ok(run("setup") > 200);
    // The index is only a cache: a rebuild, a new install over the same folders or a broken file drops it.
    for (const f of fs.readdirSync(own)) if (/\.(db|sqlite)(-wal|-shm)?$/.test(f)) fs.rmSync(path.join(own, f));
    assert.ok(run("after") > 200, "the upload stays");
  } finally {
    fs.rmSync(own, { recursive: true, force: true });
  }
});

test("a replaced hand file touched (mtime only) does not come back over the upload", async () => {
  const ID = "0100000000B40000";
  const dir = await uploadOverHand(ID);
  const now = new Date();
  fs.utimesSync(path.join(dir, ".replaced", "icon.png"), now, now);
  await gameMeta.rescan(ID);
  await gameMeta.scan({ force: true });
  assert.ok(await green(path.join(dir, "icon.webp")));
});

test("a newer hand file that cannot be read moves to .unreadable/, logged once, and the older one is taken", async (t) => {
  const ID = "0100000000B80000";
  const dir = folder(ID);
  fs.writeFileSync(path.join(dir, "icon.jpg"), await picture("#00ff00", "jpeg"));
  ago(path.join(dir, "icon.jpg"), 60);
  fs.writeFileSync(path.join(dir, "icon.png"), "not a picture");
  const debug = (await import("../../src/debug.js")).default;
  const logged = t.mock.method(debug, "error", () => {});
  await gameMeta.scan();
  await gameMeta.scan({ force: true });
  assert.ok(await green(path.join(dir, "icon.webp")), "the readable picture is the icon");
  assert.deepEqual(hand(dir), []);
  assert.equal(fs.readFileSync(path.join(dir, ".unreadable", "icon.png"), "utf8"), "not a picture");
  assert.equal(logged.mock.calls.filter((c) => c.arguments.some((a) => String(a).includes("icon.png"))).length, 1);
});

test("a hand file that cannot be moved leaves the slot unwritten, logged once a process; once it can, it is taken", async (t) => {
  const ID = "0100000000B90000";
  const dir = folder(ID);
  fs.writeFileSync(path.join(dir, "banner.webp"), await picture("#0000ff", "webp"));
  await gameMeta.scan();
  // The winner stays until the slot holds it; the other, older one is what has to move first.
  const src = path.join(dir, "banner.jpg");
  fs.writeFileSync(src, await picture("#ff0000", "jpeg"));
  ago(src, 60);
  fs.writeFileSync(path.join(dir, "banner.png"), await picture("#00ff00"));
  const renameSync = fs.renameSync;
  t.mock.method(fs, "renameSync", (from, ...rest) => {
    if (from === src) throw Object.assign(new Error("read-only"), { code: "EROFS" });
    return renameSync(from, ...rest);
  });
  const debug = (await import("../../src/debug.js")).default;
  const logged = t.mock.method(debug, "error", () => {});
  await gameMeta.scan();
  await gameMeta.scan({ force: true });
  await gameMeta.rescan(ID);
  assert.ok((await colorOf(path.join(dir, "banner.webp"))).b > 200, "the slot is not written while the hand file would stay");
  assert.deepEqual(hand(dir).sort(), ["banner.jpg", "banner.png"]);
  assert.equal(logged.mock.calls.filter((c) => c.arguments.some((a) => String(a).includes("banner.jpg"))).length, 1);
  t.mock.restoreAll();
  await gameMeta.rescan(ID);
  assert.ok(await green(path.join(dir, "banner.webp")));
  assert.deepEqual(hand(dir), []);
  assert.deepEqual(fs.readdirSync(path.join(dir, ".replaced")), ["banner.jpg"]);
});

test("a name already taken in .replaced/ gets a number, so nothing there is written over", async () => {
  const ID = "0100000000BA0000";
  const dir = folder(ID);
  fs.mkdirSync(path.join(dir, ".replaced"));
  fs.writeFileSync(path.join(dir, ".replaced", "icon.png"), "older");
  fs.writeFileSync(path.join(dir, "icon.png"), await picture("#ff0000"));
  await customArt.put(ID, "icon", null, await picture("#00ff00"));
  assert.deepEqual(fs.readdirSync(path.join(dir, ".replaced")).sort(), ["icon (2).png", "icon.png"]);
  assert.equal(fs.readFileSync(path.join(dir, ".replaced", "icon.png"), "utf8"), "older");
});

test("removing a slot from the admin page moves the hand file waiting there to .replaced/", async () => {
  const ID = "0100000000BB0000";
  const dir = folder(ID);
  await customArt.put(ID, "icon", null, await picture("#00ff00"));
  fs.writeFileSync(path.join(dir, "icon.png"), await picture("#0000ff"));
  await customArt.remove(ID, "icon", null);
  await gameMeta.scan({ force: true });
  assert.equal(customArt.hasOverride(ID, "icon"), false);
  assert.deepEqual(fs.readdirSync(path.join(dir, ".replaced")), ["icon.png"]);
});

test("work a queued write leaves behind (a timer, a promise not waited for) waits its turn like any other", async () => {
  const ID = "0100000000BC0000";
  const log = [];
  const slow = (name) => async () => { log.push(`${name} start`); await sleep(60); log.push(`${name} end`); };
  let born;
  await gameMeta.withGame(ID, async () => {
    born = new Promise((resolve) => setTimeout(() => resolve(gameMeta.withGame(ID, slow("timer"))), 10));
  });
  const other = gameMeta.withGame(ID, slow("other"));
  await Promise.all([await born, other]);
  assert.deepEqual(log, ["other start", "other end", "timer start", "timer end"]);

  log.length = 0;
  let chain;
  await gameMeta.withGame(ID, async () => { chain = sleep(10).then(() => gameMeta.withGame(ID, slow("chain"))); });
  await Promise.all([gameMeta.withGame(ID, slow("other")), chain]);
  assert.deepEqual(log, ["other start", "other end", "chain start", "chain end"]);
});

test("a forced look leaves a hand file still being copied in its folder, untouched, and takes it once it has been quiet", async (t) => {
  const ID = "0100000000BD0000";
  const dir = folder(ID);
  const whole = await picture("#00ff00");
  // Half a PNG: what a slow copy looks like when the rescan button is pressed.
  fs.writeFileSync(path.join(dir, "banner.png"), whole.subarray(0, Math.floor(whole.length / 2)));
  fs.writeFileSync(path.join(dir, "icon.png"), whole);
  gameMeta.setQuiet(30_000);
  t.after(() => gameMeta.setQuiet(0));
  await gameMeta.rescan(ID);
  await gameMeta.scan({ force: true });
  assert.ok(!fs.existsSync(path.join(dir, ".unreadable")), "not taken for a broken picture");
  assert.deepEqual(hand(dir).sort(), ["banner.png", "icon.png"], "left where they are, not decoded");
  assert.equal(customArt.hasOverride(ID, "icon"), false);

  fs.writeFileSync(path.join(dir, "banner.png"), whole);
  gameMeta.setQuiet(0);
  await gameMeta.rescan(ID);
  assert.deepEqual(hand(dir), []);
  assert.ok(await green(path.join(dir, "banner.webp")));
  assert.ok(await green(path.join(dir, "icon.webp")));
});

// The winner stays in the folder until the slot holds it, so a failure at any step
// leaves either the slot as it was or one the next look makes again from the same picture.
for (const step of ["original", "picture", "check", "delete"]) {
  test(`a failure while the winner is written (${step}) loses nothing, and the next look takes the same picture`, async (t) => {
    const ID = `0100000000C${["original", "picture", "check", "delete"].indexOf(step)}0000`;
    const dir = folder(ID);
    await customArt.put(ID, "icon", null, await picture("#0000ff"));
    fs.writeFileSync(path.join(dir, "icon.jpg"), await picture("#ff0000", "jpeg"));
    ago(path.join(dir, "icon.jpg"), 60);
    const winner = path.join(dir, "icon.png");
    fs.writeFileSync(winner, await picture("#00ff00"));
    const fail = () => { throw Object.assign(new Error(`injected at ${step}`), { code: "EIO" }); };
    const { renameSync, writeFileSync, rmSync } = fs;
    if (step === "original") t.mock.method(fs, "renameSync", (a, b, ...r) => (String(b).endsWith("icon.orig.webp") ? fail() : renameSync(a, b, ...r)));
    if (step === "picture") t.mock.method(fs, "renameSync", (a, b, ...r) => (String(b).endsWith(`${path.sep}icon.webp`) ? fail() : renameSync(a, b, ...r)));
    if (step === "check") t.mock.method(fs, "writeFileSync", (f, buf, ...r) => writeFileSync(f, String(f).includes(".icon.webp.") ? Buffer.alloc(0) : buf, ...r));
    if (step === "delete") t.mock.method(fs, "rmSync", (f, ...r) => (f === winner ? fail() : rmSync(f, ...r)));
    const debug = (await import("../../src/debug.js")).default;
    t.mock.method(debug, "error", () => {});
    await gameMeta.rescan(ID);
    assert.ok(fs.existsSync(winner), "the winner is still in the folder");
    assert.deepEqual(fs.readdirSync(path.join(dir, ".replaced")), ["icon.jpg"], "only the loser was put aside");
    if (step === "original" || step === "picture") assert.ok((await colorOf(path.join(dir, "icon.webp"))).b > 200, "the slot is as it was");
    t.mock.restoreAll();
    await gameMeta.rescan(ID);
    assert.deepEqual(hand(dir), []);
    assert.ok(await green(path.join(dir, "icon.webp")));
    assert.ok(await green(path.join(dir, "icon.orig.webp")));
    assert.deepEqual(fs.readdirSync(path.join(dir, ".replaced")), ["icon.jpg"]);
  });
}

test("a game's queue entered again from inside itself fails at once instead of waiting forever", { timeout: 5_000 }, async () => {
  const ID = "0100000000C50000";
  await assert.rejects(
    gameMeta.withGame(ID, (held) => gameMeta.withGame(ID, () => "inner", held)),
    /own queue/,
  );
  await assert.rejects(gameMeta.withGame(ID, (held) => gameMeta.rescan(ID, null, held)), /own queue/);
  assert.equal(await gameMeta.withGame(ID, () => "after"), "after", "the queue goes on");
  assert.equal(await gameMeta.withGame(ID, (held) => gameMeta.withGame("0100000000C60000", () => "other", held)), "other", "another game's queue is fine");
});

test("a hand file far larger than any picture moves to .unreadable/ unread, and the next one is taken", async (t) => {
  const ID = "0100000000C70000";
  const dir = folder(ID);
  fs.writeFileSync(path.join(dir, "icon.jpg"), await picture("#00ff00", "jpeg"));
  ago(path.join(dir, "icon.jpg"), 60);
  // Sparse: 300 MB on paper, nothing on the disk.
  fs.closeSync(fs.openSync(path.join(dir, "icon.png"), "w"));
  fs.truncateSync(path.join(dir, "icon.png"), 300 * 1024 * 1024);
  const debug = (await import("../../src/debug.js")).default;
  t.mock.method(debug, "error", () => {});
  const read = t.mock.method(fs.promises, "open");
  await gameMeta.rescan(ID);
  assert.ok(!read.mock.calls.some((c) => String(c.arguments[0]).endsWith("icon.png")), "never read");
  assert.deepEqual(fs.readdirSync(path.join(dir, ".unreadable")), ["icon.png"]);
  assert.ok(await green(path.join(dir, "icon.webp")));
});

test("the settle check says a file held still across the wait, and not one whose time or size changed meanwhile", async () => {
  const { holdsStill } = await import("../../src/meta/game-art-files.js");
  const dir = folder("0100000000C90000");
  const still = path.join(dir, "icon.png");
  const touched = path.join(dir, "banner.png");
  const growing = path.join(dir, "screenshot-01.png");
  for (const f of [still, touched, growing]) fs.writeFileSync(f, await picture("#00ff00"));
  assert.equal(await holdsStill([still], 200), true);
  const busy = setInterval(() => {
    const now = new Date(Date.now() + 1000);
    fs.utimesSync(touched, now, now);
    fs.appendFileSync(growing, "x");
  }, 50);
  try {
    assert.equal(await holdsStill([still, touched], 200), false);
    assert.equal(await holdsStill([growing], 200), false);
  } finally {
    clearInterval(busy);
  }
});

test("asked from the button, a picture written just now is taken once it holds still, and one still changing is left and reported", async (t) => {
  const ID = "0100000000CA0000";
  const dir = folder(ID);
  gameMeta.setQuiet(30_000);
  t.after(() => gameMeta.setQuiet(0));
  fs.writeFileSync(path.join(dir, "icon.png"), await picture("#00ff00"));
  const plain = await gameMeta.rescan(ID);
  assert.equal(plain.converted, 0, "a look of its own waits the quiet time");
  assert.deepEqual(hand(dir), ["icon.png"]);

  const asked = await gameMeta.rescan(ID, null, null, { settle: true });
  assert.equal(asked.pending, 0);
  assert.deepEqual(hand(dir), []);
  assert.ok(await green(path.join(dir, "icon.webp")));

  const banner = path.join(dir, "banner.png");
  fs.writeFileSync(banner, await picture("#00ff00"));
  const busy = setInterval(() => { const now = new Date(); fs.utimesSync(banner, now, now); }, 100);
  let still;
  try {
    still = await gameMeta.rescan(ID, null, null, { settle: true });
  } finally {
    clearInterval(busy);
  }
  assert.equal(still.pending, 1);
  assert.ok(still.retryInMs > 25_000 && still.retryInMs < 40_000, `retry in ${still.retryInMs}`);
  assert.deepEqual(hand(dir), ["banner.png"], "left where it is");
  assert.ok(!fs.existsSync(path.join(dir, ".unreadable")));
});

test("a hand file stamped a moment ahead of the clock is still fresh; one far ahead is not", async () => {
  const { isFresh } = await import("../../src/meta/game-art-files.js");
  const now = 1_000_000;
  assert.equal(isFresh({ mtimeMs: now + 0.7, ctimeMs: now + 0.7 }, 30_000, now), true, "the same millisecond");
  assert.equal(isFresh({ mtimeMs: now + 1500, ctimeMs: now - 60_000 }, 30_000, now), true, "a file server a little ahead");
  assert.equal(isFresh({ mtimeMs: now + 60_000, ctimeMs: now - 60_000 }, 30_000, now), false);
  assert.equal(isFresh({ mtimeMs: now - 31_000, ctimeMs: now - 31_000 }, 30_000, now), false);
  assert.equal(isFresh({ mtimeMs: now + 0.7, ctimeMs: now + 0.7 }, 0, now), false, "no quiet time asked");
});
