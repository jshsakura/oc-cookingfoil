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
  // Marked tried on a console from an admin device (meta/item-verified.js).
  writeFileSync(path.join(data, "verified-items.json"), JSON.stringify({ "game:0100000000ABC000": Date.UTC(2026, 0, 2) }));
  // The admin's pictures, in each game's folder: screenshot-05 is index 4.
  for (const file of ["Test Title [0100000000ABC000]/screenshot-05.webp", "Game [0100000000DDD000]/banner.webp", "Game [0100000000DDD000]/screenshot-03.webp"]) {
    mkdirSync(path.dirname(path.join(data, "metadata", "games", file)), { recursive: true });
    writeFileSync(path.join(data, "metadata", "games", file), "indexed artwork fixture");
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
  const region = (file, name, description, iconUrl) => writeFileSync(path.join(data, "titledb", file), JSON.stringify({
    "70010000000002": { id: "0100000000ABE000", name, description, releaseDate: 20240101, iconUrl },
  }));
  // Korean and Hong Kong's box art is the default one; English and simplified Chinese have their own.
  region("KR.ko.json", "한국어 이름", "한국어 설명", "https://img.example/default.jpg");
  region("US.en.json", "English Name", "English text", "https://img.example/en.jpg");
  region("ES.es.json", "Nombre", "Texto", "https://img.example/en.jpg");
  region("DE.de.json", "Name auf Deutsch", "Deutscher Text", "https://img.example/en.jpg");
  region("CN.zh.json", "简体名", "简体说明", "https://img.example/zh.jpg");
  region("HK.zh.json", "繁體名", "繁體說明", "https://img.example/default.jpg");
  writeFileSync(path.join(data, "game-descriptions.json"), JSON.stringify({ "0100000000ABE000": { name: { ko: "관리자 이름" }, description: { ko: "관리자 설명" } } }));
  const probe = `
    import * as store from "../../src/meta/titledb-store.js";
    import route from "../../src/routes/title-detail.js";
    import * as art from "../../src/meta/custom-art.js";
    await store.load();
    await art.init();
    const call = (lang, header) => {
      const r = { code: 200, body: null, headers: {} };
      r.status = (c) => { r.code = c; return r; };
      r.json = (o) => { r.body = o; return r; };
      r.header = () => r;
      route({ params: { baseTitleId: "0100000000ABE000" }, query: lang ? { lang } : {}, get: (h) => (h === "accept-language" ? header : undefined), protocol: "http" }, r);
      const art = new URL(r.body.iconUrl, "http://x").searchParams.get("lang");
      return [r.body.name, r.body.description, art];
    };
    const out = Object.fromEntries(["es", "de", "sv", "nl", "zh", "zh-Hant", "zh-TW", "ko", ""].map((l) => [l, call(l)]));
    out.headerEs = call("", "es-ES,es;q=0.9");
    out.headerSv = call("", "sv-SE");
    process.stdout.write(JSON.stringify(out));
  `;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", probe], {
    cwd: import.meta.dirname,
    env: { ...process.env, COOK_DATA_DIR: data, COOK_EXTRACT_ICONS: "off", COOK_LANG_PRIORITY: "ko,en,ja" },
    encoding: "utf-8",
  });
  const r = JSON.parse(out);
  assert.deepEqual(r.es, ["Nombre", "Texto", "es"], "the admin's Korean text does not beat titledb's Spanish");
  assert.deepEqual(r.de, ["Name auf Deutsch", "Deutscher Text", "de"], "Germany's text for a German reader");
  assert.deepEqual(r.sv, ["English Name", "English text", "en"], "an unknown language is English");
  assert.deepEqual(r.nl, ["English Name", "English text", "en"], "a language titledb lacks falls back to English, not Korean");
  assert.deepEqual(r.zh, ["简体名", "简体说明", "zh"]);
  assert.deepEqual(r["zh-Hant"], ["繁體名", "繁體說明", null], "Hong Kong's text is traditional, and its art the default one, not simplified's");
  assert.deepEqual(r["zh-TW"], ["繁體名", "繁體說明", null]);
  assert.deepEqual(r.ko, ["관리자 이름", "관리자 설명", null], "the admin's own Korean for a Korean reader; Korean art is the default");
  assert.deepEqual(r.headerEs, ["Nombre", "Texto", "es"], "Accept-Language counts as asking");
  assert.deepEqual(r.headerSv, ["English Name", "English text", "en"]);
  assert.equal(r[""][0], "관리자 이름", "without a language the server's own order still decides");
});

