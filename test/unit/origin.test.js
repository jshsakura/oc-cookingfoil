import { test } from "node:test";
import assert from "node:assert/strict";

import {
  resolveOrigin,
  rewriteArtworkOrigin,
  rewriteDownloadOrigin,
} from "../../src/helpers/origin.js";

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

test("resolveOrigin: honours X-Forwarded-Proto/Host first value from a trusted proxy", () => {
  const req = fakeReq({
    headers: {
      host: "internal:80",
      "x-forwarded-host": "shop.example.com, proxy.local",
      "x-forwarded-proto": "https, http",
    },
    protocol: "http",
  });
  assert.equal(resolveOrigin(req, null, { trusted: true }), "https://shop.example.com");
});

test("resolveOrigin: ignores X-Forwarded-Proto/Host from an untrusted peer", () => {
  const req = fakeReq({
    headers: { host: "shop.example.org", "x-forwarded-host": "evil.example.net", "x-forwarded-proto": "https" },
    protocol: "http",
  });
  assert.equal(resolveOrigin(req, null, { trusted: false }), "http://shop.example.org");
  // The default asks COOK_TRUST_PROXY (unset in tests) about the socket peer.
  req.socket = { remoteAddress: "203.0.113.9" };
  assert.equal(resolveOrigin(req, null), "http://shop.example.org");
});

test("trustsForwardedHeaders: decided by the socket peer against the trust rule", async () => {
  const { trustsForwardedHeaders } = await import("../../src/helpers/trust-proxy.js");
  const express = (await import("express")).default;
  const loopbackOnly = express().set("trust proxy", "loopback").get("trust proxy fn");
  assert.equal(trustsForwardedHeaders({ socket: { remoteAddress: "127.0.0.1" } }, loopbackOnly), true);
  assert.equal(trustsForwardedHeaders({ socket: { remoteAddress: "203.0.113.9" } }, loopbackOnly), false);
  assert.equal(trustsForwardedHeaders({}, loopbackOnly), false);
  // Unset COOK_TRUST_PROXY trusts nobody.
  assert.equal(trustsForwardedHeaders({ socket: { remoteAddress: "127.0.0.1" } }), false);
});

test("resolveOrigin: works on a raw upgrade request (headers object, no get())", () => {
  const raw = { headers: { host: "shop.example.org", "x-forwarded-host": "evil.example.net" }, socket: { remoteAddress: "203.0.113.9" } };
  assert.equal(resolveOrigin(raw, null), "http://shop.example.org");
  assert.equal(resolveOrigin({ ...raw, socket: { encrypted: true } }, null, { trusted: false }), "https://shop.example.org");
  assert.equal(resolveOrigin(raw, null, { trusted: true }), "http://evil.example.net");
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

test("rewriteDownloadOrigin: anchors only ../ download URLs at the origin", () => {
  const json = JSON.stringify({
    files: [
      { url: "../Armello%20%5B0100%5D.nsp", icon_url: "/api/shop/icon/0100?v=0.7" },
      { url: "../Sub%20Folder%2FGame.nsz" },
      { url: "https://fan.example.com/homebrew.nro" }, // custom entry — absolute
    ],
  });

  const out = JSON.parse(rewriteDownloadOrigin(json, "http://host:9080"));

  // ../ download URLs become absolute against the request origin…
  assert.equal(out.files[0].url, "http://host:9080/Armello%20%5B0100%5D.nsp");
  assert.equal(out.files[1].url, "http://host:9080/Sub%20Folder%2FGame.nsz");
  // …absolute custom URLs and non-download fields are left untouched.
  assert.equal(out.files[2].url, "https://fan.example.com/homebrew.nro");
  assert.equal(out.files[0].icon_url, "/api/shop/icon/0100?v=0.7");
});

test("rewriteDownloadOrigin: empty origin is a no-op", () => {
  const json = '{"url":"../game.nsp"}';
  assert.equal(rewriteDownloadOrigin(json, ""), json);
});
