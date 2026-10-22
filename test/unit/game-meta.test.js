import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// A game's folder holds its game.json and its pictures; the server keeps what it
// read of them in memory and in the index, so a request never waits on the disk.
const data = fs.mkdtempSync(path.join(os.tmpdir(), "cook-game-meta-"));
process.env.COOK_DATA_DIR = data;
process.env.COOK_EXTRACT_ICONS = "off";
process.env.COOK_TITLEDB_AUTO_FETCH = "false";
process.env.COOK_ESHOP_ARTWORK = "false";
after(() => fs.rmSync(data, { recursive: true, force: true }));

const { default: sharp } = await import("sharp");
const gameMeta = await import("../../src/meta/game-meta.js");
const customArt = await import("../../src/meta/custom-art.js");
const gameDescriptions = await import("../../src/meta/game-descriptions.js");
const { artworkVersion } = await import("../../src/meta/artwork-version.js");
const { iconSource, iconKnown, bannerKnown } = await import("../../src/meta/localized-art.js");
const { appDb } = await import("../../src/db/database.js");
const { catalogStore } = await import("../../src/db/stores.js");
const { default: iconRoute } = await import("../../src/routes/icon.js");
const { default: screenshotRoute } = await import("../../src/routes/screenshot.js");
const { GAMES_DIR, THUMBS_DIR } = gameMeta;

const picture = (w, h, color, format = "png") => sharp({ create: { width: w, height: h, channels: 3, background: color } })[format]().toBuffer();
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
const noise = (w, h) => sharp({ create: { width: w, height: h, channels: 3, noise: { type: "gaussian", mean: 128, sigma: 60 } } }).png().toBuffer();
// Held apart: a test counts the calls a request makes to fs, not the ones made here.
const { existsSync } = fs;
// One request through a route, its sent file returned.
async function serve(route, params, query = {}) {
  let sent = null;
  // As express does: a file that is not there is an ENOENT to the callback, not a send.
  const sendFile = (p, cb) => {
    if (existsSync(p)) sent = p;
    else cb?.(Object.assign(new Error("gone"), { code: "ENOENT" }));
  };
  const res = { statusCode: 200, headersSent: false, set() { return this; }, type() { return this; }, status(c) { this.statusCode = c; return this; }, send() { return this; }, sendFile };
  await route({ params, query, headers: { accept: "image/webp" }, get: (h) => (h.toLowerCase() === "accept" ? "image/webp" : "") }, res);
  return sent;
}

test("a picture put in a folder by hand becomes the slot's WebP and its original, and the hand file goes", async () => {
  const ID = "0100000000010000";
  const dir = folder(ID);
  fs.writeFileSync(path.join(dir, "icon.jpg"), await picture(2000, 1500, "#ff0000", "jpeg"));
  fs.writeFileSync(path.join(dir, "Screenshot-02.PNG"), await picture(640, 360, "#00ff00"));
  await gameMeta.scan();

  assert.deepEqual(fs.readdirSync(dir).sort(), ["icon.orig.json", "icon.orig.webp", "icon.webp", "screenshot-02.orig.json", "screenshot-02.orig.webp", "screenshot-02.webp"]);
  const icon = await sharp(path.join(dir, "icon.webp")).metadata();
  assert.deepEqual([icon.format, icon.width, icon.height], ["webp", 1024, 768], "fit inside 1024");
  const shot = await sharp(path.join(dir, "screenshot-02.webp")).metadata();
  assert.deepEqual([shot.width, shot.height], [640, 360], "never enlarged");
  assert.equal(customArt.hasOverride(ID, "icon"), true);
  assert.deepEqual(customArt.list(ID), { icon: true, banner: false, screens: [1] }, "screenshot-02 is index 1");
  assert.deepEqual(gameDescriptions.locked(ID), ["icon", "screenshots"], "art set by hand is locked");
});

test("a hand-placed picture is made into its slot once, whatever its time against the slot's WebP", async () => {
  const ID = "0100000000020000";
  const dir = folder(ID);
  fs.writeFileSync(path.join(dir, "banner.webp"), await picture(1280, 720, "#0000ff", "webp"));
  await gameMeta.scan();
  fs.writeFileSync(path.join(dir, "banner.png"), await picture(1280, 720, "#ff0000"));
  ago(path.join(dir, "banner.png"), 3600);
  await gameMeta.scan();
  assert.ok(!fs.existsSync(path.join(dir, "banner.png")), "an older-dated new file still counts");
  assert.ok((await colorOf(path.join(dir, "banner.webp"))).r > 200);
});

