import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// An uploaded picture is cut to the area the admin chose; the upload itself is
// kept smaller beside the art, so the area can be chosen again without another
// upload, and taking the art out takes the kept original with it.
const data = fs.mkdtempSync(path.join(os.tmpdir(), "cook-art-crop-"));
process.env.COOK_DATA_DIR = data;
process.env.COOK_UPLOADS_ENABLED = "true";
process.env.COOK_EXTRACT_ICONS = "off";
process.env.COOK_TITLEDB_AUTO_FETCH = "false";
process.env.COOK_ESHOP_ARTWORK = "false";

const { default: sharp } = await import("sharp");
const { default: express } = await import("express");
const artCrop = await import("../../src/meta/art-crop.js");
const customArt = await import("../../src/meta/custom-art.js");
const { createMediaStore } = await import("../../src/meta/item-media.js");
const { default: artRouter } = await import("../../src/routes/art.js");
await customArt.init();

const app = express();
app.use("/api/art", artRouter());
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const URL_BASE = `http://127.0.0.1:${server.address().port}/api/art`;
after(() => { server.close(); fs.rmSync(data, { recursive: true, force: true }); });

const BASE = "0100000000ABC000";

// 400 x 200: the left half red, the right half blue. A crop of the right half is all blue.
async function halves(w = 400, h = 200) {
  const blue = await sharp({ create: { width: w / 2, height: h, channels: 3, background: "#0000ff" } }).png().toBuffer();
  return sharp({ create: { width: w, height: h, channels: 3, background: "#ff0000" } }).composite([{ input: blue, left: w / 2, top: 0 }]).png().toBuffer();
}
async function color(buf) {
  // Read as bytes: a path the server just rewrote must not be answered from an earlier decode.
  const { dominant } = await sharp(typeof buf === "string" ? fs.readFileSync(buf) : buf).stats();
  return dominant;
}
const isBlue = (c) => c.b > 150 && c.r < 100;
const isRed = (c) => c.r > 150 && c.b < 100;

function form(buf, crop) {
  const fd = new FormData();
  fd.append("file", new Blob([buf], { type: "image/png" }), "pic.png");
  if (crop !== undefined) fd.append("crop", typeof crop === "string" ? crop : JSON.stringify(crop));
  return fd;
}
const post = (p, body) => fetch(URL_BASE + p, { method: "POST", body });
const postJson = (p, body) => fetch(URL_BASE + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("parseCrop takes fractions inside the picture and refuses the rest", () => {
  assert.equal(artCrop.parseCrop(undefined), null);
  assert.equal(artCrop.parseCrop(""), null);
  assert.deepEqual(artCrop.parseCrop('{"x":0.5,"y":0,"w":0.5,"h":1}'), { x: 0.5, y: 0, w: 0.5, h: 1 });
  for (const bad of ["nope", "{}", { x: -0.1, y: 0, w: 0.5, h: 0.5 }, { x: 0.6, y: 0, w: 0.5, h: 0.5 }, { x: 0, y: 0, w: 0, h: 1 },
    { x: 0, y: 0, w: "1", h: 1 }, { x: 0, y: 0, w: Infinity, h: 1 }, "x".repeat(300)]) {
    assert.throws(() => artCrop.parseCrop(bad), artCrop.CropError, JSON.stringify(bad));
  }
});

test("a game's upload keeps only the chosen area, and the original beside it", async () => {
  const r = await post(`/${BASE}/banner`, form(await halves(), { x: 0.5, y: 0, w: 0.5, h: 1 }));
  assert.equal(r.status, 201);
  const body = await r.json();
  assert.deepEqual(body.originals.banner, { x: 0.5, y: 0, w: 0.5, h: 1 });

  const art = customArt.pathFor(BASE, "banner", null);
  const meta = await sharp(art).metadata();
  assert.deepEqual([meta.width, meta.height], [200, 200], "only the right half, never enlarged");
  assert.ok(isBlue(await color(art)));

  // The original is the whole upload, upright, as a WebP.
  const orig = await fetch(`${URL_BASE}/${BASE}/banner/original`);
  assert.equal(orig.status, 200);
  assert.equal(orig.headers.get("content-type"), "image/webp");
  const origBuf = Buffer.from(await orig.arrayBuffer());
  const om = await sharp(origBuf).metadata();
  assert.deepEqual([om.format, om.width, om.height], ["webp", 400, 200]);

  const listed = await (await fetch(`${URL_BASE}/${BASE}`)).json();
  assert.deepEqual(listed.originals.banner, { x: 0.5, y: 0, w: 0.5, h: 1 });
  assert.equal(listed.originals.icon, null);
});

test("the kept original is no longer than 2048 pixels on a side", async () => {
  const big = await sharp({ create: { width: 4096, height: 1024, channels: 3, background: "#00ff00" } }).png().toBuffer();
  const r = await post(`/${BASE}/screenshot`, form(big));
  assert.equal(r.status, 201);
  const { idx, originals } = await r.json();
  assert.deepEqual(originals.screens[idx], artCrop.FULL, "no area given is the whole picture");
  const om = await sharp(customArt.original(BASE, "screenshot", idx).image).metadata();
  assert.deepEqual([om.width, om.height], [2048, 512]);
  await fetch(`${URL_BASE}/${BASE}/screenshot/${idx}`, { method: "DELETE" });
});

test("cutting again uses the kept original and only the new area", async () => {
  const up = await (await post(`/${BASE}/icon`, form(await halves(), { x: 0.5, y: 0, w: 0.5, h: 1 }))).json();
  assert.match(up.urls.icon, new RegExp(`^/api/shop/icon/${BASE}\\?v=[0-9a-f]{12}$`));
  const art = customArt.pathFor(BASE, "icon", null);
  assert.ok(isBlue(await color(art)));
  const before = customArt.revision(BASE);

  const r = await postJson(`/${BASE}/icon/crop`, { crop: { x: 0, y: 0, w: 0.5, h: 1 } });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.deepEqual(body.originals.icon, { x: 0, y: 0, w: 0.5, h: 1 });
  assert.ok(isRed(await color(art)), "the left half now");
  assert.ok(customArt.revision(BASE) > before);
  assert.notEqual(body.urls.icon, up.urls.icon, "the shop address changes so the page and every cache show the new one");
});

test("a bad area, a missing original or a bad slot is refused before anything is written", async () => {
  const art = customArt.pathFor(BASE, "icon", null);
  const was = fs.readFileSync(art);
  let r = await post(`/${BASE}/icon`, form(await halves(), { x: 0.9, y: 0, w: 0.5, h: 1 }));
  assert.equal(r.status, 400);
  r = await post(`/${BASE}/icon`, form(await halves(), { x: 0, y: 0, w: 0.01, h: 0.01 }));
  assert.equal(r.status, 400, "smaller than the smallest area worth keeping");
  r = await post(`/${BASE}/icon`, form(await halves(), "not json"));
  assert.equal(r.status, 400);
  assert.deepEqual(fs.readFileSync(art), was);

  r = await postJson(`/${BASE}/icon/crop`, { crop: { x: 0, y: 0, w: 2, h: 1 } });
  assert.equal(r.status, 400);
  r = await postJson(`/${BASE}/icon/crop`, {});
  assert.equal(r.status, 400);
  r = await postJson(`/0100000000DEF000/icon/crop`, { crop: { x: 0, y: 0, w: 1, h: 1 } });
  assert.equal(r.status, 404, "nothing uploaded, nothing to cut again");
  r = await fetch(`${URL_BASE}/0100000000DEF000/banner/original`);
  assert.equal(r.status, 404);
  r = await fetch(`${URL_BASE}/..%2F..%2Fetc/icon/original`);
  assert.equal(r.status, 400);
  r = await postJson(`/${BASE}/screenshot/99/crop`, { crop: { x: 0, y: 0, w: 1, h: 1 } });
  assert.equal(r.status, 400);
});

test("taking a game's art out takes its kept original too", async () => {
  const art = customArt.pathFor(BASE, "icon", null);
  const { image, meta } = artCrop.originalPaths(art);
  assert.ok(fs.existsSync(image) && fs.existsSync(meta));
  const r = await fetch(`${URL_BASE}/${BASE}/icon`, { method: "DELETE" });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).originals.icon, null);
  assert.ok(!fs.existsSync(image) && !fs.existsSync(meta));
  assert.equal((await fetch(`${URL_BASE}/${BASE}/icon/original`)).status, 404);
});

