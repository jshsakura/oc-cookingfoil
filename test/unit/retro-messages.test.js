import { test } from "node:test";
import assert from "node:assert/strict";
import { RETRO_MESSAGES, RetroError, retroError, retroSaid, retroText } from "../../src/retro/retro-messages.js";

test("every admin language has every retro message, none empty", () => {
  const keys = Object.keys(RETRO_MESSAGES.en).sort();
  for (const lang of ["ko", "ja", "zh"]) {
    assert.deepEqual(Object.keys(RETRO_MESSAGES[lang]).sort(), keys, lang);
    for (const k of keys) assert.ok(RETRO_MESSAGES[lang][k].trim(), `${lang} ${k}`);
  }
});

test("an error is English with its code, and a route answers in the reader's language", () => {
  const err = RetroError.of("meta.shrunk", { before: 20, after: 1 });
  assert.equal(err.message, "The LaunchBox data shrank from 20 to 1 games since last time, so it was not applied");
  const req = (lang) => ({ get: (h) => (h.toLowerCase() === "accept-language" ? lang : undefined), headers: { "accept-language": lang } });
  assert.deepEqual(retroError(req("ko"), err), { error: "LaunchBox 자료가 지난번 20개에서 1개로 크게 줄어 적용하지 않았습니다", code: "meta.shrunk" });
  assert.deepEqual(retroError(req("ko"), new Error("plain")), { error: "plain" }, "an error from elsewhere passes as it is");
});

test("a kept reason is put into words with its region in the same language", () => {
  const said = { code: "arcade.pickNewer", vars: { label: "arcade.jp" } };
  assert.equal(retroSaid("ko", said), "일본판 최신 개정입니다");
  assert.equal(retroSaid("en", said), "Japanese set, latest revision");
  assert.equal(retroSaid("zh-Hant", said), retroText("zh", "arcade.pickNewer", { label: retroText("zh", "arcade.jp") }));
});
