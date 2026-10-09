import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { serveImage } from "../../src/meta/image-cache.js";

async function served(file, query, opts = {}) {
  const res = { headers: {} };
  res.set = (k, v) => { res.headers[k] = v; return res; };
  res.type = (t) => { res.contentType = t; return res; };
  const sent = new Promise((resolve) => { res.sendFile = resolve; });
  const req = { query, get: () => "image/jpeg" };
  await serveImage(req, res, { cachePath: file, ...opts });
  return sharp(await sent).metadata();
}

async function picture(width, height) {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "cf-img-")), "a.jpg");
  await sharp({ create: { width, height, channels: 3, background: "#808080" } }).jpeg().toFile(file);
  return file;
}

test("icons are cropped to a square at 256 and 512 px", async () => {
  const file = await picture(1024, 1024);
  assert.deepEqual(await served(file, { size: "sm" }).then((m) => [m.width, m.height]), [256, 256]);
  assert.deepEqual(await served(file, { size: "md" }).then((m) => [m.width, m.height]), [512, 512]);
});

test("screenshots keep their aspect ratio instead of being cropped", async () => {
  const file = await picture(1280, 720);
  assert.deepEqual(await served(file, { size: "sm" }, { wide: true }).then((m) => [m.width, m.height]), [256, 144]);
  assert.deepEqual(await served(file, { size: "md" }, { wide: true }).then((m) => [m.width, m.height]), [512, 288]);
});

test("an unknown size serves the original", async () => {
  const file = await picture(1280, 720);
  assert.equal((await served(file, { size: "xl" }, { wide: true })).width, 1280);
});
