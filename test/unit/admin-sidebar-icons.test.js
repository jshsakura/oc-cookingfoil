import { test } from "node:test";
import assert from "node:assert/strict";
import { ADMIN_PAGES, rowTabsHtml, sidebarNav } from "../../src/routes/admin/admin-pages.js";
import { ICON_NAMES } from "../../src/views/icons.js";

// Every sidebar entry and every tab over a page carries an icon the icon set can draw.
test("every sidebar page and task has an icon that exists", () => {
  for (const page of ADMIN_PAGES) {
    if (page.tasks) {
      for (const task of page.tasks) assert.ok(ICON_NAMES.includes(task.icon), `${page.path} ${task.view}: ${task.icon}`);
    } else {
      assert.ok(ICON_NAMES.includes(page.icon), `${page.path}: ${page.icon}`);
    }
  }
});

test("the sidebar holds eleven entries and draws an icon in front of every link and tab", () => {
  const links = sidebarNav(null).match(/<a class="adm-item[^"]*"[^>]*>(.*?)<\/a>/g) ?? [];
  assert.equal(links.length, 11);
  const tabs = ADMIN_PAGES.flatMap((p) => rowTabsHtml(p).match(/<a [^>]*>(.*?)<\/a>/g) ?? []);
  assert.ok(tabs.length > 20);
  for (const a of [...links, ...tabs]) assert.match(a, /<svg class="ico"/, a);
});

test("the alert settings live under the settings and what was sent under the records", () => {
  const [settings, history] = ["setup", "history"].map((sub) => ADMIN_PAGES.find((p) => p.tab === "alerts" && (p.sub ?? "setup") === sub));
  assert.equal(settings.path, "/admin/settings/notifications");
  assert.equal(settings.row, "set");
  assert.equal(history.path, "/admin/logs/alerts");
  assert.equal(history.row, "ops");
});

test("the library is a heading over one entry per platform, then retro and the trash", () => {
  const nav = sidebarNav(null);
  assert.equal((nav.match(/class="adm-group"/g) ?? []).length, 1);
  const under = [...nav.slice(nav.indexOf('class="adm-group"')).matchAll(/<a class="adm-item adm-sub" href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(under, ["/admin/games", "/admin/vita/games", "/admin/retro", "/admin/trash"]);
  const tabs = (row) => ADMIN_PAGES.filter((p) => p.row === row).map((p) => p.path);
  assert.deepEqual(tabs("vita"), ["/admin/vita/games", "/admin/vita/homebrew", "/admin/vita/plugins", "/admin/vita/saves", "/admin/vita/retroarch"]);
  assert.deepEqual(tabs("psp"), []);
  assert.deepEqual(tabs("switch"), ["/admin/games", "/admin/homebrew", "/admin/patches", "/admin/saves", "/admin/switch/retroarch"]);
});
