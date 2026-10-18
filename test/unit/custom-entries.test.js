import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadCustomEntries } from "../../src/meta/custom-entries.js";

// Writes `contents` to a fresh temp file and returns its path. Each test gets
// its own tempdir so files never collide across the (parallel-capable) suite.
function writeTempEntries(contents) {
  const dir = mkdtempSync(path.join(tmpdir(), "cook-custom-entries-"));
  const file = path.join(dir, "custom_entries.jsonc");
  writeFileSync(file, contents, "utf-8");
  return file;
}

test("loadCustomEntries: returns empty array when no filePath is given", async () => {
  assert.deepEqual(await loadCustomEntries(null), []);
  assert.deepEqual(await loadCustomEntries(undefined), []);
  assert.deepEqual(await loadCustomEntries(""), []);
});

test("loadCustomEntries: returns empty array when file does not exist (ENOENT)", async () => {
  const missingPath = path.join(tmpdir(), "cook-custom-entries-does-not-exist", "custom_entries.jsonc");

  assert.deepEqual(await loadCustomEntries(missingPath), []);
});

test("loadCustomEntries: parses valid JSON5 array with url + name entries", async () => {
  const file = writeTempEntries(
    JSON.stringify([
      { url: "https://example.com/game.nsp", name: "Fan Game" },
      { url: "https://example.com/other.nsp", name: "Other Homebrew", titleId: "0100000000000ABC" },
    ])
  );

  const entries = await loadCustomEntries(file);

  assert.equal(entries.length, 2);
  assert.equal(entries[0].name, "Fan Game");
  assert.equal(entries[0].url, "https://example.com/game.nsp");
  assert.equal(entries[1].titleId, "0100000000000ABC");
});

test("loadCustomEntries: supports JSONC-style comments and trailing commas (JSON5 features)", async () => {
  const file = writeTempEntries(`[
    // a fan-made homebrew title
    {
      url: "https://example.com/homebrew.nro", // no quotes needed on keys
      name: "Homebrew Tool",
    },
    /* block comment entry */
    { url: "https://example.com/rom.nsz", name: "Synthetic Title" },
  ]`);

  const entries = await loadCustomEntries(file);

  assert.equal(entries.length, 2);
  assert.equal(entries[0].name, "Homebrew Tool");
  assert.equal(entries[1].name, "Synthetic Title");
});

test("loadCustomEntries: skips entries missing url, keeping valid ones", async () => {
  const file = writeTempEntries(
    JSON.stringify([
      { name: "No URL Here" },
      { url: "https://example.com/valid.nsp", name: "Valid Entry" },
    ])
  );

  const entries = await loadCustomEntries(file);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, "Valid Entry");
});

test("loadCustomEntries: skips entries missing name, keeping valid ones", async () => {
  const file = writeTempEntries(
    JSON.stringify([
      { url: "https://example.com/noname.nsp" },
      { url: "https://example.com/valid.nsp", name: "Valid Entry" },
    ])
  );

  const entries = await loadCustomEntries(file);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, "Valid Entry");
});

test("loadCustomEntries: skips non-object entries (string, number, null, array) in the list", async () => {
  const file = writeTempEntries(
    JSON.stringify([
      "just a string",
      42,
      null,
      ["nested", "array"],
      { url: "https://example.com/valid.nsp", name: "Valid Entry" },
    ])
  );

  const entries = await loadCustomEntries(file);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, "Valid Entry");
});

test("loadCustomEntries: rejects blank-string url and name (empty string fails the length check)", async () => {
  const file = writeTempEntries(
    JSON.stringify([
      { url: "", name: "Empty URL" },
      { url: "https://example.com/x.nsp", name: "" },
      { url: "https://example.com/valid.nsp", name: "Valid Entry" },
    ])
  );

  const entries = await loadCustomEntries(file);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, "Valid Entry");
});

test("loadCustomEntries: rejects non-string url/name types (number, object)", async () => {
  const file = writeTempEntries(
    JSON.stringify([
      { url: 12345, name: "Numeric URL" },
      { url: "https://example.com/x.nsp", name: { nested: "object" } },
      { url: "https://example.com/valid.nsp", name: "Valid Entry" },
    ])
  );

  const entries = await loadCustomEntries(file);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, "Valid Entry");
});

test("loadCustomEntries: returns empty array when top-level value is an object, not an array", async () => {
  const file = writeTempEntries(JSON.stringify({ url: "https://example.com/x.nsp", name: "Not An Array" }));

  assert.deepEqual(await loadCustomEntries(file), []);
});

test("loadCustomEntries: returns empty array when top-level value is a scalar", async () => {
  const file = writeTempEntries(JSON.stringify("just a string"));

  assert.deepEqual(await loadCustomEntries(file), []);
});

test("loadCustomEntries: returns empty array (never throws) on empty file content", async () => {
  const file = writeTempEntries("");

  assert.deepEqual(await loadCustomEntries(file), []);
});

test("loadCustomEntries: returns empty array (never throws) on malformed/unparseable JSON5 syntax", async () => {
  const file = writeTempEntries("{ this is not valid json5 syntax : : :");

  assert.deepEqual(await loadCustomEntries(file), []);
});

test("loadCustomEntries: preserves synthetic-titleID entries and extra fields verbatim", async () => {
  const file = writeTempEntries(
    JSON.stringify([
      {
        url: "https://example.com/synthetic.nsp",
        name: "Synthetic Title",
        titleId: "FFFFFF0000000ABC",
        iconUrl: "https://example.com/icon.png",
      },
    ])
  );

  const entries = await loadCustomEntries(file);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].titleId, "FFFFFF0000000ABC");
  assert.equal(entries[0].iconUrl, "https://example.com/icon.png");
});

test("loadCustomEntries: empty array input yields empty result", async () => {
  const file = writeTempEntries("[]");

  assert.deepEqual(await loadCustomEntries(file), []);
});