// One probe per data folder: titledb regions and admin game folders in, { lang: [name, description] } out.
function detailIn({ regions, games = {}, langs }) {
  const data = mkdtempSync(path.join(tmpdir(), "cook-detail-own-"));
  mkdirSync(path.join(data, "titledb"), { recursive: true });
  for (const [file, rows] of Object.entries(regions)) writeFileSync(path.join(data, "titledb", file), JSON.stringify(rows));
  for (const [folder, json] of Object.entries(games)) {
    mkdirSync(path.join(data, "metadata", "games", folder), { recursive: true });
    writeFileSync(path.join(data, "metadata", "games", folder, "game.json"), JSON.stringify(json));
  }
  const probe = `
    import * as store from "../../src/meta/titledb-store.js";
    import route from "../../src/routes/title-detail.js";
    import * as art from "../../src/meta/custom-art.js";
    import { scan } from "../../src/meta/game-meta.js";
    await store.load();
    await art.init();
    await scan();
    const call = (id, lang) => {
      const r = { code: 200, body: null };
      r.status = (c) => { r.code = c; return r; };
      r.json = (o) => { r.body = o; return r; };
      r.header = () => r;
      route({ params: { baseTitleId: id }, query: { lang }, get: () => undefined, protocol: "http" }, r);
      return [r.body?.name ?? null, r.body?.description ?? null];
    };
    const out = {};
    for (const [id, list] of Object.entries(${JSON.stringify(langs)})) for (const l of list) out[id + ":" + l] = call(id, l);
    process.stdout.write(JSON.stringify(out));
  `;
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", probe], {
    cwd: import.meta.dirname,
    env: { ...process.env, COOK_DATA_DIR: data, COOK_EXTRACT_ICONS: "off", COOK_LANG_PRIORITY: "ko,en,ja" },
    encoding: "utf-8",
  }));
}

test("title-detail: simplified and traditional Chinese never stand in for each other", () => {
  const row = (name, description) => ({ "70010000000003": { id: "0100000000AC4000", name, description, releaseDate: 20240101 } });
  const r = detailIn({
    regions: { "US.en.json": row("English Name", "English text"), "HK.zh.json": row("繁體名", "繁體說明") },
    langs: { "0100000000AC4000": ["zh", "zh-Hant"] },
  });
  assert.deepEqual(r["0100000000AC4000:zh"], ["English Name", "English text"], "Hong Kong's text is not shown to a simplified reader");
  assert.deepEqual(r["0100000000AC4000:zh-Hant"], ["繁體名", "繁體說明"]);
});

test("title-detail: the admin's name per language, then their name for every language, then titledb's, then English", () => {
  const A = "0100000000AC0000";
  const B = "0100000000AC2000";
  const row = (id, name, description) => ({ [id === A ? "70010000000010" : "70010000000011"]: { id, name, description, releaseDate: 20240101 } });
  const r = detailIn({
    regions: {
      "US.en.json": { ...row(A, "English Name", "English text"), ...row(B, "B English", "B text") },
      "DE.de.json": { ...row(A, "Deutscher Name", "Deutscher Text"), ...row(B, "B Deutsch", "B Text de") },
    },
    games: {
      [`Own [${A}]`]: { id: A, name: { ja: "管理者の名前", "zh-Hant": "管理員名稱", en: "Admin English" }, description: { en: "Admin text" } },
      [`All [${B}]`]: { id: B, name: "One Name For All" },
    },
    langs: { [A]: ["ja", "zh-Hant", "de", "nl", "zh"], [B]: ["ko", "de", "zh-Hant"] },
  });
  assert.deepEqual(r[`${A}:ja`], ["管理者の名前", "Admin text"], "the admin's Japanese name; the admin's English text beats titledb's English");
  assert.deepEqual(r[`${A}:zh-Hant`], ["管理員名稱", "Admin text"]);
  assert.deepEqual(r[`${A}:de`], ["Deutscher Name", "Deutscher Text"], "titledb's German beats the admin's English");
  assert.deepEqual(r[`${A}:nl`], ["Admin English", "Admin text"], "no Dutch anywhere: the admin's English");
  assert.deepEqual(r[`${A}:zh`], ["Admin English", "Admin text"], "the traditional name is not the simplified one");
  for (const l of ["ko", "de", "zh-Hant"]) assert.equal(r[`${B}:${l}`][0], "One Name For All", `a plain name is every language's (${l})`);
});
