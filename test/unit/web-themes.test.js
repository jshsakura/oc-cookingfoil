import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { ADMIN_CSS } from "../../src/routes/admin/styles.js";
import { fillTemplate } from "../../src/routes/landing.js";
import { THEMES, THEME_HEAD_SCRIPT, THEME_WORDS, contrast } from "../../src/views/themes.js";
import { TOP_WORDS } from "../../src/routes/admin/top-i18n.js";

// The web offers the console client's six themes (include/core/State.hpp ThemeNames), in its order.
const CLIENT_THEMES = ["light", "dark", "navy", "purple", "green", "pink"];
const site = fillTemplate(readFileSync(path.join(import.meta.dirname, "../../src/views/landing.html"), "utf-8"));

test("the web has the client's six themes, in its order", () => {
  assert.deepEqual(THEMES.map((t) => t.id), CLIENT_THEMES);
});

test("text reads at 4.5:1 and faint, status and DLC colours at 3:1 on every theme's grounds", () => {
  const low = [];
  for (const t of THEMES) {
    for (const ground of ["ground", "surface", "sunk"]) {
      for (const fg of ["ink", "secondary"]) if (contrast(t[fg], t[ground]) < 4.5) low.push(`${t.id} ${fg} on ${ground}`);
      // light and dark keep the web's tuned values, which predate this floor
      if (t.id === "light" || t.id === "dark") continue;
      for (const fg of ["faint", "good", "pending", "bad", "dlc"]) if (contrast(t[fg], t[ground]) < 3) low.push(`${t.id} ${fg} on ${ground}`);
    }
  }
  assert.deepEqual(low, []);
});

test("light and dark keep the web's tuned values", () => {
  const light = THEMES.find((t) => t.id === "light"), dark = THEMES.find((t) => t.id === "dark");
  assert.deepEqual([light.ground, light.surface, light.ink, light.secondary], ["#f2f1ee", "#ffffff", "#16161a", "#55555e"]);
  assert.deepEqual([dark.ground, dark.surface, dark.ink, dark.secondary], ["#16161a", "#1f1f24", "#f2f1ee", "#a9a8a3"]);
});

test("both surfaces carry a block for every theme, and the head script accepts each id", () => {
  for (const t of THEMES) {
    assert.ok(ADMIN_CSS.includes(`:root[data-theme="${t.id}"]{--bg:${t.ground};`), `admin lacks ${t.id}`);
    assert.ok(site.includes(`:root[data-theme="${t.id}"]{--ground: ${t.ground};`), `web page lacks ${t.id}`);
    assert.ok(THEME_HEAD_SCRIPT.includes(`"${t.id}":"${t.ground}"`), `head script lacks ${t.id}`);
    assert.ok(site.includes(`data-theme-pick="${t.id}"`), `web picker lacks ${t.id}`);
  }
});

test("the picker is named in every language either surface speaks", () => {
  const keys = ["theme.label", ...THEMES.map((t) => `theme.${t.id}`)];
  for (const [code, words] of Object.entries(TOP_WORDS)) {
    assert.deepEqual(keys.filter((k) => !words[k]), [], `admin ${code}`);
    assert.deepEqual(keys.filter((k) => !THEME_WORDS[code]?.[k]), [], `themes ${code}`);
  }
});
