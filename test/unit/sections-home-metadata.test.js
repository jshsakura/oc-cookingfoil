import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

test("sections: recent timestamps and actual supported languages survive scan, cache, compression and origin rewriting", () => {
  const root = mkdtempSync(path.join(tmpdir(), "cook-home-metadata-"));
  const games = path.join(root, "games");
  const data = path.join(root, "data");
  const stamp = 1728000000;
  const base = "0100000000010000";
  try {
    mkdirSync(games);
    mkdirSync(path.join(data, "titledb"), { recursive: true });
    // An existing pre-upgrade slim file omitted languages. Loading must
    // recover them from its raw sibling on this boot, not the next fetch.
    writeFileSync(path.join(data, "titledb", "KR.ko.json"), JSON.stringify({
      a: { id: base, name: "한국어 이름", languages: ["ko", "en", "ko"] },
      b: { id: "0100000000020000", name: "한국어 이름만 있음" },
    }));
    writeFileSync(path.join(data, "titledb", "KR.ko.slim.json"), JSON.stringify({
      [base]: { id: base, name: "Old cache" },
    }));
    const names = [
      `Mario [${base}][v0].nsp`,
      "Mario Update [0100000000010800][v65536].nsz",
      "Mario DLC [0100000000010001][v0].nsp",
      "Other [0100000000020000][v0].nsp",
      "Homebrew.nro",
    ];
    for (const name of names) {
      const file = path.join(games, name);
      writeFileSync(file, "x");
      utimesSync(file, stamp, stamp);
    }
    const probe = `
      import assert from "node:assert/strict";
      import express from "express";
      import { get as httpGet } from "node:http";
      import { gunzipSync, brotliDecompressSync } from "node:zlib";
      import * as store from "../../src/meta/titledb-store.js";
      import * as cache from "../../src/meta/shop-cache.js";
      import { composeSections } from "../../src/create-index-content.js";
      import sectionsRoute from "../../src/routes/sections.js";
      await store.load();
      const results = [];
      for (const enc of [[], ["gzip"], ["br"]]) {
        const p = await cache.getSectionsEncodedForOrigin(enc, "https://shop.example.com");
        const buf = p.contentEncoding === "gzip" ? gunzipSync(p.body)
          : p.contentEncoding === "br" ? brotliDecompressSync(p.body) : p.body;
        results.push({ encoding: p.contentEncoding ?? null, etag: p.etag, body: JSON.parse(buf) });
      }
      const same = await cache.getSectionsEncodedForOrigin([], "https://shop.example.com");
      assert.equal(same.etag, results[0].etag);
      const app = express();
      app.get(["/api/shop/sections", "/api/remote/sections"], sectionsRoute);
      const server = await new Promise((resolve) => {
        const s = app.listen(0, "127.0.0.1", () => resolve(s));
      });
      try {
        const baseUrl = "http://127.0.0.1:" + server.address().port;
        for (const endpoint of ["/api/shop/sections", "/api/remote/sections"]) {
          const response = await fetch(baseUrl + endpoint, {
            headers: { "Accept-Encoding": "identity" }, signal: AbortSignal.timeout(5000),
          });
          assert.equal(response.status, 200);
          const actual = await response.json();
          assert.equal(actual.sections[0].items[0].added_at, 1728000000);
          assert.deepEqual(actual.sections[0].items.find((i) => i.title_id === "${base}").languages, ["ko", "en"]);
          // Fetch adds Cache-Control: no-cache for a conditional request.
          // Use plain HTTP to model curl's If-None-Match revalidation.
          const unchanged = await new Promise((resolve, reject) => {
            httpGet(baseUrl + endpoint, {
              headers: { "Accept-Encoding": "identity", "If-None-Match": response.headers.get("etag") },
              signal: AbortSignal.timeout(5000),
            }, (res) => {
              let body = "";
              res.setEncoding("utf8");
              res.on("data", (chunk) => { body += chunk; });
              res.on("end", () => resolve({ status: res.statusCode, body }));
              res.on("error", reject);
            }).on("error", reject);
          });
          assert.equal(unchanged.status, 304);
          assert.equal(unchanged.body, "");
        }
      } finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
      const unknown = composeSections(new Map([
        ["Untimed.nro", { url: "../Untimed.nro", name: "Untimed", size: 1 }],
        ["BadTime.nro", { url: "../BadTime.nro", name: "BadTime", mtime: "1728000000" }],
        ["Zero.nro", { url: "../Zero.nro", mtime: 0 }],
        ["Negative.nro", { url: "../Negative.nro", mtime: -1 }],
      ]), [
        { url: "https://example.com/custom.nsp", name: "Custom", added_at: 1728000000,
          languages: [" KO ", "en", "ko", null, ""] },
        { url: "https://example.com/unknown.nsp", name: "Unknown" },
      ]);
      process.stdout.write(JSON.stringify({ results, unknown }));
    `;
    const output = execFileSync(process.execPath, ["--input-type=module", "-e", probe], {
      cwd: import.meta.dirname,
      env: { ...process.env, COOK_GAMES_DIR: games, COOK_DATA_DIR: data, COOK_EXTRACT_ICONS: "off" },
      encoding: "utf-8",
      timeout: 10000,
    });
    const { results, unknown } = JSON.parse(output);
    assert.deepEqual(results.map((r) => r.encoding), [null, "gzip", "br"]);
    for (const { body, etag } of results) {
      assert.ok(etag);
      const items = body.sections[0].items;
      assert.equal(items.length, 5);
      assert.ok(items.every((item) => item.added_at === stamp));
      assert.ok(items.every((item) => item.url.startsWith("https://shop.example.com/")));
      for (const type of ["base", "update", "dlc"]) {
        const item = items.find((i) => i.base_title_id === base && i.app_type === type);
        assert.deepEqual(item.languages, ["ko", "en"]);
      }
      assert.equal(items.find((i) => i.title_id === "0100000000020000").languages, undefined);
      assert.equal(items.find((i) => i.name === "Homebrew").languages, undefined);
    }
    assert.deepEqual(results[0].body, results[1].body);
    assert.deepEqual(results[0].body, results[2].body);
    const extra = unknown.sections[0].items;
    assert.ok(extra.slice(0, 4).every((i) => i.added_at === undefined));
    assert.equal(extra[4].added_at, stamp);
    assert.deepEqual(extra[4].languages, ["ko", "en"]);
    assert.equal(extra[5].added_at, undefined);
    assert.equal(extra[5].languages, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
