import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

const { ADMIN_PAGE_BY_PATH } = await import("../../src/routes/admin/admin-pages.js");
const { splitPageFor } = await import("../../src/routes/admin/admin-split.js");
const { TOP_WORDS, TOP_LANGS } = await import("../../src/routes/admin/top-i18n.js");
const { CHAT_WORDS } = await import("../../src/routes/admin/chat-words.js");

const page = ADMIN_PAGE_BY_PATH.get("/admin/chat");

test("the chat has its own page and a menu entry", () => {
  assert.ok(page, "/admin/chat is in ADMIN_PAGES");
  const html = splitPageFor(page);
  assert.ok(html.includes('id="tab-chat"') && !html.includes('id="tab-chat" hidden'), "the section opens on its own page");
  for (const id of ["ch-switch", "ch-form", "ch-key", "ch-log", "ch-send", "ch-pending-list"]) assert.ok(html.includes(`id="${id}"`), id);
});

test("the page's script is valid JavaScript", () => {
  const html = splitPageFor(page);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.length > 0);
  for (const code of scripts) assert.doesNotThrow(() => new vm.Script(code));
  assert.match(scripts.join(""), /apiKey:\$\('ch-key'\)\.value/, "the key is sent only from its field");
});

test("every chat word exists in all twelve languages", () => {
  const codes = TOP_LANGS.map(([c]) => c);
  const keys = Object.keys(CHAT_WORDS.ko);
  for (const c of codes) {
    assert.deepEqual(Object.keys(CHAT_WORDS[c]).sort(), [...keys].sort(), c);
    for (const k of keys) assert.ok(CHAT_WORDS[c][k] && TOP_WORDS[c][k], `${c} ${k}`);
  }
});

test("the same placeholders appear in every language", () => {
  const holes = (s) => (s.match(/\{[a-z]+\}/g) ?? []).sort().join();
  for (const k of Object.keys(CHAT_WORDS.ko)) for (const c of Object.keys(CHAT_WORDS)) assert.equal(holes(CHAT_WORDS[c][k]), holes(CHAT_WORDS.ko[k]), `${c} ${k}`);
});

test("no dash joins sentences in the words", () => {
  for (const c of Object.keys(CHAT_WORDS)) for (const [k, v] of Object.entries(CHAT_WORDS[c])) assert.doesNotMatch(v, /[—–]/, `${c} ${k}`);
});
