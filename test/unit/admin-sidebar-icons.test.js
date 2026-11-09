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

test("the sidebar holds eight entries and draws an icon in front of every link and tab", () => {
  const links = sidebarNav(null).match(/<a class="adm-item[^"]*"[^>]*>(.*?)<\/a>/g) ?? [];
  assert.equal(links.length, 8);
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
