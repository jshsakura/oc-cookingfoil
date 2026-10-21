import { test } from "node:test";
import assert from "node:assert/strict";
import { LANGS, keysForTests, render, translator } from "../../src/helpers/alert-messages.js";
import { EVENTS } from "../../src/helpers/alerts.js";
import { startLine } from "../../src/security/direct-health.js";

test("every alert line exists in Korean, English, Japanese and Chinese", () => {
  for (const [key, langs] of Object.entries(keysForTests())) assert.deepEqual([...langs].sort(), [...LANGS].sort(), key);
  for (const id of [...Object.keys(EVENTS), "test"]) assert.notEqual(translator("en")(`event.${id}`), `event.${id}`, id);
});

test("no line uses a dash to join sentences", () => {
  for (const lang of LANGS) {
    const t = translator(lang);
    for (const key of Object.keys(keysForTests())) assert.doesNotMatch(t(key, { mins: 1, count: 2, addresses: 3, top: "x", email: "a", code: "c", lines: "", user: "u", files: 1, size: "1 B", links: 0, done: 1, saved: "1 GB", failed: 0, free: "1 GB", name: "n", reason: "r", on: "o", who: "w", line: "l", what: "w", where: "/x", owner: "o", how: "h", ip: "i", place: "p", names: "n", more: 0, app: "a", kind: "device" }), /[—–]/, `${lang} ${key}`);
  }
});

test("the start alert says the server started, and speaks of the direct address only when one is set", () => {
  const say = (lang, s) => render((t) => [t("serverStarted"), startLine(t, s)].filter(Boolean).join(t("gap")), lang);
  assert.equal(say("ko", { configured: false }), "서버가 기동되었습니다.");
  assert.equal(say("ko", { configured: true, up: true }), "서버가 기동되었습니다. 외부 다운로드 전용 주소도 정상적으로 응답하고 있습니다.");
  assert.equal(say("en", { configured: false }), "The server has started.");
  assert.equal(say("ja", { configured: true, up: false }), "サーバーが起動しました。外部ダウンロード専用アドレスはまだ応答していません。");
});

test("an unknown language falls back to Korean", () => {
  assert.equal(translator("fr")("serverStarted"), "서버가 기동되었습니다.");
});