test("a picture that cannot be read moves to .unreadable/, logged once, and one put there after is taken", async (t) => {
  const ID = "0100000000030000";
  const dir = folder(ID);
  const bad = path.join(dir, "icon.png");
  fs.writeFileSync(bad, "not a picture");
  const debug = (await import("../../src/debug.js")).default;
  const logged = t.mock.method(debug, "error", () => {});
  await gameMeta.scan();
  await gameMeta.scan({ force: true });
  await gameMeta.scan();
  assert.ok(!fs.existsSync(bad));
  assert.equal(fs.readFileSync(path.join(dir, ".unreadable", "icon.png"), "utf8"), "not a picture");
  assert.equal(logged.mock.calls.filter((c) => c.arguments.some((a) => String(a).includes("icon.png"))).length, 1, "logged once");
  assert.equal(customArt.hasOverride(ID, "icon"), false);

  fs.writeFileSync(bad, await picture(64, 64, "#ffffff"));
  await gameMeta.scan();
  assert.ok(!fs.existsSync(bad));
  assert.equal(customArt.hasOverride(ID, "icon"), true);
});
test("a folder renamed by hand keeps its pictures, its text and their small copies", async () => {
  const ID = "0100000000040000";
  const dir = folder(ID, "Old name");
  fs.writeFileSync(path.join(dir, "icon.webp"), await picture(256, 256, "#ffff00", "webp"));
  fs.writeFileSync(path.join(dir, "game.json"), JSON.stringify({ id: ID, name: { en: "Kept" } }));
  await gameMeta.scan();
  const v = artworkVersion("icon", ID);
  const thumb = await serve(iconRoute, { titleId: ID }, { size: "sm" });

  fs.renameSync(dir, path.join(GAMES_DIR, `New name [${ID}]`));
  await gameMeta.scan();
  assert.equal(customArt.pathFor(ID, "icon", null), path.join(GAMES_DIR, `New name [${ID}]`, "icon.webp"));
  assert.deepEqual(gameDescriptions.names(ID), { en: "Kept" });
  assert.equal(artworkVersion("icon", ID), v, "the same picture keeps its address");
  assert.equal(await serve(iconRoute, { titleId: ID }, { size: "sm" }), thumb);
  assert.ok(fs.existsSync(thumb));
});

test("deleting icon.webp by hand falls back and unlocks it within one scan, and its small copies go", async () => {
  const ID = "0100000000050000";
  const dir = folder(ID);
  fs.writeFileSync(path.join(dir, "icon.webp"), await picture(256, 256, "#ff00ff", "webp"));
  await gameMeta.scan();
  const thumb = await serve(iconRoute, { titleId: ID }, { size: "md" });
  assert.ok(thumb.startsWith(path.join(THUMBS_DIR, ID) + path.sep), "small copies are kept apart from the folder");
  assert.deepEqual(gameDescriptions.locked(ID), ["icon"]);

  fs.rmSync(path.join(dir, "icon.webp"));
  await gameMeta.scan();
  assert.equal(customArt.hasOverride(ID, "icon"), false);
  assert.deepEqual(gameDescriptions.locked(ID), []);
  assert.ok(!fs.existsSync(thumb), "its small copies are gone");
});

test("small copies are WebP, outside metadata/games, and a new picture gets new ones", async () => {
  const ID = "0100000000060000";
  const dir = folder(ID);
  fs.writeFileSync(path.join(dir, "screenshot-01.webp"), await picture(1920, 1080, "#123456", "webp"));
  await gameMeta.scan();
  const first = await serve(screenshotRoute, { titleId: ID, idx: "0" }, { size: "xl" });
  assert.ok(first.startsWith(THUMBS_DIR));
  assert.ok(first.endsWith(".webp"));
  assert.equal((await sharp(first).metadata()).width, 1280);
  const inMeta = fs.readdirSync(path.join(data, "metadata"), { recursive: true }).filter((f) => /thumb|\.md|\.sm|xl-wide|q\d+\.webp/.test(f));
  assert.deepEqual(inMeta, []);

  await customArt.put(ID, "screenshot", 0, await picture(800, 450, "#654321"));
  const second = await serve(screenshotRoute, { titleId: ID, idx: "0" }, { size: "xl" });
  assert.notEqual(second, first);
  await gameMeta.scan();
  assert.ok(!fs.existsSync(first), "the old picture's copies are pruned");
});

