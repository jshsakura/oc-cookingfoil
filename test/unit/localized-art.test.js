import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// data/icons is indexed when image-cache loads, so the data dir and its icons come first.
const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "localized-art-"));
process.env.COOK_DATA_DIR = tmpRoot;
const ID = "0100AAAA00000000";
await mkdir(path.join(tmpRoot, "icons"), { recursive: true });
// The game file's default icon, and its English icon_<Language>.dat (saved only where it differs).
await writeFile(path.join(tmpRoot, "icons", `${ID}.jpg`), "default");
await writeFile(path.join(tmpRoot, "icons", `${ID}.icon.en.jpg`), "english");

const art = await import("../../src/meta/localized-art.js");

test("a language gets its own icon when the game file saved one for it", () => {
  assert.deepEqual(art.iconSource(ID, "en"), { file: true });
  assert.equal(art.iconSource(ID, "ja"), null, "same art as the default");
  assert.equal(art.iconSource(ID, null), null, "the default itself");
  assert.deepEqual(art.iconLangs(ID), ["en"]);
  assert.equal(art.iconKnown(ID, "ja"), true, "the default icon stands in");
  assert.equal(art.iconKnown("0100BBBB00000000", "ja"), false, "a game with no icon read yet");
});

test("a banner follows its icon, and unknown languages get nothing", () => {
  assert.equal(art.bannerSource(ID, "en"), "en", "drawn from the English icon");
  assert.equal(art.bannerSource(ID, "ja"), null);
  assert.equal(art.bannerKnown(ID, "ja"), true);
  assert.equal(art.bannerKnown("0100BBBB00000000", "ja"), false);
  assert.equal(art.artLang("sv"), null);
  assert.equal(art.artLang("fr"), "fr");
  assert.equal(art.artLang("zh-TW"), "zh-Hant");
  assert.equal(art.artLang("EN"), "en");
});
