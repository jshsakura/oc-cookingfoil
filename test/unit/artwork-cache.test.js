import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Shop artwork URLs carry ?v=<hash of what decides the bytes>. A request whose
// v is the current one may be kept for good; one without v (or with an old v)
// gets a short cache plus an ETag, so a client that cached by URL never keeps a
// replaced picture.
const data = mkdtempSync(path.join(tmpdir(), "cook-art-cache-"));
process.env.COOK_DATA_DIR = data;
process.env.COOK_EXTRACT_ICONS = "off";
process.env.COOK_ESHOP_ARTWORK = "false";
const BASE = "0100000000ABC000";
const NO_DB = "0100000000EEE000";
mkdirSync(path.join(data, "titledb"), { recursive: true });
// load() prefers the slim copy it writes beside the region file, so drop it to read a new one.
const titledb = (iconUrl) => rmSync(path.join(data, "titledb", "US.en.slim.json"), { force: true }) ?? writeFileSync(path.join(data, "titledb", "US.en.json"), JSON.stringify({
  "70010000000001": { id: BASE, name: "Test", iconUrl, bannerUrl: "https://cdn/banner.jpg", screenshots: ["https://cdn/s0.jpg"] },
}));
titledb("https://cdn/icon-1.jpg");

const { default: sharp } = await import("sharp");
const { default: express } = await import("express");
const store = await import("../../src/meta/titledb-store.js");
const art = await import("../../src/meta/custom-art.js");
const { versionedArtwork, artworkVersion } = await import("../../src/meta/artwork-version.js");
const { default: iconRoute } = await import("../../src/routes/icon.js");
const { default: bannerRoute } = await import("../../src/routes/banner.js");
const { default: screenshotRoute } = await import("../../src/routes/screenshot.js");
await store.load();
await art.init();

const jpeg = (w, h, color = "#808080") => sharp({ create: { width: w, height: h, channels: 3, background: color } }).jpeg().toBuffer();
const extracted = path.join(data, "extracted");
mkdirSync(extracted, { recursive: true });
writeFileSync(path.join(extracted, `${BASE}.jpg`), await jpeg(512, 512));
writeFileSync(path.join(extracted, `${BASE}.banner.jpg`), await jpeg(1920, 1080));
writeFileSync(path.join(extracted, `${BASE}.screen.0.jpg`), await jpeg(1920, 1080));

const app = express();
app.get("/api/shop/icon/:titleId", iconRoute);
app.get("/api/shop/banner/:titleId", bannerRoute);
app.get("/api/shop/screenshot/:titleId/:idx", screenshotRoute);
const server = app.listen(0);
after(() => { server.close(); rmSync(data, { recursive: true, force: true }); });
const origin = `http://127.0.0.1:${server.address().port}`;
const IMMUTABLE = "public, max-age=31536000, immutable";

test("artwork URLs carry ?v= of 12 hex characters, the same for every size", () => {
  const url = versionedArtwork(`/api/shop/icon/${BASE}`);
  assert.match(url, /^\/api\/shop\/icon\/0100000000ABC000\?v=[0-9a-f]{12}$/);
  assert.equal(url.split("v=")[1], artworkVersion("icon", BASE));
  assert.match(versionedArtwork(`/api/shop/screenshot/${BASE}/0`), /\/0\?v=[0-9a-f]{12}$/);
  assert.equal(artworkVersion("icon", "0100000000ABC800"), artworkVersion("icon", BASE), "an update shares its game's icon");
  assert.match(versionedArtwork(`/api/shop/icon/${BASE}`, "ja"), /\?v=[0-9a-f]{12}&lang=ja$/);
});

test("v changes with the source: a new titledb image, and an uploaded icon", async () => {
  const first = artworkVersion("icon", BASE);
  titledb("https://cdn/icon-2.jpg");
  await store.load();
  const second = artworkVersion("icon", BASE);
  assert.notEqual(second, first, "titledb points at another image");
  await art.put(BASE, "icon", null, await jpeg(300, 300, "#FFC23D"));
  const custom = artworkVersion("icon", BASE);
  assert.notEqual(custom, second, "uploaded art");
  assert.notEqual(artworkVersion("banner", BASE), custom, "each slot has its own");
  await art.remove(BASE, "icon", null);
  assert.equal(artworkVersion("icon", BASE), second, "back to titledb's image");
});

test("a game titledb does not know is versioned by its icon file", async () => {
  const none = artworkVersion("icon", NO_DB);
  writeFileSync(path.join(extracted, `${NO_DB}.jpg`), await jpeg(256, 256));
  const file = artworkVersion("icon", NO_DB);
  assert.notEqual(file, none);
  writeFileSync(path.join(extracted, `${NO_DB}.jpg`), await jpeg(256, 256, "#000000"));
  assert.notEqual(artworkVersion("icon", NO_DB), file, "rewritten icon");
});

for (const [kind, url, size] of [
  ["icon", `/api/shop/icon/${BASE}`, "md"],
  ["banner", `/api/shop/banner/${BASE}`, "xl"],
  ["screenshot", `/api/shop/screenshot/${BASE}/0`, "xl"],
]) {
  test(`${kind}: immutable only for the current v; otherwise short, with ETag and 304`, async () => {
    const current = versionedArtwork(url);
    const hit = await fetch(`${origin}${current}&size=${size}`, { headers: { Accept: "image/webp" } });
    assert.equal(hit.status, 200);
    assert.equal(hit.headers.get("cache-control"), IMMUTABLE);
    assert.equal(hit.headers.get("content-type"), "image/webp");
    assert.match(hit.headers.get("vary") ?? "", /Accept/);

    for (const stale of [url, `${url}?v=0.8`, `${url}?v=000000000000`]) {
      const r = await fetch(`${origin}${stale}`);
      assert.equal(r.status, 200);
      assert.equal(r.headers.get("cache-control"), "public, max-age=300", stale);
      const etag = r.headers.get("etag");
      assert.ok(etag, "an ETag to revalidate with");
      assert.equal((await fetch(`${origin}${stale}`, { headers: { "If-None-Match": etag, "Cache-Control": "max-age=0" } })).status, 304);
    }
    const jpegOnly = await fetch(`${origin}${current}&size=${size}`);
    assert.equal(jpegOnly.headers.get("content-type"), "image/jpeg", "no WebP without Accept: image/webp");
  });
}
