import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ACTIVITY_CSS } from "../../src/routes/admin/activity-panel.js";
import { SCALE } from "../../src/routes/admin/styles.js";

// The library page borrows the admin's activity menu. A token that page never defines makes the rule
// that reads it invalid: the busy ring lost its --r-pill and spun as a straight line (2026-10-27).
const html = readFileSync(path.join(import.meta.dirname, "../../src/views/landing.html"), "utf-8");

test("every token the activity menu reads is defined on the library page", () => {
  const page = html.replace("__SCALE__", SCALE);
  const used = new Set([...ACTIVITY_CSS.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
  const missing = [...used].filter((v) => !new RegExp(`${v}\\s*:`).test(page));
  assert.deepEqual(missing, []);
});

test("the library page's own palette wins over the admin defaults it borrows", () => {
  assert.ok(html.indexOf("__SCALE__") >= 0 && html.indexOf("__SCALE__") < html.indexOf("--ground: #16161a"));
});