test("what a request asks about a game is answered from memory, without one call to the disk", async (t) => {
  const ID = "0100000000070000";
  const dir = folder(ID);
  fs.writeFileSync(path.join(dir, "icon.webp"), await picture(64, 64, "#ffffff", "webp"));
  fs.writeFileSync(path.join(dir, "banner.webp"), await picture(64, 36, "#ffffff", "webp"));
  fs.writeFileSync(path.join(dir, "game.json"), JSON.stringify({ id: ID, name: { ko: "이름" }, description: { en: "Text" } }));
  await gameMeta.scan();

  const calls = [];
  for (const target of [fs, fs.promises]) {
    for (const [key, fn] of Object.entries(target)) {
      if (typeof fn === "function" && /^[a-z]/.test(key) && key !== "constants") t.mock.method(target, key, function (...args) { calls.push(key); return fn.apply(this, args); });
    }
  }
  for (const id of [ID, "0100000000FFF000"]) {
    customArt.hasOverride(id, "icon");
    customArt.list(id);
    customArt.pathFor(id, "banner", null);
    customArt.serveOptions(id, "icon", null);
    gameDescriptions.get(id);
    gameDescriptions.names(id);
    gameDescriptions.describe(id, "ko", "x");
    gameDescriptions.notes(id, "en");
    gameDescriptions.locked(id);
    iconSource(id, "en");
    iconKnown(id, "ja");
    bannerKnown(id, "ja");
  }
  // A game with pictures of its own: their version comes from the stamps read.
  artworkVersion("icon", ID);
  artworkVersion("banner", ID);
  gameDescriptions.edited();
  t.mock.restoreAll();
  assert.deepEqual(calls, []);
});

test("the index keeps each folder's row, so a restart need not read every folder again", async () => {
  const ID = "0100000000080000";
  const dir = folder(ID, "Indexed");
  fs.writeFileSync(path.join(dir, "banner.webp"), await picture(64, 36, "#ffffff", "webp"));
  await gameMeta.scan();
  const row = catalogStore(appDb(), "game-meta").load().items.find((r) => r.id === ID);
  assert.equal(row.folder, `Indexed [${ID}]`);
  assert.equal(row.art.banner.file, "banner.webp");
  assert.match(row.art.banner.stamp, /^[0-9a-z]+-[0-9a-z]+$/);
});

test("re-reading one game picks up what was put in its folder", async () => {
  const ID = "0100000000090000";
  const dir = folder(ID);
  await gameMeta.scan();
  fs.writeFileSync(path.join(dir, "icon.png"), await picture(64, 64, "#00ffff"));
  fs.writeFileSync(path.join(dir, "game.json"), JSON.stringify({ id: ID, notes: { ko: "메모" } }));
  await gameMeta.rescan(ID);
  assert.equal(customArt.hasOverride(ID, "icon"), true);
  assert.equal(gameDescriptions.notes(ID, "ko"), "메모");
});

test("after a restart the index answers, and an unchanged folder is not listed again", async () => {
  const { execFileSync } = await import("node:child_process");
  await gameMeta.scan();
  const script = `
    import fs from "fs";
    const listed = [];
    const readdir = fs.readdirSync;
    fs.readdirSync = (p, ...rest) => { listed.push(String(p)); return readdir(p, ...rest); };
    const gameMeta = await import(${JSON.stringify(path.join(import.meta.dirname, "../../src/meta/game-meta.js"))});
    process.stdout.write(JSON.stringify({ banner: Boolean(gameMeta.art("0100000000080000", "banner")), listed }));`;
  const out = JSON.parse(execFileSync(process.execPath, ["--no-warnings", "--input-type=module", "-e", script], {
    env: { ...process.env, COOK_DATA_DIR: data }, encoding: "utf8",
  }));
  assert.equal(out.banner, true);
  assert.deepEqual(out.listed.filter((p) => p.startsWith(GAMES_DIR + path.sep)), [], "no game folder listed again");
});

