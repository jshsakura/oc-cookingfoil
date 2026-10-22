import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { iconsByLang, pickIconForLangs } from "../../src/meta/extract-providers/nsp.js";
import { NACP_SLOT_TO_ICON_NAME, NACP_LANG_SLOTS } from "../../src/meta/nacp-decode.js";

// The Control NCA's icon file per NACP language slot, as switchbrew lists them
// (https://switchbrew.org/wiki/NACP_Format, Language table, "Icon language filename").
const SWITCHBREW_SLOTS = [
  "AmericanEnglish", "BritishEnglish", "Japanese", "French", "German", "LatinAmericanSpanish", "Spanish", "Italian",
  "Dutch", "CanadianFrench", "Portuguese", "Russian", "Korean", "TraditionalChinese", "SimplifiedChinese", "BrazilianPortuguese",
];

const iconDir = (names) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nsp-lang-icons-"));
  for (const name of names) fs.writeFileSync(path.join(dir, `icon_${name}.dat`), name);
  return dir;
};

test("the sixteen NACP slots carry switchbrew's names, in its order", () => {
  assert.deepEqual(Object.keys(NACP_SLOT_TO_ICON_NAME).map(Number), SWITCHBREW_SLOTS.map((_, i) => i));
  assert.deepEqual(Object.values(NACP_SLOT_TO_ICON_NAME), SWITCHBREW_SLOTS);
  assert.equal(NACP_LANG_SLOTS["zh-Hant"], 13);
  assert.equal(NACP_LANG_SLOTS["zh-TW"], 13);
  assert.equal(NACP_LANG_SLOTS.zh, 14);
});

test("a server that ranks traditional Chinese first takes the traditional icon as the game's icon", async () => {
  const dir = iconDir(["AmericanEnglish", "TraditionalChinese", "SimplifiedChinese"]);
  assert.equal((await pickIconForLangs(dir, ["zh-Hant", "en"])).toString(), "TraditionalChinese");
  assert.equal((await pickIconForLangs(dir, ["zh-TW", "en"])).toString(), "TraditionalChinese");
  assert.equal((await pickIconForLangs(dir, ["zh", "en"])).toString(), "SimplifiedChinese");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a game file's icons go to the client language that reads them; Chinese by script", async () => {
  const dir = iconDir(["Korean", "AmericanEnglish", "Japanese", "TraditionalChinese", "SimplifiedChinese", "German", "CanadianFrench", "LatinAmericanSpanish", "Italian", "Dutch", "BrazilianPortuguese", "Russian"]);
  const got = Object.fromEntries(Object.entries(await iconsByLang(dir)).map(([l, b]) => [l, b.toString()]));
  assert.deepEqual(got, {
    ko: "Korean", en: "AmericanEnglish", ja: "Japanese", zh: "SimplifiedChinese", "zh-Hant": "TraditionalChinese",
    de: "German", fr: "CanadianFrench", es: "LatinAmericanSpanish", it: "Italian", nl: "Dutch", pt: "BrazilianPortuguese", ru: "Russian",
  });
  fs.writeFileSync(path.join(dir, "icon_French.dat"), "French");
  fs.rmSync(path.join(dir, "icon_SimplifiedChinese.dat"));
  const again = await iconsByLang(dir);
  assert.equal(again.fr.toString(), "French", "France's French first");
  assert.equal(again.zh, undefined, "no simplified icon: zh has none of its own, never the traditional one");
  fs.rmSync(dir, { recursive: true, force: true });
});
