import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "name-dictionary-"));
process.env.COOK_DATA_DIR = root;
const names = await import("../../src/retro/ko-names.js");
const file = path.join(root, "retro-ko-names.json");
after(() => fs.rmSync(root, { recursive: true, force: true }));
const hash = "a".repeat(32);
const dictionary = (ko) => ({ source: "synthetic", systems: { gba: { [hash]: [ko, "Moonlight Voyage", "", ""] } }, titles: { gba: { "moonlight voyage": ko } } });

test("a local OC Retro Database export reloads after edits, replacement and removal", () => {
  assert.equal(names.koreanNameByTitle("gba", "Moonlight Voyage"), null);
  fs.writeFileSync(file, JSON.stringify(dictionary("달빛 항해")));
  assert.equal(names.koreanNameByTitle("gba", "Moonlight Voyage").ko, "달빛 항해");
  assert.equal(names.koreanName("gba", { sha256: "a".repeat(64) }).ko, "달빛 항해");
  const upper = dictionary("달빛 항해");
  upper.systems.gba = { [hash.toUpperCase()]: upper.systems.gba[hash] };
  fs.writeFileSync(file, JSON.stringify(upper));
  assert.equal(names.koreanName("gba", { sha256: "a".repeat(64) }).ko, "달빛 항해");
  fs.writeFileSync(file, JSON.stringify(dictionary("별빛 항로")));
  assert.equal(names.koreanNameByTitle("gba", "Moonlight Voyage").ko, "별빛 항로");
  fs.writeFileSync(`${file}.next`, JSON.stringify(dictionary("구름 항로")));
  fs.renameSync(`${file}.next`, file);
  assert.equal(names.koreanNameByTitle("gba", "Moonlight Voyage").ko, "구름 항로");
  fs.writeFileSync(file, "{");
  assert.equal(names.koreanNameByTitle("gba", "Moonlight Voyage").ko, "구름 항로");
  fs.writeFileSync(file, JSON.stringify({ systems: { gba: { [hash]: "invalid row" } } }));
  assert.equal(names.koreanNameByTitle("gba", "Moonlight Voyage").ko, "구름 항로");
  fs.unlinkSync(file);
  assert.equal(names.koreanNameByTitle("gba", "Moonlight Voyage"), null);
  assert.ok(names.koreanNameCounts().nes > 0, "the bundled dictionary remains available");
});

test("local title corrections override hash-derived guesses without changing hash labels", () => {
  try {
    names.useKoreanNames(dictionary("원래 표시명"), { gba: { "Moonlight Voyage": "교정 표시명" } });
    assert.equal(names.koreanNameByTitle("gba", "Moonlight Voyage").ko,"교정 표시명");
    assert.equal(names.koreanName("gba", { sha256: "a".repeat(64) }).ko,"원래 표시명");
  } finally { names.useKoreanNames(null); }
});
