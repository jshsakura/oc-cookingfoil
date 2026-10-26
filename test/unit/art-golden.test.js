import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Golden for the picture pipeline, taken before art-ingest replaces its writers: what is stored for an
// upload (format, size, extra files), what the routes send at each size, and what is refused. Properties,
// not byte hashes, so a sharp upgrade does not move it. A rewrite must keep every line here true.
const data = mkdtempSync(path.join(tmpdir(), "cook-art-golden-"));
process.env.COOK_DATA_DIR = data;
process.env.COOK_EXTRACT_ICONS = "off";
const BASE = "0100000000FAB000";
mkdirSync(path.join(data, "titledb"), { recursive: true });
writeFileSync(path.join(data, "titledb", "US.en.json"), "{}");

const { default: sharp } = await import("sharp");
const png = (w, h, color = "#3060c0") => sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();
const icons = path.join(data, "icons");
mkdirSync(icons, { recursive: true });
writeFileSync(path.join(icons, `${BASE}.jpg`), await sharp({ create: { width: 256, height: 256, channels: 3, background: "#c04030" } }).jpeg().toBuffer());

const { default: express } = await import("express");
const store = await import("../../src/meta/titledb-store.js");
const art = await import("../../src/meta/custom-art.js");
const gameMeta = await import("../../src/meta/game-meta.js");
const { drawBanner } = await import("../../src/meta/icon-banner.js");
const { default: iconRoute } = await import("../../src/routes/icon.js");
const { default: bannerRoute } = await import("../../src/routes/banner.js");
await store.load();
await art.init();

const app = express();
app.get("/api/library/icon/:titleId", iconRoute);
app.get("/api/library/banner/:titleId", bannerRoute);
const server = app.listen(0);
after(() => { server.close(); rmSync(data, { recursive: true, force: true }); });
const origin = `http://127.0.0.1:${server.address().port}`;

const meta = async (file) => { const m = await sharp(file).metadata(); return { format: m.format, w: m.width, h: m.height, exif: Boolean(m.exif) }; };
const folder = () => gameMeta.ensureFolder(BASE);
const files = () => readdirSync(folder()).filter((n) => !n.startsWith(".")).sort();

test("an upload is stored as WebP inside the slot's size, shape kept, never enlarged", async () => {
  const cases = [
    ["icon", null, [3000, 2000], { w: 1024, h: 683 }],
    ["icon", null, [200, 100], { w: 200, h: 100 }],
    ["banner", null, [4000, 3000], { w: 960, h: 720 }],
    ["screenshot", 0, [3840, 2160], { w: 1280, h: 720 }],
  ];
  for (const [kind, idx, [w, h], want] of cases) {
    const r = await art.put(BASE, kind, idx, await png(w, h));
    const m = await meta(r.path);
    assert.equal(m.format, "webp");
    assert.equal(m.exif, false, "no metadata is kept");
    assert.deepEqual({ w: m.w, h: m.h }, want, `${kind} ${w}x${h}`);
  }
});

test("what an upload leaves in the game's folder: the picture, and its original cut to 2048", async () => {
  await art.put(BASE, "icon", null, await png(5000, 4000));
  assert.deepEqual(files().filter((n) => n.startsWith("icon")), ["icon.orig.json", "icon.orig.webp", "icon.webp"]);
  const orig = await meta(path.join(folder(), "icon.orig.webp"));
  assert.equal(orig.format, "webp");
  assert.equal(Math.max(orig.w, orig.h), 2048, "the kept original is shrunk, not the upload");
  assert.equal(existsSync(path.join(folder(), "icon.orig.json")), true);
});

test("a picture that cannot be read is refused and leaves the slot as it was", async () => {
  const before = files();
  await assert.rejects(() => art.put(BASE, "icon", null, Buffer.from("not a picture")));
  assert.deepEqual(files(), before);
});

test("an upload turned by EXIF is stored upright", async () => {
  const turned = await sharp({ create: { width: 400, height: 200, channels: 3, background: "#208040" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const r = await art.put(BASE, "banner", null, turned);
  const m = await meta(r.path);
  assert.deepEqual({ w: m.w, h: m.h }, { w: 200, h: 400 });
});

test("the drawn banner is a JPEG of the library's banner shape", async () => {
  const m = await sharp(await drawBanner(await png(256, 256))).metadata();
  assert.equal(m.format, "jpeg");
  assert.deepEqual({ w: m.width, h: m.height }, { w: 1280, h: 720 });
});

test("the icon route sends WebP at each size, and never above the stored picture", async () => {
  await art.put(BASE, "icon", null, await png(3000, 3000));
  const wide = { sm: 160, md: 256, lg: 512, xl: 512 };
  for (const [size, px] of Object.entries(wide)) {
    const r = await fetch(`${origin}/api/library/icon/${BASE}?size=${size}`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "image/webp");
    const m = await sharp(Buffer.from(await r.arrayBuffer())).metadata();
    assert.equal(Math.max(m.width, m.height), px, size);
  }
  const full = await fetch(`${origin}/api/library/icon/${BASE}`);
  const fm = await sharp(Buffer.from(await full.arrayBuffer())).metadata();
  assert.ok(Math.max(fm.width, fm.height) <= 1024);
});

test("removing a slot takes its picture and its original away", async () => {
  await art.put(BASE, "screenshot", 1, await png(1920, 1080));
  assert.ok(files().includes("screenshot-02.orig.webp"));
  await art.remove(BASE, "screenshot", 1);
  assert.deepEqual(files().filter((n) => n.startsWith("screenshot-02")), []);
});
