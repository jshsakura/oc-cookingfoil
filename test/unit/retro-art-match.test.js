import { test } from "node:test";
import assert from "node:assert/strict";
import { bestMatch, englishTitle, regionRank } from "../../scripts/retro-art-match.mjs";

test("the English title is the parenthesised part of a Korean file name", () => {
  assert.equal(englishTitle("건덱 (Gun-Dec) [J-K v20250920 v1.25]"), "Gun-Dec");
  assert.equal(englishTitle("SD 건담 G제네레이션 오버월드 (SD Gundam G Generation Overworld) [K]"), "SD Gundam G Generation Overworld");
  assert.equal(englishTitle("Plain Name"), "Plain Name");
});

test("Japanese releases rank ahead of others, and betas last", () => {
  assert.ok(regionRank("Otogirisou (Japan)") < regionRank("Otogirisou (USA)"));
  assert.ok(regionRank("Gun-Dec (USA)") < regionRank("Gun-Dec (Japan) (Beta)"));
});

test("a match picks the best region among same-title names, and nothing for unknown titles", () => {
  const names = ["Firemen, The (Europe)", "Firemen, The (Japan)", "Firewall (USA)"];
  assert.equal(bestMatch("The Firemen", names), "Firemen, The (Japan)");
  assert.equal(bestMatch("Hamo vs Ayo Volly", names), null);
});
