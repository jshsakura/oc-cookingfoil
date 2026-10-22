import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { dropVariants, removeOldVariants, serveImage } from "../../src/meta/image-cache.js";

async function served(file, query, opts = {}, accept = "image/jpeg") {
  const res = { headers: {} };
  res.set = (k, v) => { res.headers[k] = v; return res; };
  res.type = (t) => { res.contentType = t; return res; };
  const sent = new Promise((resolve) => { res.sendFile = resolve; });
  const req = { query, get: () => accept };
  await serveImage(req, res, { cachePath: file, ...opts });
  return sharp(await sent).metadata();
}

function sentFile(file, query, opts = {}) {
  const res = { headers: {}, set() { return res; }, type() { return res; } };
  const sent = new Promise((resolve) => { res.sendFile = resolve; });
  serveImage({ query, get: () => "image/webp" }, res, { cachePath: file, ...opts });
  return sent;
}

async function picture(width, height) {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "cf-img-")), "a.jpg");
  await sharp({ create: { width, height, channels: 3, background: "#808080" } }).jpeg().toFile(file);
  return file;
}

test("icons are cropped to a square at 160, 256 and 512 px", async () => {
  const file = await picture(1024, 1024);
  assert.deepEqual(await served(file, { size: "sm" }).then((m) => [m.width, m.height]), [160, 160]);
  assert.deepEqual(await served(file, { size: "md" }).then((m) => [m.width, m.height]), [256, 256]);
  assert.deepEqual(await served(file, { size: "lg" }).then((m) => [m.width, m.height]), [512, 512]);
});

test("screenshots keep their aspect ratio instead of being cropped", async () => {
  const file = await picture(1280, 720);
  assert.deepEqual(await served(file, { size: "sm" }, { wide: true }).then((m) => [m.width, m.height]), [256, 144]);
  assert.deepEqual(await served(file, { size: "md" }, { wide: true }).then((m) => [m.width, m.height]), [512, 288]);
  assert.deepEqual(await served(file, { size: "lg" }, { wide: true }).then((m) => [m.width, m.height]), [512, 288]);
});

test("xl is the screen width for screenshots and banners, never enlarged", async () => {
  const big = await picture(1920, 1080);
  assert.deepEqual(await served(big, { size: "xl" }, { wide: true }).then((m) => [m.width, m.height]), [1280, 720]);
  const small = await picture(800, 450);
  assert.equal((await served(small, { size: "xl" }, { wide: true })).width, 800);
});

// What the console client sends, what a browser's <img> sends, and a client that names nothing.
const ACCEPTS = ["image/webp,image/*;q=0.8", "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8", "*/*", ""];

test("every client gets WebP, at every size and at full size, with no Vary on Accept", async () => {
  const file = await picture(1280, 720);
  for (const accept of ACCEPTS) {
    for (const size of ["sm", "md", "lg", "xl", undefined]) {
      const res = { headers: {} };
      res.set = (k, v) => { res.headers[k] = v; return res; };
      res.type = (t) => { res.contentType = t; return res; };
      const sent = new Promise((resolve) => { res.sendFile = resolve; });
      await serveImage({ query: { size }, get: () => accept }, res, { cachePath: file, wide: true });
      const meta = await sharp(await sent).metadata();
      assert.equal(meta.format, "webp", `${size ?? "full"} for ${accept || "no Accept"}`);
      assert.equal(res.contentType, "image/webp");
      assert.equal(res.headers.Vary, undefined, "the bytes no longer depend on Accept");
    }
  }
});

test("variants are WebP in thumbs/<the source's folder>/, never beside the source", async () => {
  const file = await picture(1024, 1024);
  for (const size of ["sm", "md", "lg", undefined]) await served(file, { size }, {}, "*/*");
  assert.deepEqual(readdirSync(path.dirname(file)), ["a.jpg"], "nothing written next to the source");
  const thumbs = path.join(path.dirname(path.dirname(file)), "thumbs", path.basename(path.dirname(file)));
  const made = readdirSync(thumbs).sort();
  assert.deepEqual(made, ["a.full.q75.webp", "a.md.q75.webp", "a.sm.q75.webp", "a.thumb.q75.webp"]);
});

