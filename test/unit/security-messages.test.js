import { test } from "node:test";
import assert from "node:assert/strict";
import { SECURITY_MESSAGES, securityText, securityError, codedError } from "../../src/security/security-messages.js";
import { TokenError } from "../../src/security/api-tokens.js";
import { LANGS } from "../../src/meta/langs.js";

test("every security message is written in all twelve admin languages with matching placeholders", () => {
  const keys = Object.keys(SECURITY_MESSAGES.en).sort();
  const variables = (value) => [...new Set(value.match(/\{\w+\}/g) ?? [])].sort();
  assert.deepEqual(Object.keys(SECURITY_MESSAGES).sort(), [...LANGS].sort());
  for (const lang of LANGS) {
    assert.deepEqual(Object.keys(SECURITY_MESSAGES[lang]).sort(), keys, lang);
    for (const key of keys) assert.deepEqual(variables(SECURITY_MESSAGES[lang][key]), variables(SECURITY_MESSAGES.en[key]), `${lang} ${key}`);
  }
  for (const lang of Object.keys(SECURITY_MESSAGES)) for (const [k, v] of Object.entries(SECURITY_MESSAGES[lang])) assert.ok(v.trim(), `${lang} ${k}`);
});

test("a coded error says English and a route answers in the request's language", () => {
  const err = codedError(TokenError, "token.max", { n: 20 });
  assert.ok(err instanceof TokenError);
  assert.equal(err.message, "Up to 20 tokens can be made");
  assert.deepEqual(securityError({ query: { lang: "ko" } }, err), { error: "토큰은 20개까지 만들 수 있습니다", code: "token.max" });
  assert.deepEqual(securityError({ query: {} }, err), { error: "Up to 20 tokens can be made", code: "token.max" });
  assert.deepEqual(securityError({ query: {} }, new Error("plain")), { error: "plain" });
  assert.equal(securityText("zh-Hant", "token.missing"), SECURITY_MESSAGES['zh-Hant']["token.missing"]);
  assert.notEqual(securityText("zh-Hant", "token.missing"), SECURITY_MESSAGES.zh["token.missing"]);
  assert.equal(securityError({ query: { lang: 'pt-BR' } }, err).error, securityText('pt', 'token.max', { n: 20 }));
  assert.equal(securityError({ query: { lang: 'zh-TW' } }, err).error, securityText('zh-Hant', 'token.max', { n: 20 }));
  assert.equal(securityText('unknown', 'token.max', { n: 20 }), securityText('en', 'token.max', { n: 20 }));
});
