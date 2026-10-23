import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Taking a game's picture out moves it, with the original kept for cutting again, to the trash as
// one entry; a restore brings both back and the game shows the picture again.
const base = fs.mkdtempSync(path.join(os.tmpdir(), "cook-custom-art-trash-"));
for (const k of ["games", "data"]) fs.mkdirSync(path.join(base, k), { recursive: true });
process.env.COOK_GAMES_DIR = path.join(base, "games");
process.env.COOK_DATA_DIR = path.join(base, "data");
process.env.COOK_EXTRACT_ICONS = "off";
process.env.COOK_TITLEDB_AUTO_FETCH = "false";
process.env.COOK_ESHOP_ARTWORK = "false";
after(() => fs.rmSync(base, { recursive: true, force: true }));

const { default: sharp } = await import("sharp");
const customArt = await import("../../src/meta/custom-art.js");
const service = await import("../../src/library/trash-service.js");
const ID = "0100000000080000";
const by = { type: "admin", name: "test" };

test("a removed icon and its kept original go to the trash as one entry and come back", async () => {
  const picture = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#0a0" } }).png().toBuffer();
  await customArt.put(ID, "icon", null, picture, { x: 0, y: 0, w: 0.5, h: 0.5 });
  const file = customArt.pathFor(ID, "icon", null);
  assert.ok(file && customArt.original(ID, "icon", null));

  const out = await customArt.remove(ID, "icon", null, { by });
  assert.equal(customArt.pathFor(ID, "icon", null), null);
  const [entry] = (await service.list()).items.filter((e) => e.id === out.id);
  assert.equal(entry.items.length, 3, "the picture, its kept original and the original's area");
  assert.equal(entry.by.name, "test");

  const { failed } = await service.restore([out.id], by);
  assert.deepEqual(failed, []);
  assert.equal(customArt.pathFor(ID, "icon", null), file);
  assert.deepEqual(customArt.original(ID, "icon", null).crop, { x: 0, y: 0, w: 0.5, h: 0.5 });
});

test("a restore onto a slot filled again since is refused, and the entry stays in the trash", async () => {
  const pic = (c) => sharp({ create: { width: 32, height: 32, channels: 3, background: c } }).png().toBuffer();
  await customArt.put(ID, "banner", null, await pic("#a00"));
  const out = await customArt.remove(ID, "banner", null, { by });
  await customArt.put(ID, "banner", null, await pic("#00a"));
  const { restored, failed } = await service.restore([out.id], by);
  assert.equal(restored.length, 0);
  assert.equal(failed.length, 1);
  assert.ok((await service.list()).items.some((e) => e.id === out.id));
  assert.ok(!fs.readdirSync(path.dirname(customArt.pathFor(ID, "banner", null))).some((n) => n.includes("(2)")), "no numbered copies left beside it");
});

test("removing a slot with no picture moves nothing", async () => {
  assert.equal(await customArt.remove(ID, "screenshot", 5, { by }), null);
});
