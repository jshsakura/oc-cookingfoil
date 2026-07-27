import { test } from "node:test";
import assert from "node:assert/strict";
import {
  shouldAutoExtract,
  wantsExtractByMode,
  isOverSizeCap,
  BYTES_PER_GB,
} from "../../src/meta/extract-policy.js";

// Auto-extraction policy: mode gate (COOK_EXTRACT_ICONS) × size cap
// (COOK_EXTRACT_MAX_GB). A giant uncovered container is skipped rather than
// allowed to grind the background worker into the per-job timeout.

const CAP_4GB = 4 * BYTES_PER_GB;
const SMALL = 500 * 1024 ** 2; // 0.5 GB
const HUGE = 6 * BYTES_PER_GB; // 6 GB
const DB = { name: "Retail Title" }; // titledb-covered
const NO_DB = null; // uncovered (homebrew/fan)

// ── wantsExtractByMode: mode × fromDb matrix ──────────────────────────────

test("mode off never extracts (covered or not)", () => {
  assert.equal(wantsExtractByMode({ extractMode: "off", fromDb: DB }), false);
  assert.equal(wantsExtractByMode({ extractMode: "off", fromDb: NO_DB }), false);
});

test("mode all extracts regardless of titledb coverage", () => {
  assert.equal(wantsExtractByMode({ extractMode: "all", fromDb: DB }), true);
  assert.equal(wantsExtractByMode({ extractMode: "all", fromDb: NO_DB }), true);
});

test("mode missing extracts ONLY uncovered titles", () => {
  assert.equal(wantsExtractByMode({ extractMode: "missing", fromDb: DB }), false);
  assert.equal(wantsExtractByMode({ extractMode: "missing", fromDb: NO_DB }), true);
});

test("unknown mode is treated as off", () => {
  assert.equal(wantsExtractByMode({ extractMode: "bogus", fromDb: NO_DB }), false);
});

// ── isOverSizeCap ─────────────────────────────────────────────────────────

test("over-cap file is over cap", () => {
  assert.equal(isOverSizeCap({ sizeBytes: HUGE, maxBytes: CAP_4GB }), true);
});

test("under-cap file is not over cap", () => {
  assert.equal(isOverSizeCap({ sizeBytes: SMALL, maxBytes: CAP_4GB }), false);
});

test("exactly at cap is allowed (not over)", () => {
  assert.equal(isOverSizeCap({ sizeBytes: CAP_4GB, maxBytes: CAP_4GB }), false);
});

test("cap disabled (0) is never over cap", () => {
  assert.equal(isOverSizeCap({ sizeBytes: HUGE, maxBytes: 0 }), false);
});

test("cap disabled (negative) is never over cap", () => {
  assert.equal(isOverSizeCap({ sizeBytes: HUGE, maxBytes: -1 }), false);
});

test("non-finite size is treated as under cap (never silently dropped)", () => {
  assert.equal(isOverSizeCap({ sizeBytes: NaN, maxBytes: CAP_4GB }), false);
  assert.equal(isOverSizeCap({ sizeBytes: undefined, maxBytes: CAP_4GB }), false);
});

// ── shouldAutoExtract: combined verdict ───────────────────────────────────

test("under-cap uncovered title in missing mode → extract", () => {
  assert.equal(
    shouldAutoExtract({ sizeBytes: SMALL, extractMode: "missing", fromDb: NO_DB, maxBytes: CAP_4GB }),
    true
  );
});

test("over-cap uncovered title in missing mode → skip (the core case)", () => {
  assert.equal(
    shouldAutoExtract({ sizeBytes: HUGE, extractMode: "missing", fromDb: NO_DB, maxBytes: CAP_4GB }),
    false
  );
});

test("retail title in missing mode → skip regardless of size (titledb+CDN)", () => {
  assert.equal(
    shouldAutoExtract({ sizeBytes: SMALL, extractMode: "missing", fromDb: DB, maxBytes: CAP_4GB }),
    false
  );
});

test("over-cap title in all mode → skip (cap wins over mode)", () => {
  assert.equal(
    shouldAutoExtract({ sizeBytes: HUGE, extractMode: "all", fromDb: DB, maxBytes: CAP_4GB }),
    false
  );
});

test("over-cap uncovered title with cap disabled (0) → extract (unlimited)", () => {
  assert.equal(
    shouldAutoExtract({ sizeBytes: HUGE, extractMode: "missing", fromDb: NO_DB, maxBytes: 0 }),
    true
  );
});

test("mode off → skip even for a tiny uncovered file", () => {
  assert.equal(
    shouldAutoExtract({ sizeBytes: SMALL, extractMode: "off", fromDb: NO_DB, maxBytes: CAP_4GB }),
    false
  );
});
