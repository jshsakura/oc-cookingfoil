import { test } from "node:test";
import assert from "node:assert/strict";
import { LANGS } from "../../src/meta/langs.js";
import { API_WORDS, apiWord } from "../../src/routes/admin/api-words.js";

const req = (lang, query = {}) => ({ query, get: (h) => (h.toLowerCase() === "accept-language" ? lang : undefined) });

test("every admin language has every API message", () => {
  const keys = Object.keys(API_WORDS.ko).sort();
  for (const lang of LANGS) assert.deepEqual(Object.keys(API_WORDS[lang]).sort(), keys, lang);
});

test("an API message follows the admin page's language, English for any other", () => {
  assert.equal(apiWord(req("ko"), "failed"), API_WORDS.ko.failed);
  assert.equal(apiWord(req("ja-JP"), "failed"), API_WORDS.ja.failed);
  assert.equal(apiWord(req("zh-TW"), "failed"), API_WORDS["zh-Hant"].failed, "Traditional Chinese has its own text");
  for (const lang of LANGS) assert.equal(apiWord(req(lang), "failed"), API_WORDS[lang].failed, lang);
  assert.equal(apiWord(req("pt-BR"), "failed"), API_WORDS.pt.failed);
  assert.equal(apiWord(req("xx"), "failed"), API_WORDS.en.failed);
  assert.equal(apiWord(req(undefined), "failed"), API_WORDS.en.failed, "a token without the header gets English");
});


test("every language of an API message fills the same placeholders", () => {
  const names = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const [key, ko] of Object.entries(API_WORDS.ko)) {
    for (const lang of LANGS) assert.deepEqual(names(API_WORDS[lang][key]), names(ko), `${lang}.${key}`);
  }
});

test("an admin route answers English without Accept-Language and the page's language with it", async () => {
  const { default: express } = await import("express");
  const { mountDescriptionsApi } = await import("../../src/routes/admin/descriptions-api.js");
  const app = express();
  const router = express.Router();
  mountDescriptionsApi(router, () => true);
  app.use("/admin", router);
  const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const url = `http://127.0.0.1:${server.address().port}/admin/api/descriptions/not-a-title`;
  const ask = async (headers = {}) => {
    const r = await fetch(url, { headers });
    return { status: r.status, error: (await r.json()).error };
  };
  try {
    assert.deepEqual(await ask(), { status: 400, error: "A title id is 16 hexadecimal digits" });
    assert.deepEqual(await ask({ "Accept-Language": "ko" }), { status: 400, error: API_WORDS.ko["descriptions.badTitle"] });
    for (const lang of LANGS) {
      assert.deepEqual(await ask({ "Accept-Language": lang }), { status: 400, error: API_WORDS[lang]["descriptions.badTitle"] }, lang);
    }
  } finally {
    server.close();
  }
});
