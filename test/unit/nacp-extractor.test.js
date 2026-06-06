import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

// Point all on-disk caches at a throwaway dir BEFORE importing the modules
// that read COOK_DATA_DIR at load time.
const DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "cook-extract-test-"));
process.env.COOK_DATA_DIR = DATA_DIR;

const { cachePathFor } = await import("../../src/meta/image-cache.js");
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
