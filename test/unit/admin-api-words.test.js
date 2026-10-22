import { test } from "node:test";
import assert from "node:assert/strict";
import { API_WORDS, apiWord } from "../../src/routes/admin/api-words.js";

const req = (lang, query = {}) => ({ query, get: (h) => (h.toLowerCase() === "accept-language" ? lang : undefined) });

test("every admin language has every API message", () => {
  const keys = Object.keys(API_WORDS.ko).sort();
  for (const lang of ["en", "ja", "zh"]) assert.deepEqual(Object.keys(API_WORDS[lang]).sort(), keys, lang);
});

test("an API message follows the admin page's language, English for any other", () => {
  assert.equal(apiWord(req("ko"), "failed"), API_WORDS.ko.failed);
  assert.equal(apiWord(req("ja-JP"), "failed"), API_WORDS.ja.failed);
  assert.equal(apiWord(req("zh-TW"), "failed"), API_WORDS.zh.failed, "traditional Chinese reads the Chinese text");
  assert.equal(apiWord(req("es"), "failed"), API_WORDS.en.failed);
  assert.equal(apiWord(req(undefined), "failed"), API_WORDS.en.failed, "a token without the header gets English");
});

