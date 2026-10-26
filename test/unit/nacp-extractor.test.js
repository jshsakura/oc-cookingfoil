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
const { default: sharp } = await import("sharp");

// Icons are recompressed before they are kept, so the stubs hand over real
// JPEGs, one flat colour each, and a kept icon is known by its colour.
const solid = ([r, g, b]) => sharp({ create: { width: 64, height: 64, channels: 3, background: { r, g, b } } }).jpeg().toBuffer();
const RGB = { korean: [200, 30, 30], english: [30, 200, 30], japanese: [30, 30, 200], traditional: [200, 200, 30], german: [30, 200, 200], fresh: [120, 60, 160], update: [90, 90, 90], plain: [160, 120, 60] };
const ICON = Object.fromEntries(await Promise.all(Object.entries(RGB).map(async ([k, rgb]) => [k, await solid(rgb)])));
async function colourOf(file) {
  const { channels } = await sharp(await fs.readFile(file)).stats();
  const mean = channels.slice(0, 3).map((c) => c.mean);
  return Object.keys(RGB).find((k) => RGB[k].every((v, i) => Math.abs(v - mean[i]) < 12)) ?? mean.join(",");
}

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
    stubProvider({ name: "Should Not Persist", iconBuffer: ICON.plain }, calls)
  );

  extractor.enqueue({ absPath: "/games/y.nsp", baseTitleId: BASE_FRESH, wantMeta: false });
  await extractor.whenDrained();

  assert.equal(calls.length, 1, "provider.extract runs when no icon is cached");
  assert.equal(await colourOf(cachePathFor(BASE_FRESH, "icon")), "plain", "extracted icon persisted to disk");
  assert.equal(extractedMeta.get(BASE_FRESH), null, "titledb-covered title stores no fallback meta");
});

test("wantMeta=true → persists both the icon and the fallback metadata", async () => {
  const calls = [];
  extractor.setProvider(
    stubProvider({ name: "Homebrew Title", publisher: "Acme", iconBuffer: ICON.plain }, calls)
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
  await fs.writeFile(iconPath, ICON.korean);
  forget(iconPath);
  await extractedMeta.put({ id: BASE, name: "Fixed By Hand", source: "nacp-nsp" });
  const calls = [];
  extractor.setProvider(stubProvider({
    name: "� broken", iconBuffer: ICON.korean,
    iconsByLang: { ko: ICON.korean, en: ICON.english, ja: ICON.japanese },
  }, calls));

  assert.equal(extractor.enqueue({ absPath: "/x.nsp", baseTitleId: BASE, fileName: "x.nsp" }), true);
  await extractor.whenDrained();

  const rec = extractedMeta.get(BASE);
  assert.equal(rec.name, "Fixed By Hand");
  assert.deepEqual(rec.iconLangs, ["en", "ja"], "ko matches the default icon, so it is not saved again");
  assert.equal(await colourOf(cachePathFor(BASE, "icon-lang", "en")), "english");
  assert.equal(await colourOf(iconPath), "korean");

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
  extractor.setProvider(stubProvider({ name: "Fresh Name", publisher: "Fresh Pub", source: "nacp-nsp", iconBuffer: ICON.fresh }, calls));

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
  await fs.writeFile(iconPath, ICON.korean);
  forget(iconPath);
  // main's mapping saved the traditional icon as zh.
  await fs.writeFile(cachePathFor(BASE, "icon-lang", "zh"), ICON.traditional);
  forget(cachePathFor(BASE, "icon-lang", "zh"));
  await extractedMeta.put({ id: BASE, name: "Kept", source: "nacp-nsp", iconLangs: ["zh"] });
  assert.equal(extractor.needsLangIcons(extractedMeta.get(BASE)), true, "an old record asks for its icons again");
  const calls = [];
  extractor.setProvider(stubProvider({
    name: "ignored", iconBuffer: ICON.korean,
    iconsByLang: { ko: ICON.korean, "zh-Hant": ICON.traditional, de: ICON.german },
  }, calls));

  assert.equal(extractor.enqueue({ absPath: "/x.nsp", baseTitleId: BASE, fileName: "x.nsp" }), true);
  await extractor.whenDrained();

  const rec = extractedMeta.get(BASE);
  assert.equal(rec.name, "Kept");
  assert.deepEqual(rec.iconLangs, ["zh-Hant", "de"]);
  assert.equal(extractor.needsLangIcons(rec), false);
  await assert.rejects(fs.access(cachePathFor(BASE, "icon-lang", "zh")), "the traditional icon saved as zh is gone");
  assert.equal(await colourOf(cachePathFor(BASE, "icon-lang", "zh-Hant")), "traditional");

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

test("an icon is kept at most 256px and recompressed, its language icons compared with the file's own bytes", async () => {
  const noise = Buffer.alloc(1024 * 1024 * 3).map(() => Math.floor(Math.random() * 256));
  const big = await sharp(noise, { raw: { width: 1024, height: 1024, channels: 3 } }).jpeg({ quality: 100 }).toBuffer();
  const id = "0100000000070000";
  extractor.setProvider(stubProvider({ name: "Big", iconBuffer: big, iconsByLang: { ko: big } }, []));

  extractor.enqueue({ absPath: "/games/big.nsp", baseTitleId: id, wantMeta: true });
  await extractor.whenDrained();

  const kept = await fs.readFile(cachePathFor(id, "icon"));
  const meta = await sharp(kept).metadata();
  assert.deepEqual([meta.width, meta.height], [256, 256]);
  assert.ok(kept.length < big.length / 4, "far fewer bytes than the file stores");
  assert.deepEqual(extractedMeta.get(id).iconLangs, [], "the same picture under ko is not saved twice");
});

test("a file that gives no icon leaves the next one to try; the first record still gives the name", async () => {
  const id = "0100000000080000";
  const calls = [];
  extractor.setProvider({
    name: "stub-test",
    async extract(job) {
      calls.push(job.absPath);
      if (job.absPath.endsWith("broken.nsp")) throw new Error("bad NCA");
      if (job.absPath.endsWith("game.nsz")) return { name: "From Base" };
      return { name: "From Update", iconBuffer: ICON.update };
    },
  });

  extractor.enqueue({ absPath: "/games/broken.nsp", baseTitleId: id, wantMeta: true,
    fallbacks: [{ absPath: "/games/game.nsz" }, { absPath: "/games/upd.nsp" }, { absPath: "/games/never.nsp" }] });
  await extractor.whenDrained();

  assert.deepEqual(calls, ["/games/broken.nsp", "/games/game.nsz", "/games/upd.nsp"], "stops at the first icon");
  assert.equal(await colourOf(cachePathFor(id, "icon")), "update");

  const nameOnly = "0100000000090000";
  extractor.setProvider(stubProvider({ name: "Only Name" }, []));
  extractor.enqueue({ absPath: "/games/a.nsp", baseTitleId: nameOnly, wantMeta: true, fallbacks: [{ absPath: "/games/b.nsp" }] });
  await extractor.whenDrained();
  assert.equal(extractedMeta.get(nameOnly).name, "Only Name");
});
