import { test } from "node:test";
import assert from "node:assert/strict";

const { NOTICE_TEXT, NOTICE_LANGS } = await import("../../src/chat/notice-text.js");
const { buildNotice, mergeNotices, TITLE_MAX, BODY_MAX } = await import("../../src/chat/notice.js");

const base = { actor: { name: "Tester", admin: false }, capId: "upload_apply", area: "retro", section: "GBA", outcome: "done", change: true, count: 1, at: 1000 };

test("a carried-out upload says who, which menu and what", () => {
  const n = buildNotice({ ...base, subject: "Sample Hack.gba", bytes: 16 * 1024 * 1024 });
  assert.equal(n.kind, "applied");
  assert.equal(n.level, "info");
  assert.equal(n.sticky, false);
  assert.match(n.title, /새 파일/);
  assert.match(n.body, /Tester님이 레트로 > GBA에서 파일 올리기 작업을 했습니다/);
  assert.match(n.body, /Sample Hack\.gba/);
  assert.match(n.body, /16MB/);
  assert.deepEqual([n.actor, n.area, n.capId, n.count], ["Tester", "retro", "upload_apply", 1]);
});

test("a read is not a notice", () => {
  assert.equal(buildNotice({ ...base, capId: "games_search", change: false }), null);
});

test("a request waits for an answer and carries the buttons", () => {
  const n = buildNotice({ ...base, outcome: "requested", requestId: "R".repeat(22) });
  assert.equal(n.kind, "request");
  assert.equal(n.level, "action");
  assert.equal(n.sticky, true);
  assert.match(n.body, /요청했습니다/);
  assert.deepEqual(n.actions.map((a) => a.id), ["approve", "refuse"]);
  assert.equal(n.requestId, "R".repeat(22));
});

test("an area the table does not know is still told, under its own name", () => {
  const n = buildNotice({ ...base, area: "newarea", section: undefined, capId: "something_set" });
  assert.match(n.body, /newarea/);
  assert.match(n.body, /something_set/);
});

test("title and body stay short and plain", () => {
  const n = buildNotice({ ...base, subject: `${"가".repeat(300)}\u0007\n<b>x</b>`, actor: { name: "나".repeat(200) } });
  assert.ok(n.title.length <= TITLE_MAX);
  assert.ok(n.body.length <= BODY_MAX);
  assert.doesNotMatch(n.body, /[\u0000-\u001f]/);
});

test("an e-mail address never appears in a notice", () => {
  const n = buildNotice({ ...base, actor: { name: "someone@example.com" }, subject: "x@example.org" });
  assert.doesNotMatch(JSON.stringify(n), /@/);
});

test("changes by one person of one kind in the same menu merge into one card", () => {
  const a = buildNotice({ ...base, capId: "game_art_set", area: "games", section: undefined, at: 1000 });
  const b = buildNotice({ ...base, capId: "game_art_set", area: "games", section: undefined, at: 2000 });
  const c = buildNotice({ ...base, capId: "settings_set", area: "admin", section: undefined, at: 3000 });
  const merged = mergeNotices([a, b, c], { windowMs: 5000 });
  assert.equal(merged.length, 2);
  assert.equal(merged[0].count, 2);
  assert.match(merged[0].body, /2건/);
  assert.equal(merged[1].count, 1);
});

test("requests are never merged and cards outside the window stay apart", () => {
  const r = (id) => buildNotice({ ...base, outcome: "requested", requestId: id.repeat(22), at: 1000 });
  assert.equal(mergeNotices([r("a"), r("b")], { windowMs: 5000 }).length, 2);
  const x = buildNotice({ ...base, at: 1000 });
  const y = buildNotice({ ...base, at: 100000 });
  assert.equal(mergeNotices([x, y], { windowMs: 5000 }).length, 2);
});

test("merging does not change the cards it was given", () => {
  const a = buildNotice({ ...base, at: 1000 });
  const b = buildNotice({ ...base, at: 1500 });
  const before = JSON.stringify([a, b]);
  mergeNotices([a, b], { windowMs: 5000 });
  assert.equal(JSON.stringify([a, b]), before);
});

test("every language has every word, and none uses a dash", () => {
  const keys = Object.keys(NOTICE_TEXT.ko).sort();
  for (const lang of NOTICE_LANGS) {
    assert.deepEqual(Object.keys(NOTICE_TEXT[lang]).sort(), keys, lang);
    for (const [k, v] of Object.entries(NOTICE_TEXT[lang])) {
      assert.ok(v.trim(), `${lang}.${k} is empty`);
      assert.doesNotMatch(v, /[\u2013\u2014-]/, `${lang}.${k} has a dash`);
    }
  }
});

test("the card is worded in the language asked for, and an unknown one falls back to Korean", () => {
  const en = buildNotice({ ...base, lang: "en" });
  assert.equal(en.body, "Tester did file upload in Retro > GBA");
  assert.equal(en.title, "New file added");
  assert.match(buildNotice({ ...base, lang: "xx" }).body, /Tester님이/);
  for (const lang of NOTICE_LANGS) assert.ok(buildNotice({ ...base, lang, outcome: "requested" }).body.includes("Tester"), lang);
});

test("merged cards keep their language and cards of two languages stay apart", () => {
  const a = buildNotice({ ...base, lang: "en", at: 1000 });
  const b = buildNotice({ ...base, lang: "en", at: 1500 });
  const c = buildNotice({ ...base, lang: "ja", at: 1600 });
  const merged = mergeNotices([a, b, c], { windowMs: 5000 });
  assert.equal(merged.length, 2);
  assert.equal(merged[0].body, "Tester did file upload 2 times in Retro");
});
