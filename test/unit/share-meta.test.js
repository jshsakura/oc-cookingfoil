import { test } from "node:test";
import assert from "node:assert/strict";
import { shareTags } from "../../src/views/share-meta.js";
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

test("the sign-in page a shared link lands on carries the card", () => {
  for (const passwords of [true, false]) {
    const html = loginPage({ origin: "https://shop.example.org", passwords, google: true });
    assert.match(html, /property="og:title" content="CookingFoil"/);
    assert.match(html, /og-image\.png/);
  }
});
