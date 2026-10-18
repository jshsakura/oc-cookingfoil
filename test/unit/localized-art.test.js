import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// titledbCacheDir is fixed at import time, so the data dir is pinned first.
const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "localized-art-"));
process.env.COOK_DATA_DIR = tmpRoot;
await mkdir(path.join(tmpRoot, "titledb"), { recursive: true });
const write = (file, json) => writeFile(path.join(tmpRoot, "titledb", file), JSON.stringify(json));
await write("KR.ko.json", { a: { id: "0100AAAA00000000", name: "한국판", iconUrl: "https://cdn/ko-icon.jpg", bannerUrl: "https://cdn/ko-banner.jpg" } });
await write("US.en.json", { b: { id: "0100AAAA00000000", name: "US", iconUrl: "https://cdn/en-icon.jpg", bannerUrl: "https://cdn/ko-banner.jpg" } });
await write("JP.ja.json", { c: { id: "0100AAAA00000000", name: "JP", iconUrl: "https://cdn/ko-icon.jpg" } });

const store = await import("../../src/meta/titledb-store.js");
const art = await import("../../src/meta/localized-art.js");
await store.load();

test("a language gets its own eShop icon only when it differs from the default", () => {
  assert.deepEqual(art.iconSource("0100AAAA00000000", "en"), { url: "https://cdn/en-icon.jpg" });
  assert.equal(art.iconSource("0100AAAA00000000", "ja"), null, "same art as the default");
  assert.equal(art.iconSource("0100AAAA00000000", "ko"), null, "the default itself");
  assert.deepEqual(art.iconLangs("0100AAAA00000000"), ["en"]);
});

test("banners follow the same rule, and unknown languages get nothing", () => {
  assert.equal(art.bannerSource("0100AAAA00000000", "en"), null);
  assert.equal(art.artLang("fr"), null);
  assert.equal(art.artLang("EN"), "en");
});
