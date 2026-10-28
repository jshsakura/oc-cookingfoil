import { test } from "node:test";
import assert from "node:assert/strict";
import { guidePage } from "../../src/routes/admin/guide-page.js";

test("the guide page carries both documents and shows the one for the admin language", () => {
  const html = guidePage("# 안내\n\n본문", "# Guide\n\nBody");
  assert.match(html, /<div data-guide-lang="ko">[\s\S]*안내[\s\S]*<\/div>/);
  assert.match(html, /<div data-guide-lang="en" hidden>[\s\S]*Guide[\s\S]*<\/div>/);
  assert.match(html, /adminLang==='ko'\?'ko':'en'/, "Japanese and Chinese read English");
  assert.match(html, /admRelabelHooks/, "a language switch swaps the document");
});

test("without an English document the page shows the same text in both", () => {
  const html = guidePage("# Guide");
  assert.equal(html.split("# Guide").length - 1, 0);
  assert.equal(html.split("<h1>Guide</h1>").length - 1, 2);
});
