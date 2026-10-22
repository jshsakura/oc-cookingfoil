import { test } from "node:test";
import assert from "node:assert/strict";
import { LANGS } from "../../src/meta/langs.js";
import { GENRE_LABELS } from "../../src/meta/categories.js";
import { SCORE_LABELS } from "../../src/meta/ratings.js";
import { SWITCH_LABELS, RETRO_LABELS } from "../../src/meta/card-labels.js";
import { STYLE_NAMES } from "../../src/retro/menu.js";
import { REGIONS, SORTS } from "../../src/retro/filters.js";
import { BEZEL_CREDIT } from "../../src/retro/credits.js";
import { DEFAULT_SYSTEMS } from "../../src/retro/systems.js";
import { SOURCE_LABEL } from "../../src/meta/shop-saves.js";
import { DROPBOX_PAGE_TEXT } from "../../src/routes/dropbox-bridge.js";
import { PAIR_TEXT } from "../../src/routes/device-pair-text.js";
import { RA_LINK_TEXT } from "../../src/routes/ra-link-text.js";

const { MESSAGE, PAGE_TEXT: RESTART_PAGE_TEXT } = await import("../../src/security/drain.js");

/** Every string inside `value`, with where it sits. */
function strings(value, at = "") {
  if (typeof value === "string") return [[at, value]];
  if (Array.isArray(value)) return value.flatMap((v, i) => strings(v, `${at}[${i}]`));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => strings(v, `${at}.${k}`));
  return [];
}

function assertTexts(name, table) {
  for (const [at, text] of strings(table)) {
    assert.ok(text.trim(), `${name}${at} is empty`);
    assert.doesNotMatch(text, /[—–]/, `${name}${at} has a dash`);
  }
}

// Tables that claim every client language: exactly those twelve, none empty.
const FULL = {
  GENRE_LABELS: Object.values(GENRE_LABELS),
  SCORE_LABELS: Object.values(SCORE_LABELS),
  SWITCH_LABELS: Object.values(SWITCH_LABELS),
  RETRO_LABELS: Object.values(RETRO_LABELS),
  STYLE_NAMES: Object.values(STYLE_NAMES),
  REGIONS: Object.values(REGIONS),
  SORTS: SORTS.map(({ key: _k, ...labels }) => Object.fromEntries(Object.entries(labels).filter(([l]) => LANGS.includes(l)))),
  BEZEL_CREDIT: [BEZEL_CREDIT.text],
  "drain MESSAGE": [MESSAGE],
  "drain PAGE_TEXT": [RESTART_PAGE_TEXT],
  "saves SOURCE_LABEL": [SOURCE_LABEL],
  DROPBOX_PAGE_TEXT: [DROPBOX_PAGE_TEXT],
};

test("a label table that claims the client languages has exactly the twelve, and no empty text", () => {
  const want = [...LANGS].sort();
  for (const [name, tables] of Object.entries(FULL)) {
    for (const t of tables) {
      // A card label carries its tone, icon and order beside its text.
      const texts = Object.fromEntries(Object.entries(t).filter(([k]) => !["tone", "icon", "order"].includes(k)));
      assert.deepEqual(Object.keys(texts).sort(), want, `${name}: ${JSON.stringify(t).slice(0, 80)}`);
      assertTexts(name, texts);
    }
  }
});

// Tables that leave languages out on purpose (a client falls back to English, or traditional to simplified).
const PARTIAL = {
  "retro system names": Object.values(DEFAULT_SYSTEMS).map((s) => s.names),
  PAIR_TEXT: [PAIR_TEXT],
  RA_LINK_TEXT: [RA_LINK_TEXT],
};

test("a label table that leaves languages out still has English, and only client languages", () => {
  for (const [name, tables] of Object.entries(PARTIAL)) {
    for (const t of tables) {
      assert.ok(t.en, `${name}: no English in ${JSON.stringify(t).slice(0, 80)}`);
      for (const lang of Object.keys(t)) assert.ok(LANGS.includes(lang), `${name}: ${lang} is no client language`);
      assertTexts(name, t);
    }
  }
});

test("a sign-in page a phone opens shows simplified Chinese to a traditional reader, not English", async () => {
  const { devicePairPage } = await import("../../src/routes/device-pair-page.js");
  const { raLinkPage } = await import("../../src/routes/ra-link.js");
  const pair = devicePairPage({ view: "scan", lang: "zh-Hant" });
  assert.match(pair, /<html lang="zh">/);
  assert.ok(pair.includes(PAIR_TEXT.zh.title));
  assert.match(devicePairPage({ view: "scan", lang: "de" }), /<html lang="en">/, "a language the page lacks is English");
  const ra = raLinkPage("zh-Hant");
  assert.match(ra, /<html lang="zh">/);
  assert.ok(ra.includes(RA_LINK_TEXT.zh.title));
});
