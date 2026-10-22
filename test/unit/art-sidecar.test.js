import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import sharp from "sharp";
import * as sidecar from "../../src/meta/art-sidecar.js";
import { createMediaStore } from "../../src/meta/item-media.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "art-sidecar-"));
const img = (w, h, r, format = "png") => sharp({ create: { width: w, height: h, channels: 3, background: { r, g: 0, b: 0 } } })[format]().toBuffer();
const put = (file, buf, ageSec = 0) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
  const t = Date.now() / 1000 - ageSec;
  fs.utimesSync(file, t, t);
};
const until = async (ok) => {
  for (let i = 0; i < 100 && !ok(); i++) await new Promise((r) => setTimeout(r, 20));
  assert.ok(ok(), "settled in time");
};

test("only pictures at a folder's root are its pictures, by name", () => {
  for (const ok of ["icon.webp", "banner.jpg", "screenshot-01.png", "Icon.JPG", "screenshot-12.jpeg"]) assert.ok(sidecar.isArtSidecar(ok), ok);
  for (const no of ["romfs/icon.webp", "icon.gif", "screenshot-1.webp", "screenshot-00.webp", "icon.orig.webp", "cover.jpg"]) assert.ok(!sidecar.isArtSidecar(no), no);
  assert.equal(sidecar.slotName("shot", 3), "screenshot-03");
});

test("each slot shows its newest file, screenshots in their order, and a hand-placed .jpg is tidied into .webp", async () => {
  const dir = tmp();
  put(path.join(dir, "icon.webp"), await img(64, 64, 10, "webp"), 20);
  put(path.join(dir, "icon.jpg"), await img(64, 64, 200, "jpeg"), 3600);
  put(path.join(dir, "screenshot-03.webp"), await img(32, 18, 30, "webp"), 20);
  put(path.join(dir, "screenshot-01.webp"), await img(32, 18, 10, "webp"), 20);
  put(path.join(dir, "notes.txt"), Buffer.from("x"));
  const got = sidecar.read(dir);
  assert.equal(path.basename(got.icon.file), "icon.jpg", "one put in by hand wins, even with an older date from its copy");
  assert.deepEqual(got.shots.map((s) => s.slot), ["screenshot-01", "screenshot-03"]);
  assert.equal(got.banner, null);
  assert.equal(got.untidy, true);

  put(path.join(dir, "banner.png"), await img(64, 36, 10));
  assert.equal(await sidecar.normalize(dir, () => [512, 512]), 1, "one still being copied in waits");
  assert.ok(fs.existsSync(path.join(dir, "banner.png")));
  fs.rmSync(path.join(dir, "banner.png"));
  assert.deepEqual(fs.readdirSync(dir).sort(), ["icon.webp", "notes.txt", "screenshot-01.webp", "screenshot-03.webp"]);
  assert.equal((await sharp(path.join(dir, "icon.webp")).metadata()).format, "webp");
  assert.ok((await sharp(path.join(dir, "icon.webp")).stats()).channels[0].mean > 150, "the hand-placed picture, not the older one");
  assert.equal(sidecar.read(dir).untidy, false);
});

test("a picture that cannot be read is left where it is; names an item owns are never touched", async () => {
  const dir = tmp();
  put(path.join(dir, "banner.png"), Buffer.from("not a picture"), 60);
  put(path.join(dir, "icon.jpg"), await img(16, 16, 10, "jpeg"), 60);
  const errors = [];
  await sidecar.normalize(dir, () => [64, 64], { ignore: new Set(["icon.jpg"]), onError: (slot) => errors.push(slot) });
  assert.deepEqual(errors, ["banner"]);
  assert.deepEqual(fs.readdirSync(dir).sort(), ["banner.png", "icon.jpg"]);
  assert.equal(sidecar.read(dir, { ignore: new Set(["icon.jpg"]) }).icon, null);
});

