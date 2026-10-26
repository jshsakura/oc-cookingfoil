import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// data/icons is indexed when image-cache loads, so the icons are placed first.
const data = fs.mkdtempSync(path.join(os.tmpdir(), "cook-icon-banner-"));
process.env.COOK_DATA_DIR = data;
after(() => fs.rmSync(data, { recursive: true, force: true }));
const ID = "0100000000AAA000";
const { default: sharp } = await import("sharp");
const square = (color) => sharp({ create: { width: 256, height: 256, channels: 3, background: color } }).jpeg().toBuffer();
const icons = path.join(data, "icons");
fs.mkdirSync(icons, { recursive: true });
fs.writeFileSync(path.join(icons, `${ID}.jpg`), await square("#e04040"));
fs.writeFileSync(path.join(icons, `${ID}.icon.en.jpg`), await square("#4040e0"));

const { ensureBanner } = await import("../../src/meta/icon-banner.js");
const { forget } = await import("../../src/meta/image-cache.js");

const center = async (file) => {
  const { data: px } = await sharp(file).extract({ left: 640, top: 360, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
  return [...px];
};

test("a banner is a 16:9 picture drawn from the icon, with the icon in the middle", async () => {
  const file = await ensureBanner(ID);
  assert.equal(file, path.join(icons, `${ID}.banner.jpg`));
  const meta = await sharp(file).metadata();
  assert.deepEqual([meta.width, meta.height], [1280, 720]);
  const [r, , b] = await center(file);
  assert.ok(r > 180 && b < 100, "the default icon's red sits in the middle");
});

test("a language with its own icon gets its own banner; one without gets the default", async () => {
  const en = await ensureBanner(ID, "en");
  assert.equal(en, path.join(icons, `${ID}.banner.en.jpg`));
  const [r, , b] = await center(en);
  assert.ok(b > 180 && r < 100, "drawn from the English icon");
  assert.equal(await ensureBanner(ID, "ja"), path.join(icons, `${ID}.banner.jpg`));
});

test("a banner is drawn again only when its icon is newer, and a game without an icon has none", async () => {
  const file = await ensureBanner(ID);
  const before = fs.statSync(file).mtimeMs;
  assert.equal(await ensureBanner(ID), file);
  assert.equal(fs.statSync(file).mtimeMs, before, "not drawn twice");
  const icon = path.join(icons, `${ID}.jpg`);
  fs.writeFileSync(icon, await square("#40e040"));
  fs.utimesSync(icon, new Date(), new Date(Date.now() + 5000));
  forget(icon);
  await ensureBanner(ID);
  const [, g] = await center(file);
  assert.ok(g > 180, "the new icon shows");
  assert.equal(await ensureBanner("0100000000BBB000"), null);
});