test("a picture an editor saved over the slot's WebP gets a new stamp on the next scan", async () => {
  const ID = "01000000000A0000";
  const dir = folder(ID);
  fs.writeFileSync(path.join(dir, "icon.webp"), await picture(64, 64, "#ff0000", "webp"));
  await gameMeta.scan();
  const before = customArt.stampOf(ID, "icon", null);
  await sleep(20);
  // Same inode: the folder's mtime does not move.
  const blue = await picture(80, 80, "#0000ff", "webp");
  const fd = fs.openSync(path.join(dir, "icon.webp"), "r+");
  fs.ftruncateSync(fd, 0);
  fs.writeSync(fd, blue, 0, blue.length, 0);
  fs.closeSync(fd);
  await gameMeta.scan();
  assert.notEqual(customArt.stampOf(ID, "icon", null), before);
});

test("a hand file copied with its old mtime (cp -p, unzip) still wins over the slot's WebP", async () => {
  const ID = "01000000000B0000";
  const dir = folder(ID);
  fs.writeFileSync(path.join(dir, "icon.webp"), await picture(64, 64, "#ff0000", "webp"));
  await gameMeta.scan();
  fs.writeFileSync(path.join(dir, "icon.png"), await picture(64, 64, "#00ff00"));
  ago(path.join(dir, "icon.png"), 86400);
  await gameMeta.scan();
  assert.ok((await colorOf(path.join(dir, "icon.webp"))).g > 200);
  assert.ok(!fs.existsSync(path.join(dir, "icon.png")));
});

test("a hand file dated in the future leaves no future date on the slot, and a picture put there after it wins", async () => {
  const ID = "01000000001C0000";
  const dir = folder(ID);
  const hand = path.join(dir, "icon.png");
  fs.writeFileSync(hand, await picture(64, 64, "#ff0000"));
  const later = new Date(Date.now() + 9 * 3600e3);
  fs.utimesSync(hand, later, later);
  await gameMeta.scan();
  assert.ok(fs.statSync(path.join(dir, "icon.webp")).mtimeMs <= Date.now() + 1000, "not dated ahead");
  fs.writeFileSync(hand, await picture(64, 64, "#00ff00"));
  await gameMeta.scan({ force: true });
  assert.ok((await colorOf(path.join(dir, "icon.webp"))).g > 200);
  assert.ok(!fs.existsSync(hand));
});

test("reading one game again reads only its folder, not the whole games folder", async (t) => {
  const ID = "01000000001F0000";
  const dir = folder(ID);
  await gameMeta.scan();
  fs.writeFileSync(path.join(dir, "icon.webp"), await picture(64, 64, "#ffffff", "webp"));
  const NEW = "0100000000200000";
  const fresh = folder(NEW, "New");
  fs.writeFileSync(path.join(fresh, "banner.webp"), await picture(64, 36, "#ffffff", "webp"));
  const readdirSync = fs.readdirSync;
  const listed = [];
  t.mock.method(fs, "readdirSync", (p, ...rest) => { listed.push(String(p)); return readdirSync(p, ...rest); });
  await gameMeta.rescan(ID);
  // The watch names the folder that changed: a new one is read without the whole list.
  await gameMeta.rescan(NEW, path.basename(fresh));
  t.mock.restoreAll();
  assert.equal(customArt.hasOverride(ID, "icon"), true);
  assert.equal(customArt.hasOverride(NEW, "banner"), true);
  assert.deepEqual(listed.filter((p) => p === GAMES_DIR), []);
});

