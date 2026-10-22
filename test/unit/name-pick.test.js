import { test } from "node:test";
import assert from "node:assert/strict";
import { fileNamesOver, pickFileName, scriptLang } from "../../src/meta/name-pick.js";

const KO_FIRST = ["ko", "en", "ja"];

test("a title's language is read from its script", () => {
  assert.equal(scriptLang("드래곤 퀘스트 X 오프라인"), "ko");
  assert.equal(scriptLang("ドラゴンクエストX オフライン"), "ja");
  assert.equal(scriptLang("Fit Boxing 3 -Your パーソナルトレーナー-"), "ja", "kana anywhere is Japanese");
  assert.equal(scriptLang("牧場物語"), "zh", "Han alone is not taken for Japanese");
  assert.equal(scriptLang("Arcade Archives F/A"), "en");
  assert.equal(scriptLang(""), "en");
});

test("a Japan-only release shows the Korean or English title its file carries", () => {
  const titledb = { ja: "ドラゴンクエストX　目覚めし五つの種族　オフライン" };
  assert.equal(pickFileName(titledb, ["드래곤 퀘스트 X 오프라인", null], KO_FIRST), "드래곤 퀘스트 X 오프라인");
  assert.equal(pickFileName({ ja: "アーケードアーカイブス F/A" }, [undefined, "Arcade Archives F/A"], KO_FIRST), "Arcade Archives F/A");
  assert.deepEqual(fileNamesOver(titledb, ["Dragon Quest X Offline", "드래곤 퀘스트 X 오프라인"], KO_FIRST), { ko: "드래곤 퀘스트 X 오프라인", en: "Dragon Quest X Offline" }, "best language first");
});

test("titledb keeps its name when it already has the language the file offers, or a better one", () => {
  assert.equal(pickFileName({ ko: "젤다의 전설", en: "Zelda" }, ["Zelda (file)"], KO_FIRST), null);
  assert.equal(pickFileName({ en: "Dead Cells" }, ["Dead Cells"], KO_FIRST), null, "same language, titledb wins");
  assert.equal(pickFileName({ en: "Dead Cells" }, ["데드 셀"], KO_FIRST), "데드 셀");
  assert.equal(pickFileName({ ja: "アマカノ" }, ["アマカノ"], KO_FIRST), null, "a Japanese file title adds nothing");
  assert.equal(pickFileName({ ja: "牧場物語" }, ["牧場物語"], KO_FIRST), null, "a Han-only title is never taken for a better language");
});

test("the order decides: an English-first server keeps English over the file's Korean", () => {
  assert.equal(pickFileName({ en: "Kunio-kun" }, ["쿠니오군"], ["en", "ko", "ja"]), null);
  assert.equal(pickFileName({ ja: "くにおくん" }, ["쿠니오군", "Kunio-kun"], ["en", "ko", "ja"]), "Kunio-kun");
  assert.equal(pickFileName({ ja: "くにおくん" }, ["쿠니오군"], ["ko-KR", "en"]), "쿠니오군", "region tags count by language");
});

test("nothing known gives nothing; empty file titles are skipped", () => {
  assert.equal(pickFileName(null, [], KO_FIRST), null);
  assert.equal(pickFileName(null, ["", "  ", null], KO_FIRST), null);
  assert.equal(pickFileName(null, ["Homebrew App"], KO_FIRST), "Homebrew App", "with no titledb name the file's is used");
});

test("a traditional Chinese name from titledb ranks as zh-Hant, so a file's Han title does not beat it", () => {
  assert.deepEqual(fileNamesOver({ "zh-Hant": "繁體名" }, ["中文名"], ["zh-Hant", "zh", "en"]), {});
  assert.deepEqual(fileNamesOver({ "zh-Hant": "繁體名" }, ["中文名"], ["zh", "zh-Hant", "en"]), { zh: "中文名" });
  assert.deepEqual(fileNamesOver({ ja: "日本語名" }, ["Name"], ["en-US", "ja"]), { en: "Name" }, "a regional priority still names its language");
});

test("a file's Han title still wins on a server that ranks traditional Chinese, keyed as that language", () => {
  assert.deepEqual(fileNamesOver({ ja: "日本語名" }, ["繁體名稱"], ["zh-TW", "en"]), { "zh-Hant": "繁體名稱" });
  assert.deepEqual(fileNamesOver({ ja: "日本語名" }, ["繁體名稱"], ["zh-HK", "ja"]), { "zh-Hant": "繁體名稱" });
  assert.deepEqual(fileNamesOver({ ja: "日本語名" }, ["简体名称"], ["zh-CN", "en"]), { zh: "简体名称" });
  assert.equal(pickFileName({ ja: "日本語名" }, ["繁體名稱"], ["zh-TW", "en"]), "繁體名稱");
  assert.deepEqual(fileNamesOver({ en: "English" }, ["繁體名稱"], ["en", "zh-TW"]), {}, "a better-ranked titledb name still wins");
});
