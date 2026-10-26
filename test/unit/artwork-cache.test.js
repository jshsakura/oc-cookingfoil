import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Shop artwork URLs carry ?v=<hash of what decides the bytes>. A request whose
// v is the current one may be kept for good; one without v (or with an old v)
// gets a short cache plus an ETag, so a client that cached by URL never keeps a
// replaced picture.
const data = mkdtempSync(path.join(tmpdir(), "cook-art-cache-"));
process.env.COOK_DATA_DIR = data;
process.env.COOK_EXTRACT_ICONS = "off";
const BASE = "0100000000ABC000";
const NO_DB = "0100000000EEE000";
mkdirSync(path.join(data, "titledb"), { recursive: true });
writeFileSync(path.join(data, "titledb", "US.en.json"), JSON.stringify({
  "70010000000001": { id: BASE, name: "Test", iconUrl: "https://cdn/icon-1.jpg", bannerUrl: "https://cdn/banner.jpg", screenshots: ["https://cdn/s0.jpg"] },
}));

const { default: sharp } = await import("sharp");
const jpeg = (w, h, color = "#808080") => sharp({ create: { width: w, height: h, channels: 3, background: color } }).jpeg().toBuffer();
// The game file's icon, read before the server starts (data/icons is indexed once, at start).
const icons = path.join(data, "icons");
mkdirSync(icons, { recursive: true });
writeFileSync(path.join(icons, `${BASE}.jpg`), await jpeg(512, 512));

const { default: express } = await import("express");
const { forget } = await import("../../src/meta/image-cache.js");
const store = await import("../../src/meta/titledb-store.js");
const art = await import("../../src/meta/custom-art.js");
const { versionedArtwork, artworkVersion } = await import("../../src/meta/artwork-version.js");
const { default: iconRoute } = await import("../../src/routes/icon.js");
const { default: bannerRoute } = await import("../../src/routes/banner.js");
const { default: screenshotRoute } = await import("../../src/routes/screenshot.js");
await store.load();
await art.init();
// Game files carry no screenshots: the one served is the admin's.
await art.put(BASE, "screenshot", 0, await jpeg(1920, 1080));

const app = express();
app.get("/api/library/icon/:titleId", iconRoute);
app.get("/api/library/banner/:titleId", bannerRoute);
app.get("/api/library/screenshot/:titleId/:idx", screenshotRoute);
const server = app.listen(0);
after(() => { server.close(); rmSync(data, { recursive: true, force: true }); });
const origin = `http://127.0.0.1:${server.address().port}`;
const IMMUTABLE = "public, max-age=31536000, immutable";

test("artwork URLs carry ?v= of 12 hex characters, the same for every size", () => {
  const url = versionedArtwork(`/api/library/icon/${BASE}`);
  assert.match(url, /^\/api\/library\/icon\/0100000000ABC000\?v=[0-9a-f]{12}$/);
  assert.equal(url.split("v=")[1], artworkVersion("icon", BASE));
  assert.match(versionedArtwork(`/api/library/screenshot/${BASE}/0`), /\/0\?v=[0-9a-f]{12}$/);
  assert.equal(artworkVersion("icon", "0100000000ABC800"), artworkVersion("icon", BASE), "an update shares its game's icon");
  assert.match(versionedArtwork(`/api/library/icon/${BASE}`, "ja"), /\?v=[0-9a-f]{12}&lang=ja$/);
});

test("v changes with the icon file and with an uploaded icon, never with titledb", async () => {
  const first = artworkVersion("icon", BASE);
  const banner = artworkVersion("banner", BASE);
  writeFileSync(path.join(data, "titledb", "US.en.json"), JSON.stringify({ "70010000000001": { id: BASE, name: "Test", iconUrl: "https://cdn/icon-2.jpg" } }));
  rmSync(path.join(data, "titledb", "US.en.slim.json"), { force: true });
  await store.load();
  assert.equal(artworkVersion("icon", BASE), first, "titledb's picture address is not the icon");
  writeFileSync(path.join(icons, `${BASE}.jpg`), await jpeg(512, 512, "#101010"));
  forget(path.join(icons, `${BASE}.jpg`));
  const second = artworkVersion("icon", BASE);
  assert.notEqual(second, first, "the game file's icon read again");
  assert.notEqual(artworkVersion("banner", BASE), banner, "the banner drawn from it follows");
  await art.put(BASE, "icon", null, await jpeg(300, 300, "#FFC23D"));
  const custom = artworkVersion("icon", BASE);
  assert.notEqual(custom, second, "uploaded art");
  assert.notEqual(artworkVersion("banner", BASE), custom, "each slot has its own");
  await art.remove(BASE, "icon", null);
  assert.equal(artworkVersion("icon", BASE), second, "back to the game file's icon");
});

