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
  const src = path.join(dir, "banner.png");
  fs.writeFileSync(src, await picture("#00ff00"));
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
  assert.ok(fs.existsSync(src));
  assert.equal(logged.mock.calls.filter((c) => c.arguments.some((a) => String(a).includes("banner.png"))).length, 1);
  t.mock.restoreAll();
  await gameMeta.rescan(ID);
  assert.ok(await green(path.join(dir, "banner.webp")));
  assert.ok(!fs.existsSync(src));
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
