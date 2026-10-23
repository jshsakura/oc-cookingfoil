import { test } from "node:test";
import assert from "node:assert/strict";
import { SECURITY_MESSAGES, securityText, securityError, codedError } from "../../src/security/security-messages.js";
import { TokenError } from "../../src/security/api-tokens.js";

test("every security message is written in all four admin languages", () => {
  const keys = Object.keys(SECURITY_MESSAGES.en).sort();
  for (const lang of ["ko", "ja", "zh"]) assert.deepEqual(Object.keys(SECURITY_MESSAGES[lang]).sort(), keys, lang);
  for (const lang of Object.keys(SECURITY_MESSAGES)) for (const [k, v] of Object.entries(SECURITY_MESSAGES[lang])) assert.ok(v.trim(), `${lang} ${k}`);
});

test("a coded error says English and a route answers in the request's language", () => {
  const err = codedError(TokenError, "token.max", { n: 20 });
  assert.ok(err instanceof TokenError);
  assert.equal(err.message, "Up to 20 tokens can be made");
  assert.deepEqual(securityError({ query: { lang: "ko" } }, err), { error: "토큰은 20개까지 만들 수 있습니다", code: "token.max" });
  assert.deepEqual(securityError({ query: {} }, err), { error: "Up to 20 tokens can be made", code: "token.max" });
  assert.deepEqual(securityError({ query: {} }, new Error("plain")), { error: "plain" });
  assert.equal(securityText("zh-Hant", "token.missing"), SECURITY_MESSAGES.zh["token.missing"]);
});
