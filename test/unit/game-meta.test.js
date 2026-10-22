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
// One request through a route, its sent file returned.
async function serve(route, params, query = {}) {
  let sent = null;
  const res = { statusCode: 200, set() { return this; }, type() { return this; }, status(c) { this.statusCode = c; return this; }, send() { return this; }, sendFile(p) { sent = p; } };
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

test("the newer of a hand-placed picture and the slot's WebP wins", async () => {
  const ID = "0100000000020000";
  const dir = folder(ID);
  fs.writeFileSync(path.join(dir, "banner.webp"), await picture(1280, 720, "#0000ff", "webp"));
  fs.writeFileSync(path.join(dir, "banner.png"), await picture(1280, 720, "#ff0000"));
  ago(path.join(dir, "banner.png"), 60);
  await gameMeta.scan();
  assert.ok(fs.existsSync(path.join(dir, "banner.png")), "an older hand file is left alone");
  const { dominant } = await sharp(path.join(dir, "banner.webp")).stats();
  assert.ok(dominant.b > 200, "the WebP stays");

  fs.writeFileSync(path.join(dir, "banner.png"), await picture(1280, 720, "#ff0000"));
  await gameMeta.scan({ force: true });
  assert.ok(!fs.existsSync(path.join(dir, "banner.png")), "a newer one replaces it");
  assert.ok((await sharp(path.join(dir, "banner.webp")).stats()).dominant.r > 200);
});

test("a picture that cannot be read is left alone and not tried again until it changes", async (t) => {
  const ID = "0100000000030000";
  const dir = folder(ID);
  const bad = path.join(dir, "icon.png");
  fs.writeFileSync(bad, "not a picture");
  const debug = (await import("../../src/debug.js")).default;
  const logged = t.mock.method(debug, "error", () => {});
  await gameMeta.scan();
  await gameMeta.scan({ force: true });
  await gameMeta.scan();
  assert.equal(fs.readFileSync(bad, "utf8"), "not a picture");
  assert.equal(logged.mock.calls.filter((c) => String(c.arguments[1]).includes("icon.png")).length, 1, "logged once");
  assert.equal(customArt.hasOverride(ID, "icon"), false);

  fs.writeFileSync(bad, await picture(64, 64, "#ffffff"));
  await gameMeta.scan();
  assert.ok(!fs.existsSync(bad), "fixed in place: tried again");
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
