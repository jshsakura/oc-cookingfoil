import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { ART, NACP_ICON, IngestError, coverSpec, fetchImage, ingest, shrink, sidecarSpec, versionOf, writeAtomic, MAX_INPUT_BYTES } from "../../src/meta/art-ingest.js";

const work = fs.mkdtempSync(path.join(os.tmpdir(), "cf-ingest-"));
after(() => fs.rmSync(work, { recursive: true, force: true }));
const png = (w, h, color = "#3060c0") => sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();
const info = (buf) => sharp(buf).metadata().then((m) => ({ format: m.format, w: m.width, h: m.height, exif: Boolean(m.exif) }));
const refused = (p, code) => assert.rejects(p, (err) => err instanceof IngestError && err.code === code, code);

test("every profile gives its format, stays inside its size, keeps the shape and never enlarges", async () => {
  assert.deepEqual(await info(await shrink(await png(3000, 2000), ART.icon)), { format: "webp", w: 1024, h: 683, exif: false });
  assert.deepEqual(await info(await shrink(await png(4000, 3000), ART.banner)), { format: "webp", w: 960, h: 720, exif: false });
  assert.deepEqual(await info(await shrink(await png(800, 400), ART.screenshot)), { format: "webp", w: 800, h: 400, exif: false });
  assert.deepEqual(await info(await shrink(await png(1000, 500), NACP_ICON)), { format: "jpeg", w: 256, h: 128, exif: false });
  assert.deepEqual(await info(await shrink(await png(2000, 1000), sidecarSpec(640, 360))), { format: "webp", w: 640, h: 320, exif: false });
  assert.deepEqual(await info(await shrink(await png(1200, 900), coverSpec(600, 400))), { format: "png", w: 533, h: 400, exif: false });
});

test("a picture turned by EXIF comes out upright, and the metadata is gone", async () => {
  const turned = await sharp({ create: { width: 400, height: 200, channels: 3, background: "#208040" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  assert.deepEqual(await info(await shrink(turned, ART.icon)), { format: "webp", w: 200, h: 400, exif: false });
});

test("what cannot be read, is empty, has no size to shrink to or is over the limits is refused, and nothing is written", async () => {
  const dest = path.join(work, "never.webp");
  await refused(ingest({ input: Buffer.from("not a picture"), spec: ART.icon, dest }), "unreadable");
  await refused(ingest({ input: Buffer.alloc(0), spec: ART.icon, dest }), "empty");
  await refused(ingest({ input: "text", spec: ART.icon, dest: dest }).catch((e) => { throw e; }), "unreadable");
  await refused(shrink(await png(10, 10), { format: "webp", width: 0, height: 0 }), "no-size");
  await refused(shrink(await png(10, 10), { format: "gif", width: 10, height: 10 }), "bad-format");
  await refused(ingest({ input: Buffer.alloc(100), spec: ART.icon, dest, maxBytes: 50 }), "too-big");
  const huge = await sharp({ create: { width: 8000, height: 8000, channels: 3, background: "#000" } }).png({ compressionLevel: 9 }).toBuffer();
  await refused(shrink(huge, ART.icon), "unreadable"); // 64 million pixels, over the 50 million limit
  assert.equal(fs.existsSync(dest), false);
  assert.deepEqual(fs.readdirSync(work).filter((n) => n.includes("never")), []);
});

test("ingest keeps one file, the shrunk picture: no original of the input is stored beside it", async () => {
  const dest = path.join(work, "game", "icon.webp");
  const input = await png(5000, 4000);
  const r = await ingest({ input, spec: ART.icon, dest });
  assert.deepEqual(fs.readdirSync(path.dirname(dest)), ["icon.webp"]);
  assert.equal(r.bytes, fs.statSync(dest).size);
  assert.ok(r.bytes < input.length);
  assert.equal(r.version, versionOf(fs.readFileSync(dest)));
  assert.match(r.version, /^[0-9a-f]{12}$/);
  assert.equal(Math.max((await info(fs.readFileSync(dest))).w, (await info(fs.readFileSync(dest))).h), 1024);
});

test("the version changes when the picture does and not otherwise", async () => {
  const a = await shrink(await png(300, 300, "#ff0000"), ART.icon);
  const b = await shrink(await png(300, 300, "#00ff00"), ART.icon);
  assert.equal(versionOf(a), versionOf(await shrink(await png(300, 300, "#ff0000"), ART.icon)));
  assert.notEqual(versionOf(a), versionOf(b));
});

test("writeAtomic leaves the whole file, and no dot file behind", () => {
  const file = path.join(work, "atomic", "x.bin");
  writeAtomic(file, Buffer.from("one"));
  writeAtomic(file, Buffer.from("two"));
  assert.equal(fs.readFileSync(file, "utf8"), "two");
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ["x.bin"]);
});

test("fetchImage reads up to the limit and drops what is longer, however the server announces it", async () => {
  const stream = (chunks) => ({ ok: true, status: 200, headers: new Headers(), body: (async function* () { for (const c of chunks) yield Buffer.alloc(c, 1); })() });
  assert.equal((await fetchImage("https://example.com/a.png", { fetchImpl: async () => stream([10, 10]), maxBytes: 100 })).length, 20);
  await refused(fetchImage("https://example.com/a.png", { fetchImpl: async () => stream([60, 60]), maxBytes: 100 }), "too-big");
  await refused(fetchImage("https://example.com/a.png", { fetchImpl: async () => ({ ok: true, status: 200, headers: new Headers({ "content-length": "999" }), body: (async function* () {})() }), maxBytes: 100 }), "too-big");
  await refused(fetchImage("https://example.com/a.png", { fetchImpl: async () => ({ ok: false, status: 404, headers: new Headers(), body: null }) }), "http");
  assert.equal(MAX_INPUT_BYTES, 32 * 1024 * 1024);
});
