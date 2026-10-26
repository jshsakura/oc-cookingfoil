import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Picking one picture per slot: candidates from SteamGridDB and IGDB, and the
// picked picture fetched only from those sources' own image hosts.
process.env.COOK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "art-search-"));
const search = await import("../../src/meta/art-search.js");

const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

function fakeSgdb() {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (url.includes("/search/autocomplete/")) return json({ data: [{ id: 11, name: "Hades" }, { id: 12, name: "Hades II" }, { id: 13, name: "Third" }] });
    if (url.includes("/grids/game/")) return json({ data: [{ url: "https://cdn2.steamgriddb.com/grid/a.png", thumb: "https://cdn2.steamgriddb.com/thumb/a.png" }] });
    if (url.includes("/heroes/game/")) return json({ data: [{ url: "https://cdn2.steamgriddb.com/hero/b.png", thumb: "https://cdn2.steamgriddb.com/thumb/b.png" }, { url: "https://evil.example.com/x.png" }] });
    return new Response("", { status: 404 });
  };
  return { calls, fetchImpl };
}

test("only https addresses on the sources' own image hosts can be picked", () => {
  for (const ok of ["https://cdn2.steamgriddb.com/grid/a.png", "https://images.igdb.com/igdb/image/upload/t_1080p/x.jpg"]) {
    assert.equal(search.allowedImageUrl(ok), true, ok);
  }
  for (const bad of ["https://img-eshop.cdn.nintendo.net/i/a.jpg", "http://cdn2.steamgriddb.com/a.png", "https://steamgriddb.com.example.com/a.png", "https://example.com/a.png", "file:///etc/passwd", "not a url"]) {
    assert.equal(search.allowedImageUrl(bad), false, bad);
  }
});

test("SteamGridDB gives square grids for the icon and heroes for the banner, from the first two games", async () => {
  const web = fakeSgdb();
  const icons = await search.sgdbCandidates("icon", "Hades", "k", { fetchImpl: web.fetchImpl });
  assert.equal(icons.length, 2);
  assert.ok(web.calls.some((u) => u.includes("/grids/game/11?dimensions=512x512")));
  assert.ok(!web.calls.some((u) => u.includes("/game/13")));
  assert.deepEqual(icons[0], { source: "sgdb", game: { id: 11, name: "Hades" }, label: "", thumb: "https://cdn2.steamgriddb.com/thumb/a.png", url: "https://cdn2.steamgriddb.com/grid/a.png" });

  const banners = await search.sgdbCandidates("banner", "Hades", "k", { fetchImpl: fakeSgdb().fetchImpl });
  assert.deepEqual(banners.map((c) => c.url), ["https://cdn2.steamgriddb.com/hero/b.png", "https://cdn2.steamgriddb.com/hero/b.png"]);
  assert.deepEqual(await search.sgdbCandidates("screenshot", "Hades", "k", { fetchImpl: web.fetchImpl }), []);
});

test("IGDB gives the cover for the icon, artworks then screenshots for the banner, screenshots for screenshots", async () => {
  const games = [{ id: 5, name: "Hades", cover: { image_id: "co1" }, artworks: [{ image_id: "ar1" }], screenshots: [{ image_id: "sc1" }, { image_id: "sc2" }] }];
  const opts = { ready: () => true, query: async () => games };
  assert.deepEqual((await search.igdbCandidates("icon", "Hades", opts)).map((c) => c.url), ["https://images.igdb.com/igdb/image/upload/t_1080p/co1.jpg"]);
  assert.deepEqual((await search.igdbCandidates("banner", "Hades", opts)).map((c) => c.url.split("/").pop()), ["ar1.jpg", "sc1.jpg", "sc2.jpg"]);
  const shots = await search.igdbCandidates("screenshot", "Hades", opts);
  assert.deepEqual(shots.map((c) => c.thumb.split("/").slice(-2).join("/")), ["t_screenshot_med/sc1.jpg", "t_screenshot_med/sc2.jpg"]);
});

test("a source without its key is named as missing, a failing one as an error, and the rest still come back", async () => {
  const none = await search.searchArt({ slot: "icon", q: "Hades" }, { sgdbKey: "", igdbReady: () => false });
  assert.deepEqual(none, { q: "Hades", items: [], errors: [], missing: ["sgdb", "igdb"] });

  const broken = async () => new Response("", { status: 500 });
  const mixed = await search.searchArt({ slot: "icon", q: "Hades" }, {
    fetchImpl: broken, sgdbKey: "k", igdbReady: () => true, igdbQuery: async () => [{ id: 5, name: "Hades", cover: { image_id: "co1" } }],
  });
  assert.deepEqual(mixed.errors, ["sgdb"]);
  assert.deepEqual(mixed.items.map((c) => c.source), ["igdb"]);
});

test("a retro game's box art: libretro covers lead, then SteamGridDB box covers and the IGDB cover", async () => {
  const libretro = "https://raw.githubusercontent.com/libretro-thumbnails/Sega_-_Mega_Drive_-_Genesis/master/Named_Boxarts/Shinobi.png";
  assert.equal(search.allowedImageUrl(libretro), true);
  // Only libretro-thumbnails on GitHub's raw host, nothing else served there.
  assert.equal(search.allowedImageUrl("https://raw.githubusercontent.com/someone/else/main/a.png"), false);
  const web = fakeSgdb();
  const r = await search.searchArt({ slot: "boxart", q: "Shinobi", first: [
    { source: "libretro", game: null, label: "Shinobi", thumb: libretro, url: libretro },
    { source: "libretro", game: null, label: "x", thumb: "https://example.com/x.png", url: "https://example.com/x.png" },
  ] }, { fetchImpl: web.fetchImpl, sgdbKey: "k", igdbReady: () => true, igdbQuery: async () => [{ id: 5, name: "Shinobi", cover: { image_id: "co1" } }] });
  assert.deepEqual(r.items.map((c) => c.source), ["libretro", "sgdb", "sgdb", "igdb"]);
  assert.ok(web.calls.some((u) => u.includes("/grids/game/11?dimensions=600x900")));
  assert.equal(r.items.at(-1).thumb, "https://images.igdb.com/igdb/image/upload/t_cover_big/co1.jpg");
});

test("a picked picture is fetched from an allowed host only, redirects included, and must be an image", async () => {
  const ok = await search.remoteImage("https://cdn2.steamgriddb.com/a.jpg", { fetchImpl: async () => new Response(JPEG) });
  assert.equal(ok.type, "image/jpeg");
  assert.equal(ok.body.length, JPEG.length);

  await assert.rejects(search.remoteImage("https://example.com/a.jpg", { fetchImpl: async () => new Response(JPEG) }));
  const bounce = async () => new Response(null, { status: 302, headers: { location: "https://example.com/inside" } });
  await assert.rejects(search.remoteImage("https://cdn2.steamgriddb.com/a.jpg", { fetchImpl: bounce }));
  await assert.rejects(search.remoteImage("https://cdn2.steamgriddb.com/a.jpg", { fetchImpl: async () => new Response("<html>") }), /그림 파일이 아닙니다/);
  const huge = async () => new Response(JPEG, { headers: { "content-length": String(search.MAX_IMAGE_BYTES + 1) } });
  await assert.rejects(search.remoteImage("https://cdn2.steamgriddb.com/a.jpg", { fetchImpl: huge }), /15 MB/);
});
