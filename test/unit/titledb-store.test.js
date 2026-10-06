import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, chmod } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// In-memory titledb store: merges per-region files into one map keyed by
// uppercase title id, applying per-field fallback in COOK_LANG_PRIORITY
// order (default ko,en,ja,en-US — see titledb-store.js header / FINDINGS §5).
//
// titledbCacheDir is a module-level constant resolved from COOK_DATA_DIR at
// import time, so it must be pinned BEFORE the module is loaded. This file
// therefore sets COOK_DATA_DIR and dynamic-imports the store, then mutates
// the *contents* of that one fixed directory between test cases (load()
// fully rescans + resets its state on every call).

const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "titledb-store-test-"));
process.env.COOK_DATA_DIR = tmpRoot;
const titledbDir = path.join(tmpRoot, "titledb");

const store = await import("../../src/meta/titledb-store.js");

// load() opportunistically emits a `.slim.json` sibling for every RAW file
// it parses via a fire-and-forget `setImmediate(...).then(writeSlimFromJson)`
// — NOT awaited by load() itself (see titledb-store.js around line 132). If
// the next test wipes+repopulates titledbDir before that write lands, the
// stray slim file (re)appears in the middle of the next test's fixture set.
// Draining the microtask/immediate/timer queues before every wipe keeps the
// shared fixture directory actually clean between tests.
async function settleBackgroundIO() {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setTimeout(r, 20));
}

async function resetDir() {
  await settleBackgroundIO();
  await rm(titledbDir, { recursive: true, force: true }).catch(() => {});
}

async function writeRegion(file, json) {
  await mkdir(titledbDir, { recursive: true });
  await writeFile(path.join(titledbDir, file), JSON.stringify(json));
}

// ── isLoaded ─────────────────────────────────────────────────────────────
// MUST run first: it asserts the pre-load state, and every other test in
// this file calls load() at least once.

test("isLoaded: false before the first load(), true after", async () => {
  assert.equal(store.isLoaded(), false);
  await resetDir();
  await store.load();
  assert.equal(store.isLoaded(), true);
});

// ── load(): directory-level edge cases ──────────────────────────────────

test("load: missing titledb directory (ENOENT) → empty store, no throw", async () => {
  await resetDir(); // directory does not exist at all
  const result = await store.load();
  assert.equal(result.titles, 0);
  assert.deepEqual(result.regions, []);
  assert.ok(result.loadedAt instanceof Date);
});

test("load: permission-denied directory (non-ENOENT readdir error) is swallowed → empty store", async () => {
  await resetDir();
  await mkdir(titledbDir);
  await chmod(titledbDir, 0o000);
  try {
    const result = await store.load();
    assert.equal(result.titles, 0);
    assert.deepEqual(result.regions, []);
    assert.ok(result.loadedAt instanceof Date);
  } finally {
    await chmod(titledbDir, 0o755); // restore so later tests/cleanup can touch it
  }
});

// ── load(): per-field language fallback (core merge behavior) ───────────

test("load: higher-priority region (ko) wins per field, lower-priority region (en) backfills only what's missing", async () => {
  await resetDir();
  await writeRegion("KR.ko.json", {
    "70010000000000": {
      id: "0100000000010000",
      name: "한글게임",
      publisher: "배포사",
      description: "", // empty → must NOT block the en backfill
      region: "KR",
    },
  });
  await writeRegion("US.en.json", {
    "70010000000001": {
      id: "0100000000010000",
      name: "English Game",
      publisher: "EN Publisher",
      description: "English description",
      region: "US",
      releaseDate: 20200101,
    },
  });

  await store.load();
  const rec = store.get("0100000000010000");

  assert.equal(rec.name, "한글게임"); // ko processed first (priIndex 0 < 1), wins
  assert.equal(rec.publisher, "배포사");
  assert.equal(rec.description, "English description"); // backfilled: ko's was empty
  assert.equal(rec.region, "KR"); // first non-empty value wins
  assert.equal(rec.releaseDate, 20200101); // only en had it at all
});

test("load: collects a distinct alias per region name, deduping exact repeats", async () => {
  await resetDir();
  await writeRegion("KR.ko.json", {
    a: { id: "0100000000010000", name: "한글게임" },
  });
  await writeRegion("US.en.json", {
    b: { id: "0100000000010000", name: "English Game" },
  });
  await writeRegion("JP.ja.json", {
    c: { id: "0100000000010000", name: "한글게임" }, // exact dup of the ko alias
  });

  await store.load();
  const rec = store.get("0100000000010000");
  assert.deepEqual(rec.aliases, ["한글게임", "English Game"]);
});

