import test from "node:test";
import assert from "node:assert/strict";

import { gatePage } from "../../src/routes/admin/gate-page.js";
import { pairPage } from "../../src/routes/admin/pair-page.js";
import { enrollPage } from "../../src/routes/admin/enroll-page.js";
import { guidePage } from "../../src/routes/admin/guide-page.js";
import { TOP_I18N_SCRIPT, topScript } from "../../src/routes/admin/top-i18n.js";

const MAX_BYTES = 64 * 1024;
const pages = {
  gate: () => gatePage({ mode: "either" }),
  pair: () => pairPage({ code: "ABCD-1234", authenticated: true }),
  enroll: () => enrollPage({ secret: "AAAAAAAAAAAAAAAA", uri: "otpauth://totp/x?secret=AAAA" }),
  guide: () => guidePage("# Guide\n\nText"),
};

// The words a page ships: the topWords literal the script embeds.
const embedded = (html) => {
  const m = /const topWords=(\{.*\});\n/.exec(html);
  assert.ok(m, "the page embeds its dictionary");
  return JSON.parse(m[1]);
};

for (const [name, render] of Object.entries(pages)) {
  test(`${name} page stays small, not the whole dictionary`, () => {
    assert.ok(Buffer.byteLength(render()) <= MAX_BYTES, `${name} page is over ${MAX_BYTES} bytes`);
  });

  test(`${name} page carries every key it asks for in every language`, () => {
    const html = render();
    const words = embedded(html);
    const asked = new Set([...html.matchAll(/data-top(?:-ph|-label)?="([^"]+)"/g)].map((m) => m[1]));
    for (const m of html.matchAll(/topText\('([^']+)'/g)) asked.add(m[1]);
    assert.ok(asked.size > 0);
    for (const lang of Object.keys(words)) {
      for (const key of asked) assert.ok(words[lang][key] !== undefined, `${name}: ${lang} lacks ${key}`);
    }
  });
}

test("the admin shell script still carries every key", () => {
  const full = embedded(TOP_I18N_SCRIPT);
  assert.ok(Object.keys(full.en).length > 1000);
  assert.ok(full.en["ov.w.buildT"]);
});

test("a prefix list keeps the script's own keys and drops the rest", () => {
  const words = embedded(topScript(["gd."]));
  assert.ok(words.ko.title && words.ko.loading && words.ko.language);
  assert.ok(words.ko["gd.back"]);
  assert.equal(words.ko["gt.h1"], undefined);
});

test("language switching does not throw when no activity menu exists", () => {
  assert.match(TOP_I18N_SCRIPT, /typeof activityMenu!=='undefined'\)activityMenu\.relabel\(\)/);
});
