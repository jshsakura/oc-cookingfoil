import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// GET /api/title/:baseTitleId surfaces the rich titledb detail (description,
// publisher, screenshots, banner) the shop response drops. Exercise the route
// handler directly against a warmed store fixture, with mock req/res, in a
// child process so COOK_DATA_DIR/module state stay isolated.

const PROBE = `
  import * as store from "../../src/meta/titledb-store.js";
  import route from "../../src/routes/title-detail.js";
  import * as art from "../../src/meta/custom-art.js";
  await store.load();
  await art.init();
  const mkRes = () => {
    const r = { code: 200, body: null, headers: {} };
    r.status = (c) => { r.code = c; return r; };
    r.json = (o) => { r.body = o; return r; };
    r.header = (k, v) => { r.headers[k] = v; return r; };
    return r;
  };
  const req = (id) => ({ params: { baseTitleId: id }, get: () => undefined, protocol: "http" });
  const call = (id) => { const res = mkRes(); route(req(id), res); return res; };

  const ok = call("0100000000ABC000");
  const bad = call("ZZZZ");
  const missing = call("0100000000FFF000");
  const artworkOnly = call("0100000000DDD000");
  process.stdout.write(JSON.stringify({
    okCode: ok.code, name: ok.body?.name, publisher: ok.body?.publisher,
    descLen: (ok.body?.description || "").length, shots: ok.body?.screenshotCount,
    shot0: ok.body?.screenshots?.[0], banner: ok.body?.bannerUrl,
    badCode: bad.code, missingCode: missing.code,
    screens: ok.body?.screenshots, artworkOnly,
    videos: ok.body?.videos, category: ok.body?.category, categories: ok.body?.categories,
    ratingContent: ok.body?.ratingContent,
    verified: [ok.body?.verified, ok.body?.verified_at, artworkOnly.body?.verified, artworkOnly.body?.verified_at],
  }));
`;

test("title-detail: serves rich metadata, 400 on bad id, 404 when unknown", () => {
  const data = mkdtempSync(path.join(tmpdir(), "cook-detail-"));
  mkdirSync(path.join(data, "titledb"), { recursive: true });
  mkdirSync(path.join(data, "custom-art"));
  // Marked tried on a console from an admin device (meta/item-verified.js).
  writeFileSync(path.join(data, "verified-items.json"), JSON.stringify({ "game:0100000000ABC000": Date.UTC(2026, 0, 2) }));
  for (const file of ["0100000000ABC000.screen.4.jpg", "0100000000DDD000.banner.jpg", "0100000000DDD000.screen.2.jpg"]) {
    writeFileSync(path.join(data, "custom-art", file), "indexed artwork fixture");
  }
  writeFileSync(
    path.join(data, "titledb", "US.en.json"),
    JSON.stringify({
      "70010000000001": {
        id: "0100000000ABC000",
        name: "Test Title",
        publisher: "OpenCourse",
        description: "A rich description that the shop response would drop.",
        releaseDate: 20240101,
        screenshots: ["https://cdn/a.jpg", "https://cdn/b.jpg"],
        bannerUrl: "https://cdn/banner.jpg",
        videos: ["https://youtu.be/abcdefghijk"],
        category: ["Adventure", "Action"],
        rating: 15,
        ratingContent: ["Violence", " ", "Violence", "Drugs"],
      },
    })
  );

  const out = execFileSync(process.execPath, ["--input-type=module", "-e", PROBE], {
    cwd: import.meta.dirname,
    env: { ...process.env, COOK_DATA_DIR: data, COOK_EXTRACT_ICONS: "off" },
    encoding: "utf-8",
  });
  const r = JSON.parse(out);

  assert.equal(r.okCode, 200);
  assert.deepEqual(r.verified, [true, "2026-01-02T00:00:00.000Z", false, null]);
  assert.equal(r.name, "Test Title");
  assert.equal(r.publisher, "OpenCourse");
  assert.ok(r.descLen > 10, "description surfaced");
  assert.equal(r.shots, 3);
  assert.deepEqual(r.ratingContent, ["Violence", "Drugs"], "rating reasons are trimmed and deduplicated");
  assert.deepEqual(r.videos, [{ type: "youtube", id: "abcdefghijk", title: "" }]);
  assert.ok(r.screens[2].includes("/4?"), "sparse custom screenshot indices stay intact");
  assert.equal(r.artworkOnly.code, 200);
  assert.equal(r.artworkOnly.body.name, null);
  assert.ok(r.artworkOnly.body.bannerUrl.includes("/0100000000DDD000?"));
  assert.ok(r.artworkOnly.body.screenshots[0].includes("/2?"));
  // screenshots/banner point at the proxy endpoints (relative — no origin in mock req)
  assert.equal(r.shot0, "/api/shop/screenshot/0100000000ABC000/0?v=" + r.shot0.split("v=")[1]);
  assert.ok(r.banner.startsWith("/api/shop/banner/0100000000ABC000"), "banner proxied");
  // The console client reads category as text; the array stays under categories
  // (same name the shop sections use) for the web dashboard.
  assert.equal(r.category, "Adventure, Action");
  assert.deepEqual(r.categories, ["Adventure", "Action"]);
  assert.equal(r.artworkOnly.body.category, null);
  assert.equal(r.badCode, 400);
  assert.equal(r.missingCode, 404);
});

