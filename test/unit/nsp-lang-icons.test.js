import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { iconsByLang } from "../../src/meta/extract-providers/nsp.js";

test("a game file's icons go to the client language that reads them; Chinese by script", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nsp-lang-icons-"));
  for (const name of ["Korean", "AmericanEnglish", "Japanese", "TraditionalChinese", "SimplifiedChinese", "German", "CanadianFrench", "LatinAmericanSpanish", "Italian", "Dutch", "BrazilianPortuguese", "Russian"]) {
    fs.writeFileSync(path.join(dir, `icon_${name}.dat`), name);
  }
  const got = Object.fromEntries(Object.entries(await iconsByLang(dir)).map(([l, b]) => [l, b.toString()]));
  assert.deepEqual(got, {
    ko: "Korean", en: "AmericanEnglish", ja: "Japanese", zh: "SimplifiedChinese", "zh-Hant": "TraditionalChinese",
    de: "German", fr: "CanadianFrench", es: "LatinAmericanSpanish", it: "Italian", nl: "Dutch", pt: "BrazilianPortuguese", ru: "Russian",
  });
  fs.writeFileSync(path.join(dir, "icon_French.dat"), "French");
  fs.writeFileSync(path.join(dir, "icon_TaiwaneseChinese.dat"), "TaiwaneseChinese");
  fs.rmSync(path.join(dir, "icon_TraditionalChinese.dat"));
  const again = await iconsByLang(dir);
  assert.equal(again.fr.toString(), "French", "France's French first");
  assert.equal(again["zh-Hant"].toString(), "TaiwaneseChinese", "the older name of the traditional slot");
  fs.rmSync(dir, { recursive: true, force: true });
});
