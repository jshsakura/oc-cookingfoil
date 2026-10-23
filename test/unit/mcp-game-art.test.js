import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fromJsonSchema } from "@modelcontextprotocol/server";

const data = fs.mkdtempSync(path.join(os.tmpdir(), "cook-mcp-game-art-"));
process.env.COOK_DATA_DIR = data;
process.env.COOK_EXTRACT_ICONS = "off";
process.env.COOK_TITLEDB_AUTO_FETCH = "false";
process.env.COOK_ESHOP_ARTWORK = "false";
after(() => fs.rmSync(data, { recursive: true, force: true }));

const { default: sharp } = await import("sharp");
const { registry } = await import("../../src/capabilities/registry.js");
const { ART_ASPECT, fitCrop } = await import("../../src/meta/art-fit.js");

const BASE = "0100000000040000";
const URL_OK = "https://img-eshop.cdn.nintendo.net/i/picture.png";
const wide = await sharp({ create: { width: 400, height: 100, channels: 3, background: "#0a0" } }).png().toBuffer();

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => (String(url) === URL_OK ? new Response(wide, { status: 200 }) : realFetch(url, opts));
after(() => { globalThis.fetch = realFetch; });

async function valid(schema, value, label) {
  const { issues } = await fromJsonSchema(schema)["~standard"].validate(JSON.parse(JSON.stringify(value)));
  assert.equal(issues, undefined, `${label}: ${JSON.stringify(issues)}`);
}
const run = async (id, input, kind = "handler") => {
  const cap = registry.byId(id);
  const out = await cap[kind]({}, input);
  await valid(kind === "preview" ? cap.previewOutput : cap.output, out, `${id} ${kind}`);
  return out;
};
const failsWith = (status) => (err) => err.status === status;

test("fitCrop gives the largest centered area in the slot's shape", () => {
  assert.deepEqual(fitCrop(400, 100, 1), { x: 0.375, y: 0, w: 0.25, h: 1 });
  assert.deepEqual(fitCrop(100, 400, 16 / 9), { x: 0, y: 0.429688, w: 1, h: 0.140625 });
  assert.deepEqual(fitCrop(160, 90, 16 / 9), { x: 0, y: 0, w: 1, h: 1 });
});

test("fitCrop keeps a given area's width and place, nudged into shape and inside the picture", () => {
  assert.deepEqual(fitCrop(400, 100, 1, { x: 0, y: 0.5, w: 0.1, h: 0.9 }), { x: 0, y: 0.5, w: 0.1, h: 0.4 });
  assert.deepEqual(fitCrop(400, 100, 1, { x: 0.9, y: 0, w: 0.5, h: 1 }), { x: 0.75, y: 0, w: 0.25, h: 1 });
});

test("the server cuts to the same slot shapes the page's crop editor uses", () => {
  const page = fs.readFileSync(new URL("../../src/views/landing.html", import.meta.url), "utf8");
  const m = page.match(/const ART_ASPECT = (\{[^}]*\});/);
  assert.ok(m, "landing.html declares ART_ASPECT");
  assert.deepEqual(Function(`return ${m[1]}`)(), { ...ART_ASPECT });
});

test("game_art_set previews without storing, then sets a square icon cut from the middle", async () => {
  const preview = await run("game_art_set", { titleId: BASE, slot: "icon", url: URL_OK }, "preview");
  assert.deepEqual(preview.image, { width: 400, height: 100 });
  assert.deepEqual(preview.result, { width: 100, height: 100 });
  assert.equal(preview.replaces, null);
  assert.equal((await run("game_art", { titleId: BASE })).shown.icon, null, "the preview stored nothing");

  const done = await run("game_art_set", { titleId: BASE, slot: "icon", url: URL_OK });
  assert.deepEqual(done.crop, { x: 0.375, y: 0, w: 0.25, h: 1 });
  const art = await run("game_art", { titleId: BASE });
  assert.equal(art.shown.icon, "custom");
  assert.deepEqual(art.crops.icon, done.crop);
});

test("game_art_crop cuts the kept picture again to a new area", async () => {
  const preview = await run("game_art_crop", { titleId: BASE, slot: "icon", crop: { x: 0, y: 0, w: 0.25, h: 1 } }, "preview");
  assert.deepEqual(preview.now, { x: 0.375, y: 0, w: 0.25, h: 1 });
  assert.deepEqual(preview.crop, { x: 0, y: 0, w: 0.25, h: 1 });
  await run("game_art_crop", { titleId: BASE, slot: "icon", crop: { x: 0, y: 0, w: 0.25, h: 1 } });
  assert.deepEqual((await run("game_art", { titleId: BASE })).crops.icon, { x: 0, y: 0, w: 0.25, h: 1 });
});

test("game art tools refuse bad ids, hosts and slots with no kept picture", async () => {
  await assert.rejects(run("game_art", { titleId: "0100000000040800" }), failsWith(400));
  await assert.rejects(run("game_art_set", { titleId: BASE, slot: "icon", url: "https://example.com/a.png" }, "preview"), failsWith(400));
  await assert.rejects(run("game_art_set", { titleId: BASE, slot: "poster", url: URL_OK }, "preview"), failsWith(400));
  await assert.rejects(run("game_art_crop", { titleId: BASE, slot: "banner" }, "preview"), failsWith(404));
  await assert.rejects(run("game_art_crop", { titleId: BASE, slot: "screenshot" }, "preview"), failsWith(400));
});
