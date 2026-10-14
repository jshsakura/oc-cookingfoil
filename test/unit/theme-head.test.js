import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { ADMIN_HEAD, THEME_HEAD_SCRIPT } from "../../src/routes/admin/styles.js";

// The web page and the admin pages read one stored theme before paint. A copy
// that drifts would show one theme on the web page and another in admin.
const html = readFileSync(path.join(import.meta.dirname, "../../src/views/landing.html"), "utf-8");

test("the web page applies the stored theme with the same head script as the admin pages", () => {
  assert.ok(html.includes(THEME_HEAD_SCRIPT), "landing.html carries another copy of the theme script");
  assert.ok(ADMIN_HEAD.includes(THEME_HEAD_SCRIPT));
  assert.match(THEME_HEAD_SCRIPT, /localStorage\.getItem\("cookingfoil:theme"\)/);
});

test("the head no longer forgets a stored theme", () => {
  assert.doesNotMatch(html, /removeItem\("cookingfoil:theme"\)/);
  assert.doesNotMatch(ADMIN_HEAD, /removeItem/);
});

test("the theme script runs after the theme-color meta it keeps in step", () => {
  assert.ok(html.indexOf('name="theme-color"') < html.indexOf(THEME_HEAD_SCRIPT));
  assert.ok(ADMIN_HEAD.indexOf('name="theme-color"') < ADMIN_HEAD.indexOf(THEME_HEAD_SCRIPT));
});
