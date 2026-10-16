import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

// A homebrew app's pictures, laid out as a game's: ports get a banner from
// SteamGridDB and screenshots from IGDB on their own; tools only get what the
// admin uploads; what the admin removed stays removed.
process.env.COOK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hb-media-"));
process.env.COOK_IGDB_CLIENT_ID = "testclient1";
process.env.COOK_IGDB_CLIENT_SECRET = "testsecret1";
const media = await import("../../src/meta/homebrew-media.js");

const PORT = { id: "m-0123456789ab", name: "롤러코스터 타이쿤 2 (OpenRCT2)", kind: "port", file_name: "openrct2.nro" };
const TOOL = { id: "m-ba9876543210", name: "Tool", kind: "tool", file_name: "tool.nro" };
const KEY = "k".repeat(32);
const img = (w, h, r = 200) => sharp({ create: { width: w, height: h, channels: 3, background: { r, g: 40, b: 40 } } }).png().toBuffer();
const wide = await img(1920, 620);
const shot = await img(1920, 1080, 90);

beforeEach(() => {
  fs.rmSync(path.join(process.env.COOK_DATA_DIR, "homebrew"), { recursive: true, force: true });
  media.resetForTests();
});

/** SteamGridDB, IGDB and their image hosts, knowing `known` names; every call is recorded. */
function fakeWeb({ sgdb = { openrct2: 1 }, igdbShots = 3 } = {}) {
  const calls = [];
  const json = (body) => ({ ok: true, json: async () => body, text: async () => JSON.stringify(body) });
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    calls.push(u);
    const search = u.match(/search\/autocomplete\/(.+)$/);
    if (search) {
      const id = sgdb[decodeURIComponent(search[1]).toLowerCase()];
      return json({ data: id ? [{ id, name: "RollerCoaster Tycoon 2" }] : [] });
    }
    if (/heroes\/game\/1\?/.test(u)) return json({ data: [{ url: "https://cdn2.steamgriddb.com/hero/a.png", thumb: "https://cdn2.steamgriddb.com/hero_thumb/a.jpg" }] });
    if (/heroes\/game\//.test(u)) return json({ data: [] });
    if (u.startsWith("https://cdn2.steamgriddb.com/")) return { ok: true, arrayBuffer: async () => wide };
    if (u.startsWith("https://id.twitch.tv/")) return json({ access_token: "t", expires_in: 3600 });
    if (u === "https://api.igdb.com/v4/games") {
      const asked = String(init.body).match(/search "([^"]+)"/)?.[1];
      calls.push(`igdb:${asked}`);
      return json(asked === "RollerCoaster Tycoon 2" && igdbShots ? [{ id: 7, name: asked, screenshots: Array.from({ length: igdbShots }, (_, i) => ({ image_id: `abc${i}` })) }] : []);
    }
    if (u.startsWith("https://images.igdb.com/")) return { ok: true, arrayBuffer: async () => shot };
    return { ok: false, status: 404 };
  };
  return { fetchImpl, calls };
}

test("a port is looked up by the Latin name in its brackets first", () => {
  assert.deepEqual(media.searchNames(PORT), ["OpenRCT2"], "the Korean title and the same name in lower case are not asked again");
  assert.deepEqual(media.searchNames({ name: "Cave Story+", file_name: "cavestory-v1.2.nro" }), ["Cave Story+", "cavestory"]);
  assert.deepEqual(media.searchNames({ name: "젤다", repo_url: "https://github.com/a/zelda-port" }), ["zelda-port"]);
});

test("a port gets a banner from SteamGridDB and screenshots from IGDB under SteamGridDB's name; tools get nothing", async () => {
  const { fetchImpl, calls } = fakeWeb();
  const got = await media.fillPorts([PORT, TOOL], { apiKey: KEY, fetchImpl, pauseMs: 0, igdbReady: () => true });
  assert.equal(got, 4, "one banner and three screenshots");
  assert.ok(calls.includes("igdb:RollerCoaster Tycoon 2"), "IGDB is asked by the game's own name");
  const u = media.urls(PORT.id);
  assert.match(u.banner_url, /^\/api\/homebrew\/m-0123456789ab\/banner\?v=\w+$/);
  assert.equal(u.screenshots.length, 3);
  assert.match(u.screenshots[2], /\/screenshot\/3\?v=\w+$/);
  const meta = await sharp(fs.readFileSync(media.shotPath(PORT.id, 1))).metadata();
  assert.equal(meta.format, "webp");
  assert.ok(meta.width <= 1280);
  assert.deepEqual(media.urls(TOOL.id), { custom_icon_url: null, banner_url: null, screenshots: [] });
  assert.equal(calls.filter((c) => c.includes("Tool")).length, 0, "a tool is never searched");
});

