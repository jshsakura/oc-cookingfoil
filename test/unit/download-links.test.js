import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import http from "node:http";
import path from "node:path";

// The download-only address: lists hand out signed, expiring file links on it,
// and that address serves those files and nothing else.
const dir = mkdtempSync(path.join(tmpdir(), "cook-dl-"));
const games = path.join(dir, "games");
mkdirSync(path.join(games, "Game"), { recursive: true });
writeFileSync(path.join(games, "Game", "file [0100000000010000][v0].nsp"), "NSPDATA");
writeFileSync(path.join(games, "notes.txt"), "hello");
process.env.COOK_DATA_DIR = dir;
process.env.COOK_DOWNLOAD_BASE_URL = "";
const express = (await import("express")).default;
const env = await import("../../src/helpers/envs.js");
const settings = await import("../../src/security/server-settings.js");
const links = await import("../../src/security/download-links.js");
const { default: downloadHost, LINK_HEADER } = await import("../../src/security/download-host.js");

const ENC = encodeURIComponent("Game/file [0100000000010000][v0].nsp");
const servers = [];
after(() => { for (const s of servers) { s.closeAllConnections?.(); s.close(); } });

async function start() {
  const app = express();
  app.use(downloadHost(games));
  app.use((req, res) => res.status(200).send("main"));
  const server = http.createServer(app);
  servers.push(server);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return server.address().port;
}

function get(port, urlPath, host, method = "GET") {
  return new Promise((resolve, reject) => {
    const req = http.request({ port, path: urlPath, method, headers: { host } }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("with no download address the lists keep the shop's own links", () => {
  settings.save({ downloadBaseUrl: null });
  assert.equal(links.current(), null);
  assert.equal(links.downloadHost(), "");
});

test("expiries are rounded to a quarter of the lifetime and never shorter than it", () => {
  const ttl = 43200;
  const now = 1_800_000_123;
  const exp = links.expiryFor(now, ttl);
  assert.ok(exp - now >= ttl);
  assert.ok(exp - now < ttl + ttl / 4);
  assert.equal(exp % (ttl / 4), 0);
  assert.equal(links.expiryFor(now + 5, ttl), exp);
});

test("a saved download address signs every relative file URL and leaves the rest", () => {
  settings.save({ downloadBaseUrl: "https://dl.example.org:38443/", downloadLinkTtl: "3600" });
  assert.equal(env.downloadBaseUrl, "https://dl.example.org:38443");
  assert.equal(env.downloadLinkTtl, 3600);
  const link = links.current();
  const json = JSON.stringify({ files: [{ url: `../${ENC}` }], icon: "/api/shop/icon/x", ext: "https://cdn.example/a.nsp" });
  const out = JSON.parse(links.rewriteSigned(json, link));
  const url = new URL(out.files[0].url);
  assert.equal(url.host, "dl.example.org:38443");
  assert.equal(url.pathname, `/${ENC}`);
  assert.equal(url.searchParams.get("exp"), String(link.exp));
  assert.equal(url.searchParams.get("sig").length, 22);
  assert.equal(out.icon, "/api/shop/icon/x");
  assert.equal(out.ext, "https://cdn.example/a.nsp");
});

test("a download address with a path is refused", () => {
  assert.throws(() => settings.save({ downloadBaseUrl: "https://dl.example.org/files" }), /downloadBaseUrl/);
  assert.throws(() => settings.save({ downloadBaseUrl: "https://dl.example.org/?a=1" }), /downloadBaseUrl/);
  assert.equal(env.downloadBaseUrl, "https://dl.example.org:38443");
});

test("a signature covers the path and the expiry", () => {
  const exp = String(Math.floor(Date.now() / 1000) + 600);
  const sig = new URL(links.signedUrl("https://d", ENC, exp)).searchParams.get("sig");
  assert.equal(links.verify(`/${ENC}`, exp, sig), "ok");
  assert.equal(links.verify(`/${encodeURIComponent("Game/other.nsp")}`, exp, sig), "bad");
  assert.equal(links.verify(`/${ENC}`, String(Number(exp) + 1), sig), "bad");
  assert.equal(links.verify(`/${ENC}`, exp, undefined), "bad");
  assert.equal(links.verify(`/${ENC}`, [exp], sig), "bad");
  assert.equal(links.verify(`/${ENC}`, exp, sig, (Number(exp) + 1) * 1000), "expired");
});

test("the key is kept private and survives a reload", () => {
  const exp = "2000000000";
  const before = links.signedUrl("https://d", ENC, exp);
  links.resetKeyForTests();
  assert.equal(links.signedUrl("https://d", ENC, exp), before);
  assert.equal(statSync(path.join(dir, "security", "download-link.key")).mode & 0o777, 0o600);
});

test("a broken key file keeps the shop's own links instead of replacing the key", () => {
  const keyFile = path.join(dir, "security", "download-link.key");
  const good = readFileSync(keyFile);
  writeFileSync(keyFile, "short");
  links.resetKeyForTests();
  assert.equal(links.current(), null);
  assert.equal(readFileSync(keyFile, "utf8"), "short");
  writeFileSync(keyFile, good);
  links.resetKeyForTests();
  assert.ok(links.current());
});

test("the download address serves a signed file and refuses everything else", async () => {
  settings.save({ downloadBaseUrl: "https://dl.example.org:38443", downloadLinkTtl: "3600" });
  const port = await start();
  const host = "dl.example.org:38443";
  const signed = new URL(links.signedUrl(env.downloadBaseUrl, ENC, links.current().exp));
  const good = signed.pathname + signed.search;

  const ok = await get(port, good, host);
  assert.equal(ok.status, 200);
  assert.equal(ok.body, "NSPDATA");
  assert.equal(ok.headers["x-cookingfoil-max-connections"], String(env.downloadMaxConnections));

  assert.equal((await get(port, good, host, "HEAD")).status, 200);
  assert.equal((await get(port, good, host, "POST")).status, 405);
  assert.equal((await get(port, `/${ENC}`, host)).status, 403);
  assert.equal((await get(port, "/", host)).status, 404);
  assert.equal((await get(port, "/api/shop/sections", host)).status, 404);
  assert.equal((await get(port, "/notes.txt", host)).status, 404);

  const stale = new URL(links.signedUrl(env.downloadBaseUrl, ENC, "1000"));
  const expired = await get(port, stale.pathname + stale.search, host);
  assert.equal(expired.status, 403);
  assert.equal(expired.headers[LINK_HEADER.toLowerCase()], "expired");

  const missing = new URL(links.signedUrl(env.downloadBaseUrl, encodeURIComponent("Game/gone.nsp"), links.current().exp));
  assert.equal((await get(port, missing.pathname + missing.search, host)).status, 404);

  // The shop's own address is untouched.
  assert.equal((await get(port, "/", "shop.example.org")).body, "main");
});
