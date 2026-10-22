import { test } from "node:test";
import assert from "node:assert/strict";
import { TOP_WORDS, TOP_LANGS } from "../../src/routes/admin/top-i18n.js";
import { dashboardPage } from "../../src/routes/admin/dashboard-page.js";

// i18n-ratchet.test.js holds TOP_WORDS, like every dictionary, to all four languages with the same keys.

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