test("without keys nothing is asked; a search in vain is not repeated for a while", async () => {
  const web = fakeWeb({ sgdb: {}, igdbShots: 0 });
  assert.equal(await media.fillPorts([PORT], { apiKey: "", fetchImpl: web.fetchImpl, pauseMs: 0, igdbReady: () => false }), 0);
  assert.equal(web.calls.length, 0);
  await media.fillPorts([PORT], { apiKey: KEY, fetchImpl: web.fetchImpl, pauseMs: 0, igdbReady: () => true });
  const asked = web.calls.length;
  assert.ok(media.record(PORT.id).banner.miss);
  assert.ok(media.record(PORT.id).shots.miss);
  await media.fillPorts([PORT], { apiKey: KEY, fetchImpl: web.fetchImpl, pauseMs: 0, igdbReady: () => true });
  assert.equal(web.calls.length, asked, "the misses are remembered");
});

test("what the admin removed is not filled in again", async () => {
  const web = fakeWeb();
  await media.fillPorts([PORT], { apiKey: KEY, fetchImpl: web.fetchImpl, pauseMs: 0, igdbReady: () => true });
  await media.removeBanner(PORT.id);
  await media.removeShots(PORT.id);
  assert.deepEqual(media.urls(PORT.id), { custom_icon_url: null, banner_url: null, screenshots: [] });
  assert.equal(fs.existsSync(media.bannerPath(PORT.id)), false);
  assert.equal(fs.existsSync(media.shotPath(PORT.id, 1)), false);
  const before = web.calls.length;
  await media.fillPorts([PORT], { apiKey: KEY, fetchImpl: web.fetchImpl, pauseMs: 0, igdbReady: () => true });
  assert.equal(web.calls.length, before);
});

test("uploaded screenshots add up to eight, one can be taken out and the rest close up", async () => {
  await media.addShots(TOOL.id, [await img(800, 450, 10), await img(800, 450, 20)]);
  await media.addShots(TOOL.id, [await img(800, 450, 30)]);
  assert.equal(media.record(TOOL.id).shots.count, 3);
  assert.equal(media.record(TOOL.id).shots.source, "upload");
  const third = fs.readFileSync(media.shotPath(TOOL.id, 3));
  assert.equal(await media.removeShots(TOOL.id, 2), 2);
  assert.deepEqual(fs.readFileSync(media.shotPath(TOOL.id, 2)), third, "the third moved up");
  assert.equal(fs.existsSync(media.shotPath(TOOL.id, 3)), false);
  await assert.rejects(media.addShots(TOOL.id, Array(7).fill(shot)), /8장/);
  await assert.rejects(media.removeShots(TOOL.id, 5), media.MediaImageError);
});

test("two screenshots uploaded at the same moment both stay", async () => {
  const [a, b] = [await img(800, 450, 40), await img(800, 450, 50)];
  await Promise.all([media.addShots(TOOL.id, [a]), media.addShots(TOOL.id, [b])]);
  assert.equal(media.record(TOOL.id).shots.count, 2);
  assert.notDeepEqual(fs.readFileSync(media.shotPath(TOOL.id, 1)), fs.readFileSync(media.shotPath(TOOL.id, 2)));
});

test("only SteamGridDB's image host is fetched, and broken images or bad ids are refused", async () => {
  await assert.rejects(media.saveBannerFromSgdb(PORT.id, "https://example.com/a.png"), /SteamGridDB/);
  await assert.rejects(media.saveBanner(PORT.id, Buffer.from("not an image")), media.MediaImageError);
  await assert.rejects(media.saveBanner("../x", wide), media.MediaImageError);
  await assert.rejects(media.saveShots(PORT.id, [Buffer.from("nope")]), media.MediaImageError);
});
