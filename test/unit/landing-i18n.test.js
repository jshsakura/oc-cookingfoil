import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// The landing page carries one string bundle per language the server labels
// genres and reviews in. A key missing from one bundle silently falls back to
// English for that language, so every bundle must carry the same keys.
const html = readFileSync(path.join(import.meta.dirname, "../../src/views/landing.html"), "utf-8");
const LANGS = ["ko", "en", "ja", "zh"];

function bundleKeys(lang) {
  const start = html.indexOf(`        ${lang}: {`);
  assert.ok(start > 0, `no ${lang} bundle`);
  const end = html.indexOf("\n        },\n", start);
  return new Set([...html.slice(start, end).matchAll(/^ {10}"([^"]+)":/gm)].map((m) => m[1]));
}

test("every language bundle has exactly the English keys", () => {
  const en = bundleKeys("en");
  assert.ok(en.size > 100);
  for (const lang of LANGS) {
    const keys = bundleKeys(lang);
    assert.deepEqual([...en].filter((k) => !keys.has(k)), [], `${lang} is missing keys`);
    assert.deepEqual([...keys].filter((k) => !en.has(k)), [], `${lang} has keys English lacks`);
  }
});

test("every key the page asks for exists in English", () => {
  const en = bundleKeys("en");
  const used = new Set([
    ...[...html.matchAll(/\bt\("([a-z_]+\.[a-z_.]+)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/data-i18n(?:-html)?="([^"]+)"/g)].map((m) => m[1]),
  ]);
  const dynamic = /^(chip|genre|hero|row)\./; // built from a kind, slide or row key
  assert.deepEqual([...used].filter((k) => !en.has(k) && !dynamic.test(k)), []);
});

test("the language toggle offers each language", () => {
  for (const lang of LANGS) assert.match(html, new RegExp(`data-lang="${lang}"`));
});
