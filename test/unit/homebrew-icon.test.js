import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import sharp from "sharp";
import { homebrewRouter, homebrewIconVersion } from "../../src/routes/homebrew.js";

// The client keeps an icon by its URL for good, so icon_url names the build
// (?v=) and only that URL is immutable; WebP goes to clients that ask for it.
const ID = "gh-0123456789ab";
let hash = "sha256:abc";
const jpeg = await sharp({ create: { width: 256, height: 256, channels: 3, background: "#3366CC" } }).jpeg({ quality: 90 }).toBuffer();
const small = await sharp({ create: { width: 128, height: 128, channels: 3, background: "#CC3366" } }).jpeg().toBuffer();
let icon = jpeg;
const service = {
  list: async () => [{ id: ID, name: "App", version: "1", author: "a", size: 9, hash, file_name: "app.nro", source: "github" }],
  icon: async (id) => (id === ID ? icon : null),
};
const app = express();
app.use("/api/homebrew", homebrewRouter({ service }));
const server = app.listen(0);
after(() => server.close());
const base = `http://127.0.0.1:${server.address().port}/api/homebrew`;
const IMMUTABLE = "public, max-age=31536000, immutable";

async function iconUrl() {
  return (await (await fetch(base)).json()).homebrew[0].icon_url;
}

test("icon_url carries a 12-hex v that follows the build", async () => {
  const url = await iconUrl();
  assert.match(url, /^\/api\/homebrew\/gh-0123456789ab\/icon\?v=[0-9a-f]{12}$/);
  assert.equal(url.split("v=")[1], homebrewIconVersion({ hash }));
  hash = "sha256:def";
  assert.notEqual(await iconUrl(), url, "a new build, a new v");
});

test("WebP only with Accept: image/webp, at most 256 px, Vary: Accept, immutable only for the current v", async () => {
  const url = await iconUrl();
  const webp = await fetch(`http://127.0.0.1:${server.address().port}${url}&size=md`, { headers: { Accept: "image/webp,*/*" } });
  assert.equal(webp.headers.get("content-type"), "image/webp");
  assert.equal(webp.headers.get("cache-control"), IMMUTABLE);
  assert.match(webp.headers.get("vary") ?? "", /Accept/);
  const meta = await sharp(Buffer.from(await webp.arrayBuffer())).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height], ["webp", 256, 256]);

  const sm = await fetch(`http://127.0.0.1:${server.address().port}${url}&size=sm`, { headers: { Accept: "image/webp" } });
  assert.equal((await sharp(Buffer.from(await sm.arrayBuffer())).metadata()).width, 160);

  const plain = await fetch(`http://127.0.0.1:${server.address().port}${url}&size=md`);
  assert.equal(plain.headers.get("content-type"), "image/jpeg", "Tinfoil-style clients keep JPEG");
  assert.deepEqual(Buffer.from(await plain.arrayBuffer()), jpeg, "the NRO's own icon, untouched");

  const old = await fetch(`${base}/${ID}/icon`);
  assert.equal(old.headers.get("cache-control"), "public, max-age=300");
  const etag = old.headers.get("etag");
  assert.ok(etag);
  assert.equal((await fetch(`${base}/${ID}/icon`, { headers: { "If-None-Match": etag, "Cache-Control": "max-age=0" } })).status, 304);
  assert.equal((await fetch(`${base}/${ID}/icon?v=000000000000`)).headers.get("cache-control"), "public, max-age=300");
});

test("a small icon is never enlarged", async () => {
  icon = small;
  hash = "sha256:small";
  const url = await iconUrl();
  const r = await fetch(`http://127.0.0.1:${server.address().port}${url}&size=md`, { headers: { Accept: "image/webp" } });
  const meta = await sharp(Buffer.from(await r.arrayBuffer())).metadata();
  assert.deepEqual([meta.format, meta.width], ["webp", 128]);
  icon = jpeg;
});
