import { test } from "node:test";
import assert from "node:assert/strict";
import { INTEGRITY_WORDS } from "../../src/meta/integrity-help-words.js";
import { explain, summary } from "../../src/meta/integrity-help.js";
import { TOP_LANGS } from "../../src/routes/admin/top-i18n.js";

// The label and help the console and the admin page show for a file check
// finding: every language says every case, with the numbers filled in.
const REASONS = ["signature-fail", "truncated", "missing-content", "hash-mismatch", "unreadable"];
const cut = { verdict: "damaged", reason: "truncated", detail: { present: 0.73, ncas: [{ id: "a".repeat(32), type: "Program" }, { id: "b".repeat(32), type: null }] } };

test("every language the admin page speaks has every label, part and help", () => {
  assert.deepEqual(Object.keys(INTEGRITY_WORDS).sort(), TOP_LANGS.map(([code]) => code).sort());
  for (const [lang, w] of Object.entries(INTEGRITY_WORDS)) {
    assert.deepEqual(Object.keys(w.label).sort(), ["damaged", "damaged-maybe", "modified"], lang);
    assert.ok(w.parts.unknown && w.parts.Program && w.parts.Control, lang);
    for (const reason of REASONS) {
      const body = w.help[reason].body({ p: 73, parts: "PARTS" });
      assert.ok(w.help[reason].title.trim(), `${lang} ${reason}`);
      assert.ok(body.split("\n\n").length >= 3, `${lang} ${reason}: several paragraphs`);
      assert.doesNotMatch(body, /\bundefined\b|\bnull\b/, `${lang} ${reason}`);
      if (reason === "truncated") assert.match(body, /73/, `${lang}: the share there`);
      if (["truncated", "missing-content", "hash-mismatch"].includes(reason)) assert.match(body, /PARTS/, `${lang} ${reason}: which parts`);
    }
  }
});

test("a cut-off file is surely damaged and says how much is there and what is missing", () => {
  assert.deepEqual(summary(cut), { reason: "truncated", certain: true, present: 0.73 });
  const e = explain(cut, "ko");
  assert.equal(e.label, "손상됨");
  assert.match(e.help.body, /73%/);
  assert.match(e.help.body, /게임 프로그램, 알 수 없는 부분/);
});

test("a hash mismatch is only possibly damaged; a modified file is not damage", () => {
  assert.equal(explain({ verdict: "damaged", reason: "hash-mismatch", detail: { ncas: [] } }, "en").label, "Possibly damaged");
  assert.equal(summary({ verdict: "modified", reason: "signature-fail" }).certain, false);
  assert.equal(explain({ verdict: "modified" }, "en").help.title, "This file has been modified", "a record without a reason still explains itself");
});

test("a language without words falls back to its base, then English", () => {
  assert.equal(explain(cut, "zh-Hans").label, INTEGRITY_WORDS.zh.label.damaged);
  assert.equal(explain(cut, "sv").label, "Damaged");
  assert.equal(explain(null, "ko"), null);
});
