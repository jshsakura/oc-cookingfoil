import { test } from "node:test";
import assert from "node:assert/strict";
import { LANGS, fallbacks, parseLang, pick, requestLang } from "../../src/meta/langs.js";
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

test("text falls back to the language asked, simplified Chinese for traditional, then English", () => {
  assert.deepEqual(fallbacks("zh-Hant"), ["zh-Hant", "zh", "en"]);
  assert.deepEqual(fallbacks("en"), ["en"]);
  assert.equal(pick({ en: "Name", zh: "名称" }, "zh-Hant"), "名称");
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
