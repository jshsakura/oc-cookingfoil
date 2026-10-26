import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// i18n/client is the console client's string table. The client build reads it
// at a pinned server tag, and the client's strings-check tool does the full
// check (fonts, locked keys). These tests keep the shape the generator expects.
const DIR = path.join(import.meta.dirname, "../../i18n/client");
const read = (name) => JSON.parse(readFileSync(path.join(DIR, name), "utf8"));
const placeholders = (text) => [...new Set(text.match(/\{\d+\}/g) ?? [])].sort();
const english = (key) => key.replace(/\|[^|]*$/, "");

const languages = read("languages.json");
const files = readdirSync(DIR).filter((f) => f.endsWith(".json") && !["languages.json", "locked.json"].includes(f));

test("every listed language except English has a table, and every table is listed", () => {
  const codes = languages.map((l) => l.code);
  assert.equal(new Set(codes).size, codes.length);
  assert.ok(codes.includes("en"));
  assert.deepEqual(
    files.map((f) => f.replace(/\.json$/, "")).sort(),
    codes.filter((c) => c !== "en").sort(),
  );
});

test("each language names itself and falls back only to a listed language", () => {
  const codes = new Set(languages.map((l) => l.code));
  for (const { code, name, base } of languages) {
    assert.ok(typeof name === "string" && name.trim(), code);
    if (base !== null) assert.ok(codes.has(base) && base !== code, code);
    // The client follows a base one step only, then goes to English.
    if (base !== null) assert.equal(languages.find((l) => l.code === base).base, null, `${code}'s base has a base`);
  }
});

test("locked keys are a list of the client's keys, the ones a server never sets", () => {
  const locked = read("locked.json");
  assert.ok(Array.isArray(locked) && locked.length > 0);
  assert.ok(locked.every((k) => typeof k === "string" && k.trim()));
});

test("tables are flat maps of non-empty text that keep the English placeholders", () => {
  for (const file of files) {
    const table = read(file);
    assert.ok(table && typeof table === "object" && !Array.isArray(table), file);
    for (const [key, text] of Object.entries(table)) {
      assert.equal(typeof text, "string", `${file} ${key}`);
      assert.ok(text.trim(), `${file} ${key} is empty`);
      assert.deepEqual(placeholders(text), placeholders(english(key)), `${file} ${key}`);
    }
  }
});
