import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { SHARE_LANGS, SHARE_TAGLINES, shareImagePath, shareTags } from "../../src/views/share-meta.js";
import { loginPage } from "../../src/routes/login-page.js";

test("the share card points at this server's absolute image", () => {
  const tags = shareTags("https://shop.example.org");
  assert.match(tags, /<meta property="og:image" content="https:\/\/shop\.example\.org\/assets\/og-image\.png">/);
  assert.match(tags, /<meta name="twitter:card" content="summary_large_image">/);
});

test("an origin that isn't plain is left out of the image URL", () => {
  assert.match(shareTags('https://x.example.org"><script>'), /content="\/assets\/og-image\.png"/);
  assert.match(shareTags(null), /content="\/assets\/og-image\.png"/);
});

test("each language gets its own image and words; anything else is English", () => {
  for (const lang of SHARE_LANGS) {
    const tags = shareTags("https://shop.example.org", lang);
    assert.ok(tags.includes(`og-image${lang === "en" ? "" : `-${lang}`}.png`), lang);
    assert.ok(tags.includes(SHARE_TAGLINES[lang]), lang);
    assert.ok(fs.existsSync(new URL(`../../src/views${shareImagePath(lang)}`, import.meta.url)), `${lang} image is in the repo`);
  }
  assert.equal(shareTags(null, "fr"), shareTags(null, "en"));
});

test("the sign-in page a shared link lands on carries the card in its language", () => {
  for (const passwords of [true, false]) {
    const html = loginPage({ origin: "https://shop.example.org", passwords, google: true, lang: "ja" });
    assert.match(html, /property="og:title" content="CookingFoil"/);
    assert.match(html, /og-image-ja\.png/);
  }
});