test("a game titledb does not know is versioned by its icon file", async () => {
  const none = artworkVersion("icon", NO_DB);
  const file = path.join(icons, `${NO_DB}.jpg`);
  writeFileSync(file, await jpeg(256, 256));
  forget(file);
  const once = artworkVersion("icon", NO_DB);
  assert.notEqual(once, none);
  writeFileSync(file, await jpeg(256, 256, "#000000"));
  forget(file);
  assert.notEqual(artworkVersion("icon", NO_DB), once, "rewritten icon");
});

test("a game without an icon has no banner and no screenshot to send", async () => {
  for (const url of ["/api/library/icon/0100000000DDD000", "/api/library/banner/0100000000DDD000", "/api/library/screenshot/0100000000DDD000/0", `/api/library/screenshot/${BASE}/1`]) {
    assert.equal((await fetch(`${origin}${url}`)).status, 404, url);
  }
});

// The admin's pictures (the screenshot here) revalidate sooner: they are edited from the dashboard.
for (const [kind, url, size, short] of [
  ["icon", `/api/library/icon/${BASE}`, "md", "public, max-age=300"],
  ["banner", `/api/library/banner/${BASE}`, "xl", "public, max-age=300"],
  ["screenshot", `/api/library/screenshot/${BASE}/0`, "xl", "public, max-age=60, must-revalidate"],
]) {
  test(`${kind}: immutable only for the current v; otherwise short, with ETag and 304`, async () => {
    const current = versionedArtwork(url);
    const hit = await fetch(`${origin}${current}&size=${size}`, { headers: { Accept: "image/webp" } });
    assert.equal(hit.status, 200);
    assert.equal(hit.headers.get("cache-control"), IMMUTABLE);
    assert.equal(hit.headers.get("content-type"), "image/webp");
    assert.doesNotMatch(hit.headers.get("vary") ?? "", /Accept/, "one format for every client");

    for (const stale of [url, `${url}?v=0.8`, `${url}?v=000000000000`]) {
      const r = await fetch(`${origin}${stale}`);
      assert.equal(r.status, 200);
      assert.equal(r.headers.get("cache-control"), short, stale);
      const etag = r.headers.get("etag");
      assert.ok(etag, "an ETag to revalidate with");
      assert.equal((await fetch(`${origin}${stale}`, { headers: { "If-None-Match": etag, "Cache-Control": "max-age=0" } })).status, 304);
    }
  });
}

// What the console client sends, what a browser's <img> sends, and a client that names nothing.
const ACCEPTS = ["image/webp,image/*;q=0.8", "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8", null];

test("every image route answers WebP to the console, a browser and a client without Accept, at every size", async () => {
  for (const url of [`/api/library/icon/${BASE}`, `/api/library/banner/${BASE}`, `/api/library/screenshot/${BASE}/0`]) {
    for (const size of [null, "sm", "md", "lg", "xl"]) {
      for (const accept of ACCEPTS) {
        const r = await fetch(`${origin}${versionedArtwork(url)}${size ? `&size=${size}` : ""}`, accept ? { headers: { Accept: accept } } : {});
        const label = `${url} ${size ?? "full"} ${accept ?? "no Accept"}`;
        assert.equal(r.status, 200, label);
        assert.equal(r.headers.get("content-type"), "image/webp", label);
        assert.doesNotMatch(r.headers.get("vary") ?? "", /Accept/, label);
        assert.ok(r.headers.get("etag"), label);
        assert.equal((await sharp(Buffer.from(await r.arrayBuffer())).metadata()).format, "webp", label);
      }
    }
  }
  const sources = [`${BASE}.jpg`, `${BASE}.banner.jpg`, `${NO_DB}.jpg`];
  assert.deepEqual(readdirSync(icons).sort(), sources.sort(), "only the icons and the banner drawn from one");
  const thumbs = readdirSync(path.join(data, "thumbs", "icons"));
  assert.ok(thumbs.length && thumbs.every((f) => f.endsWith(".webp")), `only WebP variants: ${thumbs.join(", ")}`);
});
