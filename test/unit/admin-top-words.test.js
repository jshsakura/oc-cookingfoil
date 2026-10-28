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
  assert.match(html, /<a class="up-entry" id="up-entry" href="\/admin\/upload"/);
});

test("every section keeps its id and every job keeps its page address", () => {
  const html = dashboardPage();
  for (const tab of ["overview", "users", "devices", "settings", "alerts", "logs", "featured", "library", "nsz", "upload", "inbox", "homebrew", "retro"]) {
    assert.match(html, new RegExp(`<section id="tab-${tab}"`), `tab-${tab}`);
  }
  // The page each of those sections now lives behind (admin-pages.js). The
  // incoming row opens its first page and stands for the others it lists.
  for (const path of ["/admin", "/admin/games", "/admin/retro", "/admin/homebrew", "/admin/upload", "/admin/convert", "/admin/featured", "/admin/trash", "/admin/users", "/admin/devices", "/admin/logs/downloads", "/admin/logs/clients", "/admin/logs/security", "/admin/settings/notifications", "/admin/client", "/admin/settings/server", "/admin/settings/integrations", "/admin/settings/login", "/admin/settings/admin", "/admin/settings/automation"]) {
    assert.match(html, new RegExp(`href="${path.replace(/\//g, "\\/")}"`), `sidebar link for ${path}`);
  }
  assert.match(html, /data-paths="\/admin\/upload \/admin\/incoming\/temp \/admin\/inbox"/, "the incoming row stands for its three pages");
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