test("load: a region whose language isn't in COOK_LANG_PRIORITY sorts after every configured language", async () => {
  await resetDir();
  await writeRegion("TW.zho.json", {
    a: { id: "0100000000030000", name: "Unconfigured Lang" },
  });
  await writeRegion("KR.ko.json", {
    b: { id: "0100000000030000", name: "한글" },
  });
  await writeRegion("US.en.json", {
    c: { id: "0100000000030000", name: "English" },
  });

  await store.load();
  const order = store.status().regions.map((r) => r.region);
  assert.deepEqual(order, ["KR.ko", "US.en", "TW.zho"]);
});

test("load: regions with the same language priority tie-break alphabetically by region code", async () => {
  await resetDir();
  await writeRegion("US.en.json", { a: { id: "0100000000040000", name: "US" } });
  await writeRegion("GB.en.json", { b: { id: "0100000000040001", name: "GB" } });

  await store.load();
  const order = store.status().regions.map((r) => r.region);
  assert.deepEqual(order, ["GB.en", "US.en"]);
});

// ── load(): slim-sibling preference ──────────────────────────────────────

test("load: a `.slim.json` sibling is preferred over the raw `.json` for the same region", async () => {
  await resetDir();
  await writeRegion("JP.ja.json", {
    a: { id: "0100000000050000", name: "Raw Name (stale)" },
  });
  await writeRegion("JP.ja.slim.json", {
    _schemaVersion: 3,
    "0100000000050000": { id: "0100000000050000", name: "Slim Name (fresh)" },
  });

  const status = await store.load();
  assert.equal(status.regions.length, 1); // only one file chosen for the region
  assert.equal(status.regions[0].format, "slim");
  assert.equal(store.get("0100000000050000").name, "Slim Name (fresh)");
});

test("load: old slim cache recovers languages from raw without inferring them from the region", async () => {
  await resetDir();
  await writeRegion("KR.ko.json", {
    a: { id: "0100000000050000", name: "Raw", languages: [" EN ", "ko", "ko", null, ""] },
  });
  await writeRegion("KR.ko.slim.json", {
    "0100000000050000": { id: "0100000000050000", name: "Old Slim" },
  });
  const result = await store.load();
  assert.equal(result.regions[0].format, "raw");
  assert.deepEqual(store.get("0100000000050000").languages, ["en", "ko"]);
  await settleBackgroundIO();
  const fresh = await store.load();
  assert.equal(fresh.regions[0].format, "slim");
  assert.deepEqual(store.get("0100000000050000").languages, ["en", "ko"]);
});

test("load: language lists use priority fallback, never merge sibling releases or localized names", async () => {
  await resetDir();
  await writeRegion("KR.ko.json", {
    a: { id: "0100000000050000", name: "한국어 이름", languages: [] },
    b: { id: "0100000000060000", name: "한국어 이름", languages: ["ja"] },
    c: { id: "0100000000070000", name: "한국어 이름" },
    d: { id: "0100000000080000", languages: "ko" },
  });
  await writeRegion("US.en.json", {
    a: { id: "0100000000050000", languages: ["ko", "en"] },
    b: { id: "0100000000060000", languages: ["ko", "en"] },
    d: { id: "0100000000080000", languages: ["en"] },
  });
  await store.load();
  assert.deepEqual(store.get("0100000000050000").languages, ["ko", "en"]);
  assert.deepEqual(store.get("0100000000060000").languages, ["ja"]);
  assert.equal(store.get("0100000000070000").languages, undefined);
  assert.deepEqual(store.get("0100000000080000").languages, ["en"]);
});

test("load: a slim-only region (no raw sibling at all) loads fine", async () => {
  await resetDir();
  await writeRegion("HK.zh.slim.json", {
    "0100000000060000": { id: "0100000000060000", name: "Slim Only" },
  });

  const status = await store.load();
  assert.equal(status.regions[0].file, "HK.zh.slim.json");
  assert.equal(status.regions[0].format, "slim");
  assert.equal(store.get("0100000000060000").name, "Slim Only");
});

// ── load(): malformed / invalid input resilience ─────────────────────────

test("load: a region file with malformed JSON is skipped; other regions still merge", async () => {
  await resetDir();
  await writeRegion("US.en.json", {
    a: { id: "0100000000070000", name: "Good Region" },
  });
  await mkdir(titledbDir, { recursive: true });
  await writeFile(path.join(titledbDir, "BR.pt.json"), "{ not valid json,");

  const status = await store.load();
  assert.equal(status.titles, 1);
  assert.deepEqual(
    status.regions.map((r) => r.region),
    ["US.en"]
  );
});

test("load: entries with non-hex/short/non-string ids and non-object entries are skipped, valid ones still counted", async () => {
  await resetDir();
  await writeRegion("US.en.json", {
    good: { id: "0100000000080000", name: "Valid" },
    badPattern: { id: "not-a-hex-id", name: "BadPattern" },
    tooShort: { id: "0100000000", name: "TooShort" },
    numericId: { id: 12345, name: "NumericId" },
    nullEntry: null,
    stringEntry: "just a string",
    noNameField: { id: "0100000000080001" },
  });

  const status = await store.load();
  assert.equal(store.size(), 2);
  assert.equal(status.regions[0].count, 2);
  assert.equal(store.get("0100000000080000").name, "Valid");
  const noName = store.get("0100000000080001");
  assert.equal(noName.name, undefined);
  assert.deepEqual(noName.aliases, []);
});

