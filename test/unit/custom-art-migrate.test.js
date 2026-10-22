import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Art an older server kept in custom-art/ moves into the games' folders at start.
// An old file goes only once its new one is written and reads back.
const data = fs.mkdtempSync(path.join(os.tmpdir(), "cook-art-migrate-"));
process.env.COOK_DATA_DIR = data;
process.env.COOK_EXTRACT_ICONS = "off";
process.env.COOK_TITLEDB_AUTO_FETCH = "false";
after(() => fs.rmSync(data, { recursive: true, force: true }));

const { default: sharp } = await import("sharp");
const customArt = await import("../../src/meta/custom-art.js");
const gameMeta = await import("../../src/meta/game-meta.js");
const old = path.join(data, "custom-art");
fs.mkdirSync(old, { recursive: true });
const jpeg = (w, h, color) => sharp({ create: { width: w, height: h, channels: 3, background: color } }).jpeg().toBuffer();
const put = async (name, body) => fs.writeFileSync(path.join(old, name), await body);
const folderOf = (id) => path.join(gameMeta.GAMES_DIR, fs.readdirSync(gameMeta.GAMES_DIR).find((d) => d.endsWith(`[${id}]`)));

const A = "0100000000010000";
const B = "0100000000020000";
const C = "0100000000030000";
await put(`${A}.icon.jpg`, jpeg(512, 512, "#ff0000"));
await put(`${A}.icon.orig.webp`, sharp({ create: { width: 900, height: 600, channels: 3, background: "#ff0000" } }).webp().toBuffer());
await put(`${A}.icon.orig.json`, `${JSON.stringify({ crop: { x: 0.1, y: 0, w: 0.5, h: 1 }, at: 1 })}\n`);
await put(`${A}.icon.thumb.q75.webp`, Promise.resolve("old small copy"));
await put(`${A}.screen.0.jpg`, jpeg(1280, 720, "#00ff00"));
await put(`${A}.screen.3.jpg`, jpeg(1280, 720, "#0000ff"));
// Half done: a run stopped after writing the new banner, before taking the old one out.
await put(`${B}.banner.jpg`, jpeg(1280, 720, "#000000"));
const bDir = path.join(gameMeta.GAMES_DIR, `Game [${B}]`);
fs.mkdirSync(bDir, { recursive: true });
fs.writeFileSync(path.join(bDir, "banner.webp"), await sharp({ create: { width: 1280, height: 720, channels: 3, background: "#ffffff" } }).webp().toBuffer());
fs.writeFileSync(path.join(bDir, "banner.orig.webp"), await sharp({ create: { width: 1280, height: 720, channels: 3, background: "#ffffff" } }).webp().toBuffer());
// A picture that cannot be read stays where it is.
await put(`${C}.icon.jpg`, Promise.resolve("broken"));

test("custom-art moves into the game folders, half-done moves finish, and a broken file stays", async () => {
  const r = await customArt.migrate();
  assert.deepEqual(r, { moved: 4, failed: 1 });

  const a = folderOf(A);
  assert.deepEqual(fs.readdirSync(a).sort(), [
    "icon.orig.json", "icon.orig.webp", "icon.webp",
    "screenshot-01.orig.json", "screenshot-01.orig.webp", "screenshot-01.webp",
    "screenshot-04.orig.json", "screenshot-04.orig.webp", "screenshot-04.webp",
  ]);
  assert.equal((await sharp(path.join(a, "icon.webp")).metadata()).format, "webp");
  assert.equal((await sharp(path.join(a, "icon.orig.webp")).metadata()).width, 900, "the kept original moves as it is");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(a, "icon.orig.json"), "utf8")).crop, { x: 0.1, y: 0, w: 0.5, h: 1 });
  assert.deepEqual(customArt.list(A), { icon: true, banner: false, screens: [0, 3] });
  assert.deepEqual(customArt.originals(A).icon, { x: 0.1, y: 0, w: 0.5, h: 1 });

  const { dominant } = await sharp(path.join(bDir, "banner.webp")).stats();
  assert.ok(dominant.r > 200 && dominant.g > 200, "the newer banner already moved is kept");
  assert.equal(customArt.hasOverride(B, "banner"), true);

  assert.deepEqual(fs.readdirSync(old), [`${C}.icon.jpg`], "only the file that could not move is left");
  assert.equal(customArt.hasOverride(C, "icon"), false);
  assert.deepEqual(await customArt.migrate(), { moved: 0, failed: 1 }, "running again changes nothing");
});

test("cutting again works from the moved original", async () => {
  await customArt.recrop(A, "icon", null, { x: 0, y: 0, w: 0.5, h: 1 });
  const meta = await sharp(customArt.pathFor(A, "icon", null)).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height], ["webp", 450, 600]);
  assert.deepEqual(customArt.originals(A).icon, { x: 0, y: 0, w: 0.5, h: 1 });
});