test("a source rewritten under its name gets new variants once dropVariants is told", async () => {
  const file = await picture(512, 512);
  const red = await sharp({ create: { width: 512, height: 512, channels: 3, background: "#ff0000" } }).jpeg().toBuffer();
  writeFileSync(file, red);
  const before = await sharp(await sentFile(file, { size: "sm" })).stats();
  assert.ok(before.channels[0].mean > 200, "red first");
  writeFileSync(file, await sharp({ create: { width: 512, height: 512, channels: 3, background: "#0000ff" } }).jpeg().toBuffer());
  dropVariants(file);
  const after = await sharp(await sentFile(file, { size: "sm" })).stats();
  assert.ok(after.channels[2].mean > 200 && after.channels[0].mean < 60, "blue now, not the old red variant");
});

test("old JPEG and WebP variants beside the sources are removed at start; the sources stay", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cf-old-"));
  const extracted = path.join(dir, "extracted");
  mkdirSync(extracted);
  const ID = "0100000000ABC000";
  const sources = [
    `${ID}.jpg`, `${ID}.banner.jpg`, `${ID}.screen.0.jpg`, `${ID}.screen.12.jpg`, `${ID}.icon.ko.jpg`, `${ID}.banner.ja.jpg`,
    // Named like a variant but not one: another extension, not a title id, a part written halfway.
    `${ID}.md.png`, "notes.sm.jpg", `${ID}.sm.jpg.tmp.123`, `${ID}.thumb.jpeg`,
  ];
  const old = [
    `${ID}.sm.jpg`, `${ID}.thumb.jpg`, `${ID}.md.jpg`, `${ID}.thumb.webp`, `${ID}.sm.q75.webp`, `${ID}.md.q75.webp`,
    `${ID}.banner.thumb-wide.jpg`, `${ID}.banner.md-wide.q75.webp`, `${ID}.banner.xl-wide.q50.webp`, `${ID}.banner.xl-wide.jpg`,
    `${ID}.screen.0.thumb-wide.jpg`, `${ID}.screen.12.md-wide.webp`, `${ID}.icon.ko.sm.jpg`, `${ID}.icon.ko.thumb.q75.webp`,
    `${ID}.banner.ja.md-wide.jpg`,
  ];
  for (const f of [...sources, ...old]) writeFileSync(path.join(extracted, f), f);
  assert.equal(await removeOldVariants(extracted), old.length);
  assert.deepEqual(readdirSync(extracted).sort(), [...sources].sort(), "only the old variants went");
  for (const f of sources) assert.equal(readFileSync(path.join(extracted, f), "utf8"), f, `${f} untouched`);
  assert.equal(await removeOldVariants(extracted), 0, "a second start finds nothing to remove");
  assert.equal(await removeOldVariants(path.join(dir, "missing")), 0, "no folder yet: nothing to do");
});

test("the full-screen xl WebP is the lighter cut of the same picture", async () => {
  const file = await picture(1280, 720);
  const res = { headers: {}, set() { return res; }, type() { return res; } };
  const at = (size) => new Promise((resolve) => {
    res.sendFile = resolve;
    serveImage({ query: { size }, get: () => "image/webp" }, res, { cachePath: file, wide: true });
  });
  assert.match(await at("xl"), /\.xl-wide\.q50\.webp$/);
  assert.match(await at("md"), /\.md-wide\.q75\.webp$/);
});

test("an unknown size serves the picture at its own size, as WebP", async () => {
  const file = await picture(1280, 720);
  const meta = await served(file, { size: "huge" }, { wide: true });
  assert.deepEqual([meta.format, meta.width], ["webp", 1280]);
});

test("no more than MAX_ENCODES variants are encoded at once", async (t) => {
  const { MAX_ENCODES } = await import("../../src/meta/image-cache.js");
  const files = await Promise.all(Array.from({ length: 12 }, () => picture(64, 64)));
  let now = 0;
  let most = 0;
  const toFile = sharp.prototype.toFile;
  t.mock.method(sharp.prototype, "toFile", async function (...args) {
    most = Math.max(most, ++now);
    try {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return await toFile.apply(this, args);
    } finally {
      now--;
    }
  });
  await Promise.all(files.map((f) => sentFile(f, { size: "sm" })));
  assert.equal(most, MAX_ENCODES);
});