// ── get() / size() / status() ────────────────────────────────────────────

test("get: null for a non-string id, null for an unknown id, case-insensitive lookup for a known id", async () => {
  await resetDir();
  await writeRegion("US.en.json", {
    a: { id: "0100000000090000", name: "Case Test" },
  });
  await store.load();

  assert.equal(store.get(12345), null);
  assert.equal(store.get(undefined), null);
  assert.equal(store.get("FFFFFFFFFFFFFFFF"), null);
  assert.equal(store.get("0100000000090000").name, "Case Test");
  assert.equal(store.get("0100000000090000".toLowerCase()).name, "Case Test");
});

test("size/status: reflect the merged title count and region summary after load()", async () => {
  await resetDir();
  await writeRegion("US.en.json", {
    a: { id: "01000000000A0000", name: "One" },
    b: { id: "01000000000A0001", name: "Two" },
  });
  await store.load();

  assert.equal(store.size(), 2);
  const s = store.status();
  assert.equal(s.titles, 2);
  assert.equal(s.regions.length, 1);
  assert.equal(s.regions[0].region, "US.en");
  assert.equal(s.regions[0].count, 2);
  assert.ok(s.loadedAt instanceof Date);
});

// ── preferredSibling: cross-region name recovery via eShop artwork ─────────
// A game released only outside Korea has no KR.ko entry for ITS title id, so
// the merged record keeps the English name even though the Korean name sits
// in the same titledb under the Korean release's (different) id. Nothing in
// titledb links those two ids — the shared eShop artwork hash does.

const ART = "https://img-eshop.cdn.nintendo.net/i/deadcells-icon.jpg";

test("preferredSibling: finds the preferred-language release that shares artwork", async () => {
  await resetDir();
  await writeRegion("KR.ko.json", {
    "70010000000010": { id: "0100E0E00E64C000", name: "데드 셀", iconUrl: ART },
  });
  await writeRegion("US.en.json", {
    "70010000000011": { id: "0100646009FBE000", name: "Dead Cells", iconUrl: ART },
  });

  await store.load();

  assert.equal(store.get("0100646009FBE000").name, "Dead Cells");
  assert.equal(store.preferredSibling("0100646009FBE000").name, "데드 셀");
});

test("preferredSibling: null when the record already carries a preferred-language name", async () => {
  await resetDir();
  await writeRegion("KR.ko.json", {
    "70010000000012": { id: "0100000000020000", name: "슈퍼로봇대전 30", iconUrl: ART },
  });

  await store.load();

  // Already Korean — no sibling lookup should fire.
  assert.equal(store.preferredSibling("0100000000020000"), null);
});

test("preferredSibling: ignores DLC/update siblings so a title can't borrow its add-on's name", async () => {
  await resetDir();
  await writeRegion("KR.ko.json", {
    // low 13 bits set (base + 0x1003) → DLC id, never a valid name source
    "70010000000013": { id: "01000A10041EB003", name: "스카이림 스페인어 언어 팩", iconUrl: ART },
  });
  await writeRegion("US.en.json", {
    "70010000000014": { id: "01000A10041EA000", name: "The Elder Scrolls V: Skyrim", iconUrl: ART },
  });

  await store.load();

  assert.equal(store.preferredSibling("01000A10041EA000"), null);
});

test("preferredSibling: null when two different titles claim the same artwork", async () => {
  await resetDir();
  await writeRegion("KR.ko.json", {
    "70010000000015": { id: "0100000000030000", name: "한글 게임 하나", iconUrl: ART },
    "70010000000016": { id: "0100000000040000", name: "한글 게임 둘", iconUrl: ART },
  });
  await writeRegion("US.en.json", {
    "70010000000017": { id: "0100000000050000", name: "Ambiguous Game", iconUrl: ART },
  });

  await store.load();

  // Ambiguous → refuse rather than guess; a wrong localized name is worse
  // than a correct foreign one.
  assert.equal(store.preferredSibling("0100000000050000"), null);
});

test("preferredSibling: matches on bannerUrl too, not just iconUrl", async () => {
  await resetDir();
  const banner = "https://img-eshop.cdn.nintendo.net/i/furi-banner.jpg";
  await writeRegion("KR.ko.json", {
    "70010000000018": { id: "0100000000060000", name: "퓨리", bannerUrl: banner },
  });
  await writeRegion("US.en.json", {
    "70010000000019": { id: "0100000000070000", name: "Furi", bannerUrl: banner },
  });

  await store.load();

  assert.equal(store.preferredSibling("0100000000070000").name, "퓨리");
});
