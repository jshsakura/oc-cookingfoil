import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ACTIVITY_CSS } from "../../src/routes/admin/activity-panel.js";
import { fillTemplate } from "../../src/routes/landing.js";

// The library page borrows the admin's activity menu. A token that page never defines makes the rule
// that reads it invalid: the busy ring lost its --r-pill and spun as a straight line (2026-10-27).
const raw = readFileSync(path.join(import.meta.dirname, "../../src/views/landing.html"), "utf-8");

test("every token the activity menu reads is defined on the library page", () => {
  const page = fillTemplate(raw);
  const used = new Set([...ACTIVITY_CSS.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
  const missing = [...used].filter((v) => !new RegExp(`${v}\\s*:`).test(page));
  assert.deepEqual(missing, []);
});

test("the library page's own palette wins over the admin defaults it borrows", () => {
  assert.ok(raw.indexOf("__SCALE__") >= 0 && raw.indexOf("__SCALE__") < raw.indexOf("__THEME_CSS__"));
});
