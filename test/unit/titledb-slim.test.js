import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  SLIM_SUFFIX,
  SLIM_SCHEMA_VERSION,
  slimPathFor,
  writeSlimFromJson,
  writeSlimFromRawPath,
} from "../../src/meta/titledb-slim.js";

// Slim transform: raw blawar/titledb region dumps (~40 fields/entry) reduced
// to the handful of fields the store actually merges, keyed by uppercase
// title id instead of nsuId. See titledb-slim.js header for the full why.

async function tmpDir() {
  return mkdtemp(path.join(os.tmpdir(), "titledb-slim-test-"));
}

// ── slimPathFor / SLIM_SUFFIX ───────────────────────────────────────────────

test("SLIM_SUFFIX is the canonical '.slim.json' sibling suffix", () => {
  assert.equal(SLIM_SUFFIX, ".slim.json");
});

test("slimPathFor: replaces a trailing .json with .slim.json", () => {
  assert.equal(
    slimPathFor("/data/titledb/US.en.json"),
    "/data/titledb/US.en.slim.json"
  );
});

test("slimPathFor: only anchors on the trailing extension, not any mid-string '.json'", () => {
  // A directory segment that happens to contain ".json" must not be touched;
  // only the trailing extension is replaced (regex is anchored with $).
  assert.equal(
    slimPathFor("/data/my.json.dir/KR.ko.json"),
    "/data/my.json.dir/KR.ko.slim.json"
  );
});

// ── writeSlimFromJson: transform + atomic write ─────────────────────────────

test("writeSlimFromJson: keeps only SLIM_FIELDS, drops empty/null/undefined values, keys by uppercase id", async () => {
  const dir = await tmpDir();
  const slimPath = path.join(dir, "US.en.slim.json");
  const raw = {
    "70010000000001": {
      id: "0100000000010000", // lowercase on purpose — must be uppercased
      name: "English Game",
      publisher: "EN Publisher",
      description: "", // empty string must be dropped
      releaseDate: null, // null must be dropped
      region: "US",
      languages: ["ko", "en"],
      extraJunkField: "not in SLIM_FIELDS, must be dropped",
    },
  };

  const result = await writeSlimFromJson(raw, slimPath);
  assert.equal(result.count, 1);

  const written = JSON.parse(await readFile(slimPath, "utf-8"));
  assert.equal(written._schemaVersion, SLIM_SCHEMA_VERSION);
  const keys = Object.keys(written).filter((key) => key !== "_schemaVersion");
  assert.deepEqual(keys, ["0100000000010000"]);

  const entry = written["0100000000010000"];
  assert.equal(entry.id, "0100000000010000");
  assert.equal(entry.name, "English Game");
  assert.equal(entry.publisher, "EN Publisher");
  assert.equal("description" in entry, false);
  assert.equal("releaseDate" in entry, false);
  assert.equal("extraJunkField" in entry, false);
  assert.equal(entry.region, "US");
  assert.deepEqual(entry.languages, ["ko", "en"]);
});

test("writeSlimFromJson: skips entries with invalid/missing/non-string id and non-object entries", async () => {
  const dir = await tmpDir();
  const slimPath = path.join(dir, "US.en.slim.json");
  const raw = {
    good: { id: "0100000000010000", name: "Valid" },
    badPattern: { id: "not-a-hex-id", name: "BadPattern" },
    tooShort: { id: "0100000000", name: "TooShort" },
    numericId: { id: 12345, name: "NumericId" },
    nullEntry: null,
    stringEntry: "just a string",
  };

  const result = await writeSlimFromJson(raw, slimPath);
  assert.equal(result.count, 1);

  const written = JSON.parse(await readFile(slimPath, "utf-8"));
  assert.deepEqual(Object.keys(written).filter((key) => key !== "_schemaVersion"), ["0100000000010000"]);
});

test("writeSlimFromJson: throws when the raw payload is not an object (covers the transform guard)", async () => {
  const dir = await tmpDir();
  const slimPath = path.join(dir, "bad.slim.json");

  await assert.rejects(
    () => writeSlimFromJson(null, slimPath),
    /raw titledb is not an object/
  );
  await assert.rejects(
    () => writeSlimFromJson("a string", slimPath),
    /raw titledb is not an object/
  );
  await assert.rejects(
    () => writeSlimFromJson(42, slimPath),
    /raw titledb is not an object/
  );
});

// ── writeSlimFromRawPath: disk read + parse + atomic write ─────────────────

test("writeSlimFromRawPath: reads a raw region file from disk and emits its slim sibling atomically", async () => {
  const dir = await tmpDir();
  const rawPath = path.join(dir, "KR.ko.json");
  const slimPath = slimPathFor(rawPath);
  const raw = {
    "70020000000000": {
      id: "0100000000020000",
      name: "한글게임",
      publisher: "배포사",
      region: "KR",
    },
  };
  await writeFile(rawPath, JSON.stringify(raw));

  const result = await writeSlimFromRawPath(rawPath, slimPath);
  assert.equal(result.count, 1);

  const written = JSON.parse(await readFile(slimPath, "utf-8"));
  assert.equal(written["0100000000020000"].name, "한글게임");

  // Atomic write via tmp+rename must leave no leftover tmp file behind.
  await assert.rejects(() => stat(`${slimPath}.tmp.${process.pid}`));
});

test("writeSlimFromRawPath: rejects when the raw file contains malformed JSON", async () => {
  const dir = await tmpDir();
  const rawPath = path.join(dir, "BR.pt.json");
  const slimPath = slimPathFor(rawPath);
  await writeFile(rawPath, "{ not valid json,");

  await assert.rejects(() => writeSlimFromRawPath(rawPath, slimPath));
});
