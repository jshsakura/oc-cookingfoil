import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

// Point all on-disk caches at a throwaway dir BEFORE importing the modules
// that read COOK_DATA_DIR at load time.
const DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "cook-extract-test-"));
process.env.COOK_DATA_DIR = DATA_DIR;

const { cachePathFor, forget } = await import("../../src/meta/image-cache.js");
const extractor = await import("../../src/meta/nacp-extractor.js");
const extractedMeta = await import("../../src/meta/extracted-meta-store.js");

// Distinct ID per test — the on-disk icon cache and the extracted-meta store
// both persist across tests in the shared DATA_DIR, so reusing one ID would
// let test order leak state.
const BASE_CACHED = "0100000000010000";
const BASE_FRESH = "0100000000020000";
const BASE_HOMEBREW = "0100000000030000";

before(async () => {
  await extractedMeta.load();
});

beforeEach(() => {
  extractor.resetForTests();
});

/** Provider stub that records calls and returns a canned record. */
function stubProvider(record, calls) {
  return {
    name: "stub-test",
    async extract(job) {
      calls.push(job);
      return record;
    },
  };
}

test("wantMeta=false + icon already on disk → skips the container dump", async () => {
  const iconPath = cachePathFor(BASE_CACHED, "icon");
  await fs.mkdir(path.dirname(iconPath), { recursive: true });
  await fs.writeFile(iconPath, Buffer.from("cached-jpeg"));
  forget(iconPath);

  const calls = [];
  extractor.setProvider(stubProvider({ iconBuffer: Buffer.from("new") }, calls));

  extractor.enqueue({ absPath: "/games/x.nsp", baseTitleId: BASE_CACHED, wantMeta: false });
  await extractor.whenDrained();

  assert.equal(calls.length, 0, "provider.extract must not run when icon is cached");
  assert.equal(extractedMeta.get(BASE_CACHED), null, "no metadata written for icon-only title");
});

test("wantMeta=false + no icon → extracts icon but writes no metadata", async () => {
  const calls = [];
  extractor.setProvider(
    stubProvider({ name: "Should Not Persist", iconBuffer: Buffer.from("icon-bytes") }, calls)
  );

  extractor.enqueue({ absPath: "/games/y.nsp", baseTitleId: BASE_FRESH, wantMeta: false });
  await extractor.whenDrained();

  assert.equal(calls.length, 1, "provider.extract runs when no icon is cached");
  const written = await fs.readFile(cachePathFor(BASE_FRESH, "icon"));
  assert.equal(written.toString(), "icon-bytes", "extracted icon persisted to disk");
  assert.equal(extractedMeta.get(BASE_FRESH), null, "titledb-covered title stores no fallback meta");
});

test("wantMeta=true → persists both the icon and the fallback metadata", async () => {
  const calls = [];
  extractor.setProvider(
    stubProvider({ name: "Homebrew Title", publisher: "Acme", iconBuffer: Buffer.from("hb") }, calls)
  );

  extractor.enqueue({ absPath: "/games/z.nsp", baseTitleId: BASE_HOMEBREW, wantMeta: true });
  await extractor.whenDrained();

  assert.equal(calls.length, 1);
  const rec = extractedMeta.get(BASE_HOMEBREW);
  assert.ok(rec, "metadata record written for an uncovered title");
  assert.equal(rec.name, "Homebrew Title");
  assert.equal(rec.publisher, "Acme");
});

test("an older record is extracted once more for language icons, keeping its hand-fixed name and icon", async () => {
  const BASE = "0100000000040000";
  const iconPath = cachePathFor(BASE, "icon");
  await fs.mkdir(path.dirname(iconPath), { recursive: true });
  await fs.writeFile(iconPath, Buffer.from("korean-icon"));
  forget(iconPath);
  await extractedMeta.put({ id: BASE, name: "Fixed By Hand", source: "nacp-nsp" });
  const calls = [];
  extractor.setProvider(stubProvider({
    name: "� broken", iconBuffer: Buffer.from("korean-icon"),
    iconsByLang: { ko: Buffer.from("korean-icon"), en: Buffer.from("english-icon"), ja: Buffer.from("japanese-icon") },
  }, calls));

  assert.equal(extractor.enqueue({ absPath: "/x.nsp", baseTitleId: BASE, fileName: "x.nsp" }), true);
  await extractor.whenDrained();

  const rec = extractedMeta.get(BASE);
  assert.equal(rec.name, "Fixed By Hand");
  assert.deepEqual(rec.iconLangs, ["en", "ja"], "ko matches the default icon, so it is not saved again");
  assert.equal((await fs.readFile(cachePathFor(BASE, "icon-lang", "en"))).toString(), "english-icon");
  assert.equal((await fs.readFile(iconPath)).toString(), "korean-icon");

  extractor.resetForTests();
  assert.equal(extractor.enqueue({ absPath: "/x.nsp", baseTitleId: BASE, fileName: "x.nsp" }), false, "done once");
  assert.equal(calls.length, 1);
});