test("an item's pictures are cut, kept, cut again and taken out alike", async () => {
  const store = createMediaStore({
    dir: path.join(data, "items", "media"), file: path.join(data, "items", "media.json"),
    idRe: /^m-[0-9a-f]{12}$/, urlBase: (id) => `/api/items/${id}`, label: "test media",
  });
  const ID = "m-0123456789ab";
  await store.saveBanner(ID, await halves(), { crop: { x: 0.5, y: 0, w: 0.5, h: 1 } });
  assert.ok(isBlue(await color(store.bannerPath(ID))));
  assert.deepEqual(store.originals(ID).banner, { x: 0.5, y: 0, w: 0.5, h: 1 });
  const v1 = store.bannerVersion(ID);

  await store.recrop(ID, "banner", null, { x: 0, y: 0, w: 0.5, h: 1 });
  assert.ok(isRed(await color(store.bannerPath(ID))));
  assert.notEqual(store.bannerVersion(ID), v1, "a new address");
  await assert.rejects(store.recrop(ID, "icon", null, artCrop.FULL), /원본이 없습니다/);

  // Screenshots: the kept originals close up with the pictures when one is taken out.
  await store.addShots(ID, [await halves()], { crop: { x: 0, y: 0, w: 0.5, h: 1 } });
  await store.addShots(ID, [await halves()], { crop: { x: 0.5, y: 0, w: 0.5, h: 1 } });
  assert.deepEqual(store.originals(ID).screenshots, [{ x: 0, y: 0, w: 0.5, h: 1 }, { x: 0.5, y: 0, w: 0.5, h: 1 }]);
  await store.removeShots(ID, 1);
  assert.deepEqual(store.originals(ID).screenshots, [{ x: 0.5, y: 0, w: 0.5, h: 1 }]);
  assert.ok(!fs.existsSync(artCrop.originalPaths(store.shotPath(ID, 2)).image));
  await store.recrop(ID, "shot", 1, { x: 0, y: 0, w: 0.5, h: 1 });
  assert.ok(isRed(await color(store.shotPath(ID, 1))));

  // A picture found on its own (not an upload) keeps no original.
  await store.saveBanner(ID, await halves(), { source: "sgdb" });
  assert.equal(store.originals(ID).banner, null);

  store.removeShots(ID);
  await store.removeBanner(ID);
  const left = fs.readdirSync(path.join(data, "items", "media", ID)).filter((f) => f.includes(".orig."));
  assert.deepEqual(left, []);
});
