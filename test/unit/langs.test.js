import { test } from "node:test";
import assert from "node:assert/strict";
import { LANGS, fallbacks, parseLang, pick, requestLang, tableLang } from "../../src/meta/langs.js";
import { SWITCH_LABELS, RETRO_LABELS } from "../../src/meta/card-labels.js";
import { SCORE_LABELS } from "../../src/meta/ratings.js";
import { STYLE_NAMES } from "../../src/retro/menu.js";
import { filtersOf, SORTS, REGIONS } from "../../src/retro/filters.js";

const req = (query, header) => ({ query, get: () => header });

test("a tag names one of the twelve languages; Chinese splits into simplified and traditional", () => {
  assert.equal(parseLang("ko-KR"), "ko");
  assert.equal(parseLang("pt-BR"), "pt");
  assert.equal(parseLang("NL"), "nl");
  for (const tag of ["zh", "zh-CN", "zh-Hans", "zh_SG"]) assert.equal(parseLang(tag), "zh", tag);
  for (const tag of ["zh-Hant", "zh-TW", "zh-HK", "zh-Hant-TW", "zh_mo"]) assert.equal(parseLang(tag), "zh-Hant", tag);
  for (const tag of ["sv", "pl-PL", "", undefined]) assert.equal(parseLang(tag), null, String(tag));
});

test("a request's language: ?lang= decides alone, an unknown one is English, never the server's first", () => {
  assert.equal(requestLang(req({ lang: "es" }, "ko-KR")), "es");
  assert.equal(requestLang(req({ lang: "sv" }, "ko-KR")), "en", "an unknown ?lang= does not fall through to Korean");
  assert.equal(requestLang(req({ lang: "zh-Hant" })), "zh-Hant");
  assert.equal(requestLang(req({}, "sv-SE,de;q=0.8,ko;q=0.9")), "ko", "Accept-Language by weight");
  assert.equal(requestLang(req({}, "sv-SE,de;q=0.8")), "de");
  assert.equal(requestLang(req({}, "fr;q=0,it")), "it", "a language refused with q=0 is skipped");
  assert.equal(requestLang(req({}, undefined)), "en");
});

test("text falls back to the language asked, then English", () => {
  assert.deepEqual(fallbacks("zh-Hant"), ["zh-Hant", "en"]);
  assert.deepEqual(fallbacks("en"), ["en"]);
  assert.equal(pick({ en: "Name", zh: "名称" }, "zh-Hant"), "Name", "a traditional reader never gets simplified text");
  assert.equal(pick({ en: "Name", ko: "이름" }, "es"), "Name");
  assert.equal(pick({ ko: "이름" }, "es"), null, "no Korean for a Spanish reader");
  assert.equal(pick(null, "en"), null);
});

test("every fixed text a client shows has every language", () => {
  const tables = [
    ...Object.values(SWITCH_LABELS), ...Object.values(RETRO_LABELS), ...Object.values(SCORE_LABELS), ...Object.values(STYLE_NAMES),
    ...SORTS, ...Object.values(REGIONS),
  ];
  for (const t of tables) for (const lang of LANGS) assert.ok(t[lang], `${lang}: ${JSON.stringify(t)}`);
  const facts = { genres: ["Action"], styles: ["horror"], players: 2, year: 1994, region: "jp", rating: 85, korean: true, achievements: true };
  const { groups } = filtersOf([{ id: "a", size: 1024, bezel: null }], () => facts);
  for (const g of groups) {
    for (const lang of LANGS) assert.ok(g[lang], `${g.key} ${lang}`);
    for (const o of g.options) for (const lang of LANGS) assert.ok(o[lang], `${g.key}/${o.key} ${lang}`);
  }
});

test("requestLang: every client language as it is, regional variants folded, Chinese by script", () => {
  const table = {
    en: "en", ko: "ko", ja: "ja", zh: "zh", "zh-Hant": "zh-Hant", de: "de", fr: "fr", es: "es", it: "it", nl: "nl", pt: "pt", ru: "ru",
    "zh-TW": "zh-Hant", "zh-HK": "zh-Hant", "zh-MO": "zh-Hant", "zh-Hant-TW": "zh-Hant", "zh-Hant-HK": "zh-Hant", "zh-hant": "zh-Hant",
    "zh-CN": "zh", "zh-SG": "zh", "zh-Hans": "zh", "zh-Hans-CN": "zh",
    "zh-Hans-HK": "zh", "zh-Hant-CN": "zh-Hant",
    "pt-BR": "pt", "pt-PT": "pt", "de-AT": "de", "de-CH": "de", "es-419": "es", "es-MX": "es", "fr-CA": "fr", "it-CH": "it",
    "nl-BE": "nl", "ru-RU": "ru", "en-GB": "en", "ja-JP": "ja", "ko-KR": "ko", "EN-us": "en",
    sv: "en", pl: "en", "*": "en", "x-klingon": "en",
  };
  for (const [tag, want] of Object.entries(table)) {
    assert.equal(requestLang(req({ lang: tag })), want, `?lang=${tag}`);
    assert.equal(requestLang(req({}, tag)), want, `Accept-Language: ${tag}`);
  }
});

test("requestLang: Accept-Language weights decide, a refused or unknown tag is passed over", () => {
  assert.equal(requestLang(req({}, "en;q=0.5, zh-Hant;q=0.9, ja;q=0.7")), "zh-Hant");
  assert.equal(requestLang(req({}, "zh-TW;q=0.4,pt-BR;q=0.6")), "pt");
  assert.equal(requestLang(req({}, " nl-BE ; q=0.8 , *;q=0.1")), "nl", "spaces around the tag and its weight");
  assert.equal(requestLang(req({}, "*, de;q=0.2")), "de", "a wildcard names no language");
  assert.equal(requestLang(req({}, "ru;q=bad, it;q=0.3")), "it", "a broken weight counts as refused");
  assert.equal(requestLang(req({}, "de;q=0.8, fr;q=0.8")), "de", "a tie keeps the header's order");
  assert.equal(requestLang(req({}, "")), "en");
});

test("requestLang: a repeated ?lang= takes its first value", () => {
  assert.equal(requestLang(req({ lang: ["zh-Hant", "de"] })), "zh-Hant");
  assert.equal(requestLang(req({ lang: [] }, "fr")), "fr", "an empty list is no ?lang= at all");
});

test("simplified and traditional Chinese never stand in for each other", () => {
  assert.deepEqual(fallbacks("zh"), ["zh", "en"]);
  assert.equal(pick({ en: "Name", "zh-Hant": "名稱" }, "zh"), "Name", "Hong Kong's text is not shown to a simplified reader");
  for (const lang of ["ko", "ja", "de", "pt"]) assert.deepEqual(fallbacks(lang), [lang, "en"], lang);
});

test("tableLang: the language a fixed text table answers a reader in", () => {
  const table = { en: {}, ko: {}, zh: {} };
  assert.equal(tableLang(table, "ko"), "ko");
  assert.equal(tableLang(table, "zh-Hant"), "en", "a traditional reader gets English, not simplified");
  assert.equal(tableLang(table, "de"), "en");
});