test("a record stored with a garbled name reads as nameless and is read again in full, once", async () => {
  const BASE = "0100000000050000";
  await extractedMeta.put({ id: BASE, name: "\uFFFD\u0013\uFFFD", publisher: "\uFFFDp", iconLangs: [], source: "nacp-nsp" });
  assert.equal(extractedMeta.get(BASE).name, null, "the garbled name is not shown meanwhile");
  assert.equal(extractedMeta.get(BASE).publisher, null);
  assert.equal(extractor.needsReread(extractedMeta.get(BASE)), true);
  const calls = [];
  extractor.setProvider(stubProvider({ name: "Fresh Name", publisher: "Fresh Pub", source: "nacp-nsp", iconBuffer: Buffer.from("fresh-icon") }, calls));

  assert.equal(extractor.enqueue({ absPath: "/g.nsp", baseTitleId: BASE, fileName: "g.nsp" }), true);
  await extractor.whenDrained();

  assert.equal(calls[0].langIconsOnly, false, "a full read, not icons only");
  const rec = extractedMeta.get(BASE);
  assert.equal(rec.name, "Fresh Name");
  assert.equal(rec.publisher, "Fresh Pub");
  assert.equal(extractor.needsReread(rec), false);
  extractor.resetForTests();
  assert.equal(extractor.enqueue({ absPath: "/g.nsp", baseTitleId: BASE, fileName: "g.nsp" }), false, "done once");
});

test("a record from the old icon mapping is extracted once more, its old Chinese icon dropped", async () => {
  const BASE = "0100000000050000";
  const iconPath = cachePathFor(BASE, "icon");
  await fs.mkdir(path.dirname(iconPath), { recursive: true });
  await fs.writeFile(iconPath, Buffer.from("korean-icon"));
  forget(iconPath);
  // main's mapping saved the traditional icon as zh.
  await fs.writeFile(cachePathFor(BASE, "icon-lang", "zh"), Buffer.from("traditional-icon"));
  forget(cachePathFor(BASE, "icon-lang", "zh"));
  await extractedMeta.put({ id: BASE, name: "Kept", source: "nacp-nsp", iconLangs: ["zh"] });
  assert.equal(extractor.needsLangIcons(extractedMeta.get(BASE)), true, "an old record asks for its icons again");
  const calls = [];
  extractor.setProvider(stubProvider({
    name: "ignored", iconBuffer: Buffer.from("korean-icon"),
    iconsByLang: { ko: Buffer.from("korean-icon"), "zh-Hant": Buffer.from("traditional-icon"), de: Buffer.from("german-icon") },
  }, calls));

  assert.equal(extractor.enqueue({ absPath: "/x.nsp", baseTitleId: BASE, fileName: "x.nsp" }), true);
  await extractor.whenDrained();

  const rec = extractedMeta.get(BASE);
  assert.equal(rec.name, "Kept");
  assert.deepEqual(rec.iconLangs, ["zh-Hant", "de"]);
  assert.equal(extractor.needsLangIcons(rec), false);
  await assert.rejects(fs.access(cachePathFor(BASE, "icon-lang", "zh")), "the traditional icon saved as zh is gone");
  assert.equal((await fs.readFile(cachePathFor(BASE, "icon-lang", "zh-Hant"))).toString(), "traditional-icon");

  extractor.resetForTests();
  assert.equal(extractor.enqueue({ absPath: "/x.nsp", baseTitleId: BASE, fileName: "x.nsp" }), false, "left alone from now on");
  assert.equal(calls.length, 1);
});

test("a second pass that cannot read the file leaves the record as it was", async () => {
  const BASE = "0100000000060000";
  await extractedMeta.put({ id: BASE, name: "Kept", source: "nacp-nsp", iconLangs: ["en"] });
  extractor.setProvider(stubProvider(null, []));
  extractor.enqueue({ absPath: "/x.nsp", baseTitleId: BASE, fileName: "x.nsp" });
  await extractor.whenDrained();
  assert.deepEqual(extractedMeta.get(BASE).iconLangs, ["en"]);
  assert.equal(extractor.needsLangIcons(extractedMeta.get(BASE)), true, "tried again on a later start");
});
