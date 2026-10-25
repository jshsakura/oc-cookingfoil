import { test } from "node:test";
import assert from "node:assert/strict";
import { LANGS } from "../../src/meta/langs.js";
import { META_MESSAGES, metaError, metaText, coded } from "../../src/meta/meta-messages.js";

const placeholders = (text) => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]))].sort();

test("meta errors preserve their codes and interpolate values in all twelve request languages", () => {
  const keys = Object.keys(META_MESSAGES.en).sort();
  for (const lang of LANGS) {
    assert.deepEqual(Object.keys(META_MESSAGES[lang]).sort(), keys, lang);
    for (const key of keys) {
      const names = placeholders(META_MESSAGES.en[key]);
      assert.deepEqual(placeholders(META_MESSAGES[lang][key]), names, `${lang}.${key}`);
      const vars = Object.fromEntries(names.map((name) => [name, (selected) => `${selected}:7`]));
      const error = coded(new Error(), key, vars);
      assert.equal(error.message, metaText("en", key, vars));
      const response = metaError({ query: { lang } }, error);
      assert.equal(response.code, key);
      assert.equal(response.error, metaText(lang, key, vars));
      assert.doesNotMatch(response.error, /\{\w+\}/);
      for (const name of names) assert.ok(response.error.includes(vars[name](lang)), `${lang}.${key} interpolates ${name}`);
      assert.deepEqual(metaError({ query: { lang } }, { key, code: "public-code", vars }), response);
    }
  }
  for (const [tag, lang] of [["zh-TW", "zh-Hant"], ["pt-BR", "pt"], ["xx", "en"]]) {
    const key = "inbox.empty";
    assert.deepEqual(metaError({ query: { lang: tag } }, { code: key }), { code: key, error: META_MESSAGES[lang][key] });
  }
});

test("patch path guidance substitutes the actual title ID without restricting patches to exefs", () => {
  const titleId = "0100000000010000";
  const path = "unrelated/file.bin";
  for (const lang of LANGS) {
    const message = metaText(lang, "upload.notPatchPath", { titleId, path });
    assert.ok(message.includes(`atmosphere/contents/${titleId}/…`), `${lang} gives the actual game's patch folder`);
    assert.ok(message.includes(path), `${lang} identifies the rejected path`);
    assert.equal(message.split(titleId).length - 1, 2, `${lang} substitutes the ID in the explanation and the example`);
    assert.doesNotMatch(message, /<title ID>|\/exefs/);
  }
});