test("an icon in a game's folder is sent without a look at the disk first; one found gone falls back and has the game read again", async (t) => {
  const ID = "0100000000210000";
  const dir = folder(ID, "Sent");
  fs.writeFileSync(path.join(dir, "icon.webp"), await picture(64, 64, "#ff0000", "webp"));
  await gameMeta.scan();
  await serve(iconRoute, { titleId: ID }, { size: "sm" });
  const calls = [];
  for (const key of ["existsSync", "statSync", "accessSync"]) {
    const fn = fs[key];
    t.mock.method(fs, key, (...args) => { calls.push(key); return fn(...args); });
  }
  assert.equal(await serve(iconRoute, { titleId: ID }), path.join(dir, "icon.webp"));
  assert.ok(await serve(iconRoute, { titleId: ID }, { size: "sm" }));
  t.mock.restoreAll();
  assert.deepEqual(calls, []);

  fs.renameSync(dir, path.join(GAMES_DIR, `Moved [${ID}]`));
  await serve(iconRoute, { titleId: ID });
  for (let i = 0; i < 60 && !/Moved \[/.test(customArt.pathFor(ID, "icon", null) ?? ""); i++) await sleep(50);
  assert.match(customArt.pathFor(ID, "icon", null), /Moved \[/);
});

test("a small copy found gone is made again, and the game's own picture is still the one sent", async () => {
  const ID = "0100000000220000";
  const dir = folder(ID, "Thumbs");
  fs.writeFileSync(path.join(dir, "icon.webp"), await picture(64, 64, "#ff0000", "webp"));
  await gameMeta.scan();
  const first = await serve(iconRoute, { titleId: ID }, { size: "sm" });
  assert.ok(first.startsWith(THUMBS_DIR));
  fs.rmSync(THUMBS_DIR, { recursive: true, force: true });
  const sent = [];
  const res = { statusCode: 200, headersSent: false, set() { return this; }, type() { return this; }, status(c) { this.statusCode = c; return this; }, send() { return this; },
    sendFile(p, cb) { if (existsSync(p)) sent.push(p); else cb?.(Object.assign(new Error("gone"), { code: "ENOENT" })); } };
  await iconRoute({ params: { titleId: ID }, query: { size: "sm" }, headers: { accept: "image/webp" }, get: () => "image/webp" }, res);
  for (let i = 0; i < 40 && !sent.length; i++) await sleep(25);
  assert.deepEqual(sent, [first]);
});

test("a hand file replaced while it is being converted is kept, never deleted unread", async () => {
  const ID = "01000000000D0000";
  const dir = folder(ID);
  const src = path.join(dir, "banner.png");
  fs.writeFileSync(src, await noise(4000, 3000));
  const green = await picture(320, 180, "#00ff00");
  const p = gameMeta.scan();
  await sleep(150);
  fs.writeFileSync(path.join(dir, ".new.png"), green);
  fs.renameSync(path.join(dir, ".new.png"), src);
  await p;
  if (fs.existsSync(src)) await gameMeta.scan();
  assert.ok(!fs.existsSync(src), "the newer one is made into the slot by the next scan");
  assert.ok((await colorOf(path.join(dir, "banner.webp"))).g > 200, "the newer picture is the slot's");
});

test("an admin upload made while a hand file converts is not written over", async () => {
  const ID = "01000000000E0000";
  const dir = folder(ID);
  fs.writeFileSync(path.join(dir, "screenshot-01.png"), await noise(3000, 2000));
  const p = gameMeta.scan();
  await customArt.put(ID, "screenshot", 0, await picture(320, 180, "#00ff00"));
  await p;
  const c = await colorOf(path.join(dir, "screenshot-01.webp"));
  assert.ok(c.g > 200 && c.r < 100, "the upload stays");
  const orig = await colorOf(path.join(dir, "screenshot-01.orig.webp"));
  assert.ok(orig.g > 200 && orig.r < 100, "and its original");
});

test("a folder renamed by hand never makes the icon route send a vanished file; the game is read again", async () => {
  const ID = "01000000000F0000";
  const dir = folder(ID, "Before");
  fs.writeFileSync(path.join(dir, "icon.webp"), await picture(64, 64, "#ff0000", "webp"));
  await gameMeta.scan();
  assert.ok(await serve(iconRoute, { titleId: ID }));
  fs.renameSync(dir, path.join(GAMES_DIR, `After [${ID}]`));
  const sent = await serve(iconRoute, { titleId: ID });
  assert.ok(!sent || fs.existsSync(sent), `sent ${sent}`);
  for (let i = 0; i < 60 && !/After \[/.test(customArt.pathFor(ID, "icon", null) ?? ""); i++) await sleep(50);
  assert.match(customArt.pathFor(ID, "icon", null), /After \[/);
  assert.equal(await serve(iconRoute, { titleId: ID }), path.join(GAMES_DIR, `After [${ID}]`, "icon.webp"));
});

test("the first scan tells what it found", async () => {
  const { execFileSync } = await import("node:child_process");
  const own = fs.mkdtempSync(path.join(os.tmpdir(), "cook-game-meta-first-"));
  fs.mkdirSync(path.join(own, "metadata", "games", "First [0100000000F10000]"), { recursive: true });
  const script = `
    const gameMeta = await import(${JSON.stringify(path.join(import.meta.dirname, "../../src/meta/game-meta.js"))});
    let told = 0;
    gameMeta.start({ onChange: () => told++ });
    await new Promise((r) => setTimeout(r, 300));
    gameMeta.stop();
    process.stdout.write(JSON.stringify({ told }));`;
  try {
    const out = JSON.parse(execFileSync(process.execPath, ["--no-warnings", "--input-type=module", "-e", script], {
      env: { ...process.env, COOK_DATA_DIR: own }, encoding: "utf8",
    }));
    assert.equal(out.told, 1);
  } finally {
    fs.rmSync(own, { recursive: true, force: true });
  }
});

test("started, it watches the games folder (made when missing) and reads a folder that changed, no timer", async () => {
  const { execFileSync } = await import("node:child_process");
  const own = fs.mkdtempSync(path.join(os.tmpdir(), "cook-game-meta-watch-"));
  const script = `
    import fs from "fs";
    import path from "path";
    const intervals = [];
    const setI = globalThis.setInterval;
    globalThis.setInterval = (...a) => { intervals.push(a[1]); return setI(...a); };
    const { default: sharp } = await import("sharp");
    const gameMeta = await import(${JSON.stringify(path.join(import.meta.dirname, "../../src/meta/game-meta.js"))});
    gameMeta.start({ quietMs: 100, cooldownMs: 0 });
    await gameMeta.watching();
    const made = fs.existsSync(gameMeta.GAMES_DIR);
    const dir = path.join(gameMeta.GAMES_DIR, "Watched [0100000000F20000]");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "icon.png"), await sharp({ create: { width: 8, height: 8, channels: 3, background: "#fff" } }).png().toBuffer());
    let art = null;
    for (let i = 0; i < 100 && !art; i++) { await new Promise((r) => setTimeout(r, 50)); art = gameMeta.art("0100000000F20000", "icon"); }
    gameMeta.stop();
    process.stdout.write(JSON.stringify({ made, art: Boolean(art), intervals }));`;
  try {
    const out = JSON.parse(execFileSync(process.execPath, ["--no-warnings", "--input-type=module", "-e", script], {
      env: { ...process.env, COOK_DATA_DIR: own }, encoding: "utf8",
    }));
    assert.deepEqual(out, { made: true, art: true, intervals: [] });
  } finally {
    fs.rmSync(own, { recursive: true, force: true });
  }
});

test("a game folder deleted and made again under the same name is watched again, by hand or by the server", async () => {
  const { execFileSync } = await import("node:child_process");
  const own = fs.mkdtempSync(path.join(os.tmpdir(), "cook-game-meta-again-"));
  const script = `
    import fs from "fs";
    import path from "path";
    const { default: sharp } = await import("sharp");
    const gameMeta = await import(${JSON.stringify(path.join(import.meta.dirname, "../../src/meta/game-meta.js"))});
    const customArt = await import(${JSON.stringify(path.join(import.meta.dirname, "../../src/meta/custom-art.js"))});
    const png = () => sharp({ create: { width: 8, height: 8, channels: 3, background: "#fff" } }).png().toBuffer();
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (fn) => { for (let i = 0; i < 60 && !fn(); i++) await sleep(50); return Boolean(fn()); };
    gameMeta.start({ quietMs: 100, cooldownMs: 0 });
    await gameMeta.watching();
    const dir = path.join(gameMeta.GAMES_DIR, "Again [0100000000F30000]");
    fs.mkdirSync(dir);
    await sleep(300);
    fs.rmSync(dir, { recursive: true });
    fs.mkdirSync(dir);
    await sleep(300);
    fs.writeFileSync(path.join(dir, "icon.png"), await png());
    const byHand = await until(() => gameMeta.art("0100000000F30000", "icon"));

    const ID = "0100000000F40000";
    await customArt.put(ID, "icon", null, await png());
    await sleep(300);
    await customArt.remove(ID, "icon", null);
    await sleep(300);
    await customArt.put(ID, "icon", null, await png());
    await sleep(300);
    fs.writeFileSync(path.join(gameMeta.folderOf(ID), "screenshot-01.png"), await png());
    const byServer = await until(() => gameMeta.art(ID, "screenshot-01"));
    gameMeta.stop();
    process.stdout.write(JSON.stringify({ byHand, byServer }));`;
  try {
    const out = JSON.parse(execFileSync(process.execPath, ["--no-warnings", "--input-type=module", "-e", script], {
      env: { ...process.env, COOK_DATA_DIR: own }, encoding: "utf8",
    }));
    assert.deepEqual(out, { byHand: true, byServer: true });
  } finally {
    fs.rmSync(own, { recursive: true, force: true });
  }
});
