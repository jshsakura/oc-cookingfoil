import { test } from "node:test";
import assert from "node:assert/strict";
import { missingRegions } from "../../src/meta/titledb-bootstrap.js";

// A partial titledb cache (e.g. only KR.ko landed on first boot) must still be
// recognized as INCOMPLETE so the missing regions — notably US.en, the source
// of English aliases for the "한글 (English)" search decoration — get
// back-filled instead of being masked by "store is non-empty".

const CONFIGURED = ["KR.ko", "US.en", "JP.ja", "EU.en", "HK.zh"];

test("missingRegions: flags every configured region absent from disk", () => {
  const present = ["KR.ko.json", "KR.ko.slim.json"]; // only Korean landed
  assert.deepEqual(missingRegions(CONFIGURED, present), [
    "US.en",
    "JP.ja",
    "EU.en",
    "HK.zh",
  ]);
});

test("missingRegions: a slim-only region counts as present", () => {
  const present = ["KR.ko.slim.json", "US.en.slim.json"];
  assert.deepEqual(missingRegions(["KR.ko", "US.en"], present), []);
});

test("missingRegions: raw or slim satisfies presence", () => {
  const present = new Set(["US.en.json", "JP.ja.slim.json"]);
  assert.deepEqual(missingRegions(["US.en", "JP.ja"], present), []);
});

test("missingRegions: empty disk → everything missing", () => {
  assert.deepEqual(missingRegions(CONFIGURED, []), CONFIGURED);
});

test("missingRegions: full cache → nothing missing", () => {
  const present = CONFIGURED.map((r) => `${r}.json`);
  assert.deepEqual(missingRegions(CONFIGURED, present), []);
});

test("missingRegions: a .404 tombstone marks a region as not-missing (no re-fetch every boot)", () => {
  // EU.en is often absent upstream; its 404 tombstone should stop the boot
  // back-fill from re-requesting it on every restart.
  const present = ["KR.ko.slim.json", "US.en.slim.json", "EU.en.404"];
  assert.deepEqual(missingRegions(["KR.ko", "US.en", "EU.en", "JP.ja"], present), [
    "JP.ja",
  ]);
});
