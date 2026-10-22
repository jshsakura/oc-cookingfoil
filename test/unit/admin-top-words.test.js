import { test } from "node:test";
import assert from "node:assert/strict";
import { TOP_WORDS, TOP_LANGS } from "../../src/routes/admin/top-i18n.js";
import { dashboardPage } from "../../src/routes/admin/dashboard-page.js";

const keysOf = (lang) => Object.keys(TOP_WORDS[lang]).sort();

test("every admin top-area label exists in all four languages", () => {
  const ko = keysOf("ko");
  for (const [code] of TOP_LANGS) assert.deepEqual(keysOf(code), ko, `${code} has the same keys as ko`);
});

test("no top-area label is empty or uses an em dash", () => {
  for (const [code] of TOP_LANGS) {
    for (const [key, text] of Object.entries(TOP_WORDS[code])) {
      assert.ok(text.trim().length > 0, `${code}.${key} is empty`);
      assert.ok(!/[—–]/.test(text), `${code}.${key} has a dash`);
    }
  }
});

test("every data-top key the admin page uses has a label", () => {
  const html = dashboardPage();
  const used = new Set([...html.matchAll(/data-top="([^"]+)"/g)].map((m) => m[1]));
  assert.ok(used.size > 10);
  for (const key of used) assert.ok(key in TOP_WORDS.ko, `${key} is missing from TOP_WORDS`);
});

test("the header carries one upload entry that points at the upload page", () => {
  const html = dashboardPage();
  assert.equal([...html.matchAll(/id="up-entry"/g)].length, 1);
  assert.match(html, /<a class="up-entry" id="up-entry" href="#upload"/);
});

test("every pre-existing admin page hash still has its section", () => {
  const html = dashboardPage();
  for (const tab of ["overview", "users", "devices", "settings", "alerts", "logs", "featured", "library", "nsz", "upload", "inbox", "homebrew", "retro"]) {
    assert.match(html, new RegExp(`<section id="tab-${tab}"`), `tab-${tab}`);
    assert.match(html, new RegExp(`href="#${tab}" data-tab="${tab}"`), `menu link for ${tab}`);
  }
});

test("the look-alike folder notice names both folders and the system, and says the art follows the folder", () => {
  for (const [code] of TOP_LANGS) {
    const text = TOP_WORDS[code]["sc.shadowed"];
    for (const part of ["{alias}", "{canonical}", "{system}", "thumbnails/", "bezels/"]) assert.ok(text.includes(part), `${code} has ${part}`);
  }
  assert.match(TOP_WORDS.ko["sc.shadowed"], /합니다\.$|습니다\.$|옮깁니다\.$/);
});

test("beside the folder guide link, every language says a README.md is ignored and names no tool that does not exist yet", () => {
  for (const [code] of TOP_LANGS) {
    const text = TOP_WORDS[code]["sc.readme"];
    assert.ok(text?.includes("README.md"), `${code} mentions README.md`);
    assert.ok(!/MCP|library_storage_guide/.test(text), `${code} does not point at an MCP tool before /mcp ships`);
  }
  assert.match(TOP_WORDS.ko["sc.readme"], /습니다\.$/);
});