test("title-detail: a name and description follow ?lang= through its fallbacks, never into the server's first language", () => {
  const data = mkdtempSync(path.join(tmpdir(), "cook-detail-lang-"));
  mkdirSync(path.join(data, "titledb"), { recursive: true });
  mkdirSync(path.join(data, "custom-art"));
  const region = (file, name, description) => writeFileSync(path.join(data, "titledb", file), JSON.stringify({
    "70010000000002": { id: "0100000000ABE000", name, description, releaseDate: 20240101 },
  }));
  region("KR.ko.json", "한국어 이름", "한국어 설명");
  region("US.en.json", "English Name", "English text");
  region("ES.es.json", "Nombre", "Texto");
  region("CN.zh.json", "简体名", "简体说明");
  region("HK.zh.json", "繁體名", "繁體說明");
  const probe = `
    import * as store from "../../src/meta/titledb-store.js";
    import route from "../../src/routes/title-detail.js";
    import * as art from "../../src/meta/custom-art.js";
    await store.load();
    await art.init();
    const call = (lang) => {
      const r = { code: 200, body: null, headers: {} };
      r.status = (c) => { r.code = c; return r; };
      r.json = (o) => { r.body = o; return r; };
      r.header = () => r;
      route({ params: { baseTitleId: "0100000000ABE000" }, query: lang ? { lang } : {}, get: () => undefined, protocol: "http" }, r);
      return [r.body.name, r.body.description];
    };
    process.stdout.write(JSON.stringify(Object.fromEntries(["es", "sv", "nl", "zh", "zh-Hant", "zh-TW", "ko", ""].map((l) => [l, call(l)]))));
  `;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", probe], {
    cwd: import.meta.dirname,
    env: { ...process.env, COOK_DATA_DIR: data, COOK_EXTRACT_ICONS: "off", COOK_LANG_PRIORITY: "ko,en,ja" },
    encoding: "utf-8",
  });
  const r = JSON.parse(out);
  assert.deepEqual(r.es, ["Nombre", "Texto"]);
  assert.deepEqual(r.sv, ["English Name", "English text"], "an unknown language is English");
  assert.deepEqual(r.nl, ["English Name", "English text"], "a language titledb lacks falls back to English, not Korean");
  assert.deepEqual(r.zh, ["简体名", "简体说明"]);
  assert.deepEqual(r["zh-Hant"], ["繁體名", "繁體說明"], "Hong Kong's titledb is traditional");
  assert.deepEqual(r["zh-TW"], ["繁體名", "繁體說明"]);
  assert.deepEqual(r.ko, ["한국어 이름", "한국어 설명"]);
  assert.equal(r[""][0], "한국어 이름", "without ?lang= the server's own order still decides");
});