test("an item with a folder keeps its pictures there; one changed by hand is served at once", async () => {
  const data = tmp();
  const home = tmp();
  const ID = "m-0123456789ab";
  const store = createMediaStore({ dir: path.join(data, "media"), file: path.join(data, "media.json"), idRe: /^m-[0-9a-f]{12}$/,
    urlBase: (id) => `/x/${id}`, homeOf: (id) => (id === ID ? home : null) });
  await store.saveBanner(ID, await img(1600, 900, 10));
  assert.equal(store.bannerPath(ID), path.join(home, "banner.webp"));
  assert.deepEqual((await sharp(store.bannerPath(ID)).metadata()).width, 1280);
  assert.equal(fs.readdirSync(path.join(data, "media", ID)).every((f) => f.includes(".orig.")), true, "only the kept original is on the server");
  const v1 = store.bannerVersion(ID);

  put(path.join(home, "banner.jpg"), await img(320, 180, 220, "jpeg"), 3600);
  assert.notEqual(store.bannerVersion(ID), v1, "the hand-placed one shows without a restart");
  assert.equal(path.extname(store.bannerPath(ID)), ".jpg");
  await until(() => !fs.existsSync(path.join(home, "banner.jpg")));
  assert.deepEqual(fs.readdirSync(home), ["banner.webp"]);
  assert.ok((await sharp(store.bannerPath(ID)).stats()).channels[0].mean > 150);

  fs.rmSync(path.join(home, "banner.webp"));
  assert.equal(store.urls(ID).banner_url, null, "taken out by hand, gone");
  await store.forget(ID);
  assert.equal(fs.existsSync(home), true, "the folder is never forgotten with the record");
});

test("pictures kept the old way move into the item's folder once, the folder's own winning", async () => {
  const data = tmp();
  const home = tmp();
  const ID = "m-0123456789ab";
  const own = path.join(data, "media", ID);
  put(path.join(own, "icon.webp"), await img(64, 64, 10, "webp"));
  put(path.join(own, "icon.jpg"), await img(64, 64, 10, "jpeg"));
  put(path.join(own, "banner.webp"), await img(64, 36, 10, "webp"));
  put(path.join(own, "shot-1.webp"), await img(64, 36, 40, "webp"));
  put(path.join(own, "shot-1.orig.webp"), await img(64, 36, 40, "webp"));
  put(path.join(own, "shot-2.webp"), await img(64, 36, 50, "webp"));
  put(path.join(home, "banner.webp"), await img(64, 36, 250, "webp"));
  const store = createMediaStore({ dir: path.join(data, "media"), file: path.join(data, "media.json"), idRe: /^m-[0-9a-f]{12}$/,
    urlBase: (id) => `/x/${id}`, homeOf: () => home });

  assert.deepEqual(store.urls(ID).screenshots.length, 2);
  assert.deepEqual(fs.readdirSync(home).sort(), ["banner.webp", "icon.webp", "screenshot-01.webp", "screenshot-02.webp"]);
  assert.ok((await sharp(path.join(home, "banner.webp")).stats()).channels[0].mean > 200, "the folder's banner stays");
  assert.deepEqual(fs.readdirSync(own), ["screenshot-01.orig.webp"], "no copy left behind but the kept original");
});

test("a picture that could not be moved into the item's folder is still shown from the server", async () => {
  const data = tmp();
  const ID = "m-0123456789ab";
  put(path.join(data, "media", ID, "icon.webp"), await img(64, 64, 10, "webp"));
  const store = createMediaStore({ dir: path.join(data, "media"), file: path.join(data, "media.json"), idRe: /^m-[0-9a-f]{12}$/,
    urlBase: (id) => `/x/${id}`, homeOf: () => path.join(data, "media.json") });
  fs.writeFileSync(path.join(data, "media.json"), "{}");
  assert.ok(store.iconPath(ID).startsWith(path.join(data, "media")));
});
