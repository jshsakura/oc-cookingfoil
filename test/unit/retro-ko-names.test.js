import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import { koreanName, koreanNameByTitle, koreanNameCounts, koreanNameFolders, normalizeTitle, splitName } from "../../src/retro/ko-names.js";

const data = JSON.parse(fs.readFileSync(new URL("../../src/retro/data/ko-names.json", import.meta.url), "utf8"));
const firstOf = (system) => Object.entries(data.systems[system])[0];
const withField = (system, i) => Object.entries(data.systems[system]).find(([, r]) => r[i]);

test("the bundled dictionary has Korean titles for several systems", () => {
  const counts = koreanNameCounts();
  assert.ok(Object.keys(counts).length >= 10);
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), data.count);
});

test("every row is a Korean title with an optional English title, CRC-32 and SHA-1", () => {
  for (const rows of Object.values(data.systems)) {
    for (const [key, [ko, en, crc, sha1]] of Object.entries(rows)) {
      assert.match(key, /^[0-9a-f]{32}$/);
      assert.match(ko, /[가-힣]/);
      assert.ok(en === null || typeof en === "string");
      assert.match(crc, /^([0-9a-f]{8})?$/);
      assert.match(sha1, /^([0-9a-f]{32})?$/);
    }
  }
});

test("a ROM is found by SHA-256, SHA-1 or CRC-32, and only in its own system", () => {
  const [key, [ko, en]] = firstOf("nes");
  assert.deepEqual(koreanName("nes", { sha256: `${key}${"0".repeat(32)}` }), { ko, en, by: "sha256" });
  assert.equal(koreanName("snes", { sha256: key }), null);
  assert.equal(koreanName("nes", { sha256: "f".repeat(64) }), null);
  const [, bySha1] = withField("gb", 3);
  assert.deepEqual(koreanName("gb", { sha1: `${bySha1[3]}${"0".repeat(8)}` }), { ko: bySha1[0], en: bySha1[1], by: "sha1" });
  const [, byCrc] = withField("a2600", 2);
  assert.equal(koreanName("a2600", { crc32: byCrc[2].toUpperCase() })?.by, "crc32");
  assert.equal(koreanName("no-such-system", { sha256: key }), null);
});

test("a title match is marked as an estimate and ignores tags, case and punctuation", () => {
  assert.equal(normalizeTitle("Metal Slug Advance (Japan) [!]"), "metal slug advance");
  assert.equal(normalizeTitle("Rock & Roll: Racing"), "rock and roll racing");
  const [, [ko, en]] = Object.entries(data.systems.gba).find(([, r]) => r[1]);
  const hit = koreanNameByTitle("gba", `${en.toUpperCase()} (USA)`);
  assert.equal(hit?.by, "title");
  assert.equal(hit?.ko, ko);
  assert.equal(koreanNameByTitle("gba", "No Such Game Anywhere"), null);
});

test("systems without a built-in id say which libretro folder they are", () => {
  const folders = koreanNameFolders();
  for (const id of Object.keys(data.systems)) {
    if (!["nes", "snes", "gb", "gbc", "gba", "md", "sms", "gg", "pce", "pcecd", "segacd", "ngp", "ws"].includes(id)) assert.ok(folders[id], `${id} needs a folder`);
  }
});

test("a name splits into the Korean and the English title", () => {
  assert.deepEqual(splitName("어드벤처 (Adventure)"), ["어드벤처", "Adventure"]);
  assert.deepEqual(splitName("판타지 스타 (삼성전자)"), ["판타지 스타 (삼성전자)", null]);
  assert.deepEqual(splitName("젠지"), ["젠지", null]);
});
