import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveOrigin, rewriteArtworkOrigin } from "../../src/helpers/origin.js";

// Minimal Express-req stand-in: get() is case-insensitive like the real one.
function fakeReq({ headers = {}, protocol = "http" } = {}) {
  const lower = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return { protocol, get: (name) => lower[String(name).toLowerCase()] };
}

test("resolveOrigin: pinned base URL wins over headers", () => {
  const req = fakeReq({ headers: { host: "ignored:1" }, protocol: "https" });
  assert.equal(resolveOrigin(req, "http://pinned:9080"), "http://pinned:9080");
});

test("resolveOrigin: derives from Host + protocol on direct connection", () => {
  const req = fakeReq({ headers: { host: "192.168.1.50:9080" }, protocol: "http" });
  assert.equal(resolveOrigin(req, null), "http://192.168.1.50:9080");
});

test("resolveOrigin: honours X-Forwarded-Proto/Host first value", () => {
  const req = fakeReq({
    headers: {
      host: "internal:80",
      "x-forwarded-host": "shop.example.com, proxy.local",
      "x-forwarded-proto": "https, http",
    },
    protocol: "http",
  });
  assert.equal(resolveOrigin(req, null), "https://shop.example.com");
});

test("resolveOrigin: returns empty string when no host is known", () => {
  const req = fakeReq({ headers: {}, protocol: "http" });
  assert.equal(resolveOrigin(req, null), "");
});

test("rewriteArtworkOrigin: prefixes only our proxy endpoints", () => {
  const json = JSON.stringify({
    files: [
      { url: "../%5B0100%5D.nsz", icon_url: "/api/shop/icon/0100ABC?v=0.7" },
      { url: "../x.nsp", icon_url: "https://cdn.example.com/x.png" },
    ],
    titledb: {
      "0100ABC": {
        iconUrl: "/api/shop/icon/0100ABC?v=0.7",
        bannerUrl: "/api/shop/banner/0100ABC?v=0.7",
        screenshots: ["/api/shop/screenshot/0100ABC/0?v=0.7"],
      },
    },
  });

  const out = JSON.parse(rewriteArtworkOrigin(json, "http://host:9080"));

  // Our endpoints become absolute…
  assert.equal(out.files[0].icon_url, "http://host:9080/api/shop/icon/0100ABC?v=0.7");
  assert.equal(out.titledb["0100ABC"].iconUrl, "http://host:9080/api/shop/icon/0100ABC?v=0.7");
  assert.equal(out.titledb["0100ABC"].bannerUrl, "http://host:9080/api/shop/banner/0100ABC?v=0.7");
  assert.equal(out.titledb["0100ABC"].screenshots[0], "http://host:9080/api/shop/screenshot/0100ABC/0?v=0.7");
  // …while download URLs and external icon URLs are left untouched.
  assert.equal(out.files[0].url, "../%5B0100%5D.nsz");
  assert.equal(out.files[1].icon_url, "https://cdn.example.com/x.png");
});

test("rewriteArtworkOrigin: empty origin is a no-op", () => {
  const json = '{"icon_url":"/api/shop/icon/X"}';
  assert.equal(rewriteArtworkOrigin(json, ""), json);
});
