import { test, after } from "node:test";
import assert from "node:assert/strict";
import { koreanName, koreanNameByTitle, koreanNameSources, koreanNameSystem, normalizeTitle, setNameSources, useKoreanNames } from "../../src/retro/ko-names.js";

const SHA256 = "a".repeat(32);
const SHA1 = "b".repeat(32);
useKoreanNames({
  systems: {
    nes: { [SHA256]: ["가상 모험", "Example Adventure", "0a1b2c3d", SHA1] },
    gba: { ["c".repeat(32)]: ["가상 퀘스트", "Example Quest", "", ""] },
  },
  titles: { md: { "example racer": "가상 레이서" } },
});
after(() => useKoreanNames(null));

test("with no names plugin on, the server names nothing", () => {
  useKoreanNames(null);
  setNameSources(() => []);
  assert.equal(koreanNameSources(), 0);
  assert.equal(koreanName("nes", { sha256: `${SHA256}${"0".repeat(32)}` }), null);
  assert.equal(koreanNameSystem("nes"), false);
  useKoreanNames({ systems: { nes: { [SHA256]: ["가상 모험", "Example Adventure", "0a1b2c3d", SHA1] } } });
});

test("a ROM is found by SHA-256, SHA-1 or CRC-32, and only in its own system", () => {
  useKoreanNames({ systems: { nes: { [SHA256]: ["가상 모험", "Example Adventure", "0a1b2c3d", SHA1] } } });
  assert.deepEqual(koreanName("nes", { sha256: `${SHA256}${"0".repeat(32)}` }), { ko: "가상 모험", en: "Example Adventure", by: "sha256" });
  assert.equal(koreanName("snes", { sha256: SHA256 }), null);
  assert.equal(koreanName("nes", { sha256: "f".repeat(64) }), null);
  assert.deepEqual(koreanName("nes", { sha1: `${SHA1}${"0".repeat(8)}` }), { ko: "가상 모험", en: "Example Adventure", by: "sha1" });
  assert.equal(koreanName("nes", { crc32: "0A1B2C3D" })?.by, "crc32");
});

test("a title match is marked as an estimate and ignores tags, case and punctuation", () => {
  useKoreanNames({ systems: { gba: { ["c".repeat(32)]: ["가상 퀘스트", "Example Quest", "", ""] } }, titles: { md: { "example racer": "가상 레이서" } } });
  assert.equal(normalizeTitle("Metal Slug Advance (Japan) [!]"), "metal slug advance");
  assert.equal(normalizeTitle("Rock & Roll: Racing"), "rock and roll racing");
  assert.deepEqual(koreanNameByTitle("gba", "EXAMPLE QUEST (USA)"), { ko: "가상 퀘스트", en: "Example Quest", by: "title" });
  assert.deepEqual(koreanNameByTitle("md", "Example Racer [!]"), { ko: "가상 레이서", en: null, by: "title" });
  assert.equal(koreanNameByTitle("gba", "No Such Game Anywhere"), null);
});
