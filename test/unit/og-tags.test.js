import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

import { pageForOrigin } from "../../src/routes/landing.js";

const root = path.join(import.meta.dirname, "../..");
const html = readFileSync(path.join(root, "src/views/landing.html"), "utf-8");
const site = readFileSync(path.join(root, "site/index.html"), "utf-8");
const meta = (page, attr, name) => page.match(new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`))?.[1];

test("the web page carries the share tags with the large image card", () => {
  for (const name of ["og:title", "og:description", "og:image", "og:type"]) assert.ok(meta(html, "property", name), name);
  assert.equal(meta(html, "name", "twitter:card"), "summary_large_image");
  assert.equal(meta(html, "property", "og:image"), "__ORIGIN__/assets/og-image.png");
});

test("the share image URL is made absolute with the server's address", () => {
  const page = pageForOrigin(html, "https://shop.example.com");
  assert.equal(meta(page, "property", "og:image"), "https://shop.example.com/assets/og-image.png");
  assert.equal(meta(page, "name", "twitter:image"), "https://shop.example.com/assets/og-image.png");
  assert.ok(!page.includes("__ORIGIN__"));
});

test("an odd Host header leaves the share image root-relative instead of entering the page", () => {
  for (const origin of ['http://evil"><script>', "javascript:alert(1)", "", null]) {
    assert.equal(meta(pageForOrigin(html, origin), "property", "og:image"), "/assets/og-image.png");
  }
  assert.equal(meta(pageForOrigin(html, "http://[::1]:3188"), "property", "og:image"), "http://[::1]:3188/assets/og-image.png");
});

test("the public site points at its own copy of the share image", () => {
  assert.equal(meta(site, "name", "twitter:card"), "summary_large_image");
  assert.match(meta(site, "property", "og:image"), /^https:\/\/.+\/og-image\.png$/);
  for (const file of ["site/og-image.png", "src/views/assets/og-image.png"]) {
    const size = statSync(path.join(root, file)).size;
    assert.ok(size > 0 && size < 300_000, `${file} is ${size} bytes`);
  }
});
