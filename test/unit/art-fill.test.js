import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// A game whose files carry no picture shows the one filled in from outside, in this order of
// precedence for every slot: the admin's upload, the picture read from the game file, titledb's
// (downloaded once, kept under data/art-fill), a metadata plugin's. Nothing is fetched on a request.
const data = mkdtempSync(path.join(tmpdir(), "cook-art-fill-"));
process.env.COOK_DATA_DIR = data;
process.env.COOK_EXTRACT_ICONS = "off";

const FILE_ART = "0100000000A01000"; // its own icon in data/icons; titledb offers one too
const DB_ONLY = "0100000000A02000"; // titledb has an icon, a banner and two screenshots
const BOTH = "0100000000A03000"; // titledb and a plugin both offer an icon
const PLUGIN_ONLY = "0100000000A04000"; // only a plugin has pictures
const ADMIN = "0100000000A05000"; // the admin uploaded an icon; titledb offers one
const NOTHING = "0100000000A06000"; // nobody has anything
const PATCHED = "0100000000A07000"; // a patch's game: only titledb knows it

mkdirSync(path.join(data, "titledb"), { recursive: true });
const rec = (id, name, extra = {}) => ({ id, name, ...extra });
writeFileSync(path.join(data, "titledb", "US.en.json"), JSON.stringify({
  1: rec(FILE_ART, "File Art", { iconUrl: "https://img.example.com/file-art.jpg" }),
  2: rec(DB_ONLY, "Db Only", { iconUrl: "https://img.example.com/db-icon.jpg", bannerUrl: "https://img.example.com/db-banner.jpg", screenshots: ["https://img.example.com/s0.jpg", "https://img.example.com/s1.jpg"] }),
  3: rec(BOTH, "Both", { iconUrl: "https://img.example.com/both-db.jpg" }),
  4: rec(PLUGIN_ONLY, "Plugin Only"),
  5: rec(ADMIN, "Admin", { iconUrl: "https://img.example.com/admin-db.jpg" }),
  6: rec(NOTHING, "Nothing"),
  7: rec(PATCHED, "Patched Game", { iconUrl: "https://img.example.com/patched.jpg" }),
}));

const { default: sharp } = await import("sharp");
const picture = (w, h, color) => sharp({ create: { width: w, height: h, channels: 3, background: color } }).jpeg().toBuffer();
const icons = path.join(data, "icons");
mkdirSync(icons, { recursive: true });
writeFileSync(path.join(icons, `${FILE_ART}.jpg`), await picture(256, 256, "#336699"));

const { default: express } = await import("express");
const store = await import("../../src/meta/titledb-store.js");
const customArt = await import("../../src/meta/custom-art.js");
const fill = await import("../../src/meta/art-fill.js");
const { createArtFiller } = await import("../../src/meta/art-filler.js");
const { artworkVersion } = await import("../../src/meta/artwork-version.js");
const { gameOf } = await import("../../src/meta/game-info.js");
const { iconKnown, bannerKnown } = await import("../../src/meta/localized-art.js");
const { titleDetail } = await import("../../src/meta/title-detail.js");
const settings = await import("../../src/security/server-settings.js");
const { default: iconRoute } = await import("../../src/routes/icon.js");
const { default: bannerRoute } = await import("../../src/routes/banner.js");
const { default: screenshotRoute } = await import("../../src/routes/screenshot.js");
await store.load();
await customArt.init();
await customArt.put(ADMIN, "icon", null, await picture(300, 300, "#FFC23D"));

const app = express();
app.get("/api/library/icon/:titleId", iconRoute);
app.get("/api/library/banner/:titleId", bannerRoute);
app.get("/api/library/screenshot/:titleId/:idx", screenshotRoute);
const server = app.listen(0);
after(() => { server.close(); rmSync(data, { recursive: true, force: true }); });
const origin = `http://127.0.0.1:${server.address().port}`;
const status = async (url) => (await fetch(`${origin}${url}`)).status;

// The outside world: a map from address to picture, and a log of what was asked.
const world = new Map([
  ["https://img.example.com/file-art.jpg", await picture(1024, 1024, "#ff0000")],
  ["https://img.example.com/db-icon.jpg", await picture(1024, 1024, "#00aa00")],
  ["https://img.example.com/db-banner.jpg", await picture(1920, 1080, "#0000aa")],
  ["https://img.example.com/s0.jpg", await picture(1920, 1080, "#aa00aa")],
  ["https://img.example.com/s1.jpg", await picture(1920, 1080, "#aaaa00")],
  ["https://img.example.com/both-db.jpg", await picture(1024, 1024, "#00aaaa")],
  ["https://img.example.com/admin-db.jpg", await picture(1024, 1024, "#555555")],
  ["https://img.example.com/patched.jpg", await picture(1024, 1024, "#777700")],
  ["https://plug.example.com/both.png", await picture(512, 512, "#ffffff")],
  ["https://plug.example.com/plugin-only.png", await picture(512, 512, "#abcdef")],
  ["https://plug.example.com/plugin-banner.png", await picture(1280, 720, "#fedcba")],
  ["https://plug.example.com/plugin-shot.png", await picture(1280, 720, "#123456")],
]);
const asked = [];
const fetchImpl = async (url) => {
  asked.push(url);
  const body = world.get(url);
  if (!body) return new Response("gone", { status: 404 });
  return new Response(body, { status: 200, headers: { "content-type": "image/jpeg" } });
};
const pluginAnswers = {
  [BOTH]: { icon: "https://plug.example.com/both.png" },
  [PLUGIN_ONLY]: { icon: "https://plug.example.com/plugin-only.png", banner: "https://plug.example.com/plugin-banner.png", screenshots: ["https://plug.example.com/plugin-shot.png"] },
};
const plugins = { list: (base) => (pluginAnswers[base] ? [{ id: "gamedb", entry: { at: 1, fields: pluginAnswers[base] } }] : []) };
const filler = createArtFiller({ fill, plugins, fetchImpl, onChange: () => { changes++; }, changeMs: 5, gapMs: 0, log: () => {} });
let changes = 0;
filler.start();
for (const id of [FILE_ART, DB_ONLY, BOTH, PLUGIN_ONLY, ADMIN, NOTHING, PATCHED]) filler.want(id);
await filler.idle();

test("a request fetches nothing: before the filler ran there was no picture", async () => {
  // The filler above is a different one from the server's, never started: a screen asking for a game queues nothing.
  const lone = createArtFiller({ fill, fetchImpl, gapMs: 0, log: () => {} });
  const before = asked.length;
  lone.want(NOTHING);
  await lone.idle();
  assert.equal(asked.length, before);
});

test("titledb's icon, banner and screenshots are downloaded once, shrunk, and kept under data/art-fill", async () => {
  const names = readdirSync(path.join(data, "art-fill")).sort();
  assert.ok(names.includes(`${DB_ONLY}.icon.webp`));
  assert.ok(names.includes(`${DB_ONLY}.banner.webp`));
  assert.ok(names.includes(`${DB_ONLY}.screen.0.webp`));
  assert.ok(names.includes(`${DB_ONLY}.screen.1.webp`));
  const meta = await sharp(path.join(data, "art-fill", `${DB_ONLY}.screen.0.webp`)).metadata();
  assert.equal(meta.format, "webp");
  assert.ok(meta.width <= 1280 && meta.height <= 720, "inside the screenshot size");
  assert.equal(readdirSync(icons).filter((n) => n.startsWith(DB_ONLY)).length, 0, "apart from the icons read from game files");
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(changes >= 1, "the library is told so its lists are built again");
});

test("served from disk: icon, banner and screenshots of a game titledb knows", async () => {
  const before = asked.length;
  assert.equal(await status(`/api/library/icon/${DB_ONLY}?size=md`), 200);
  assert.equal(await status(`/api/library/icon/${DB_ONLY}`), 200);
  const banner = await fetch(`${origin}/api/library/banner/${DB_ONLY}`);
  assert.equal(banner.status, 200);
  const shot = await sharp(Buffer.from(await (await fetch(`${origin}/api/library/screenshot/${DB_ONLY}/1`)).arrayBuffer())).stats();
  assert.ok(shot.channels[0].mean > 100, "the second screenshot titledb lists");
  assert.equal(await status(`/api/library/screenshot/${DB_ONLY}/2`), 404);
  assert.equal(asked.length, before, "no request path reaches the network");
});

test("precedence: the game file's icon beats titledb's, and titledb's was never downloaded for it", async () => {
  assert.ok(!asked.includes("https://img.example.com/file-art.jpg"));
  assert.equal(fill.kept(FILE_ART, "icon"), false);
  const served = await sharp(Buffer.from(await (await fetch(`${origin}/api/library/icon/${FILE_ART}`)).arrayBuffer())).stats();
  assert.ok(served.channels[2].mean > served.channels[0].mean, "the file's blue icon, not titledb's red one");
});

test("precedence: the admin's icon beats titledb's, which is not downloaded either", async () => {
  assert.ok(!asked.includes("https://img.example.com/admin-db.jpg"));
  assert.equal(fill.kept(ADMIN, "icon"), false);
  assert.equal(await status(`/api/library/icon/${ADMIN}`), 200);
});

test("precedence: titledb's beats a plugin's for the same slot", async () => {
  assert.ok(asked.includes("https://img.example.com/both-db.jpg"));
  assert.ok(!asked.includes("https://plug.example.com/both.png"), "the plugin was not asked for a slot titledb filled");
  assert.equal(fill.sourceOf(BOTH, "icon"), "titledb");
});

test("a plugin fills what titledb does not have, and its source is remembered", async () => {
  assert.equal(fill.sourceOf(PLUGIN_ONLY, "icon"), "plugin:gamedb");
  assert.equal(fill.sourceOf(PLUGIN_ONLY, "banner"), "plugin:gamedb");
  assert.equal(fill.sourceOf(PLUGIN_ONLY, "screenshot", 0), "plugin:gamedb");
  assert.equal(await status(`/api/library/icon/${PLUGIN_ONLY}`), 200);
  assert.equal(await status(`/api/library/banner/${PLUGIN_ONLY}`), 200);
  assert.equal(await status(`/api/library/screenshot/${PLUGIN_ONLY}/0`), 200);
});

test("the detail credits the plugin whose picture is shown, and only then", async () => {
  const { agentParts } = await import("../../src/plugins/instance.js");
  await agentParts().store.put("gamedb", PLUGIN_ONLY, { fields: pluginAnswers[PLUGIN_ONLY], credit: { text: "Game DB" } });
  assert.deepEqual((await titleDetail(PLUGIN_ONLY, { lang: "en" })).artCredit, { text: "Game DB" });
  assert.equal((await titleDetail(DB_ONLY, { lang: "en" })).artCredit, undefined, "titledb's pictures need none");
  assert.equal((await titleDetail(FILE_ART, { lang: "en" })).artCredit, undefined);
});

test("a banner titledb does not have is drawn from the filled icon", async () => {
  assert.equal(fill.kept(BOTH, "banner"), false);
  const res = await fetch(`${origin}/api/library/banner/${BOTH}`);
  assert.equal(res.status, 200);
  assert.ok(existsSync(fill.fillPath(BOTH, "drawn")), "drawn into the filled folder, not data/icons");
  assert.equal(readdirSync(icons).filter((n) => n.startsWith(BOTH)).length, 0);
});

test("a game nobody has pictures for stays empty and is not asked again at once", async () => {
  assert.equal(await status(`/api/library/icon/${NOTHING}`), 404);
  const before = asked.length;
  filler.want(NOTHING);
  filler.want(DB_ONLY);
  await filler.idle();
  assert.equal(asked.length, before);
  assert.ok(fill.recordOf(NOTHING).retry > Date.now(), "a miss waits");
});

test("a patch's game gets its icon from titledb (gameOf)", async () => {
  const game = gameOf(PATCHED);
  assert.match(game.icon, /^\/api\/library\/icon\/0100000000A07000\?v=[0-9a-f]{12}$/);
  assert.equal(gameOf(NOTHING).icon, undefined);
  assert.ok(gameOf(PATCHED, "http://h").icon.startsWith("http://h/api/library/icon/"), "absolute, like the library's artwork URLs");
});

test("detail: icon, banner and screenshots are offered for a filled game", async () => {
  const d = await titleDetail(DB_ONLY, { lang: "en" });
  assert.match(d.iconUrl, /icon/);
  assert.ok(d.bannerUrl);
  assert.equal(d.screenshotCount, 2);
  assert.equal(iconKnown(NOTHING, null), false);
  assert.equal(bannerKnown(NOTHING, null), false);
  const own = await titleDetail(FILE_ART, { lang: "en" });
  assert.equal(own.screenshotCount, 0, "a game with art in its files looks as before");
});

test("the admin's screenshots hide the filled ones", async () => {
  await customArt.put(DB_ONLY, "screenshot", 0, await picture(1920, 1080, "#000000"));
  const d = await titleDetail(DB_ONLY, { lang: "en" });
  assert.equal(d.screenshotCount, 1);
  assert.equal(await status(`/api/library/screenshot/${DB_ONLY}/1`), 404);
  await customArt.remove(DB_ONLY, "screenshot", 0);
  assert.equal((await titleDetail(DB_ONLY, { lang: "en" })).screenshotCount, 2);
});

test("a picture arriving changes the artwork version", async () => {
  const late = "0100000000A08000";
  const before = { icon: artworkVersion("icon", late), banner: artworkVersion("banner", late), shot: artworkVersion("screenshot", late, { idx: 0 }) };
  world.set("https://img.example.com/late.jpg", await picture(1024, 1024, "#123123"));
  const db = createArtFiller({ fill, fetchImpl, gapMs: 0, log: () => {}, titledb: () => ({ iconUrl: "https://img.example.com/late.jpg" }), plugins: { list: () => [] } });
  db.start();
  db.want(late);
  await db.idle();
  fill.setWanter(filler.want);
  assert.notEqual(artworkVersion("icon", late), before.icon);
  assert.notEqual(artworkVersion("banner", late), before.banner, "its banner is drawn from it");
  assert.equal(artworkVersion("screenshot", late, { idx: 0 }), before.shot);
});

test("a file icon read later wins, and the version follows it", async () => {
  const v = artworkVersion("icon", DB_ONLY);
  const file = path.join(icons, `${DB_ONLY}.jpg`);
  writeFileSync(file, await picture(256, 256, "#336699"));
  const { forget } = await import("../../src/meta/image-cache.js");
  forget(file);
  assert.notEqual(artworkVersion("icon", DB_ONLY), v);
  const served = await sharp(Buffer.from(await (await fetch(`${origin}/api/library/icon/${DB_ONLY}`)).arrayBuffer())).stats();
  assert.ok(served.channels[2].mean > served.channels[1].mean, "the file's blue icon, not the filled green one");
  assert.equal(fill.iconFallback(DB_ONLY), null);
});

test("a failed download is remembered and retried later, not at once", async () => {
  const flaky = "0100000000A09000";
  let now = 1_000_000;
  const f = createArtFiller({ fill, fetchImpl, gapMs: 0, log: () => {}, now: () => now, titledb: () => ({ iconUrl: "https://img.example.com/missing.jpg" }), plugins: { list: () => [] } });
  f.start();
  f.want(flaky);
  await f.idle();
  const first = fill.recordOf(flaky);
  assert.equal(first.fails, 1);
  assert.ok(first.retry > now);
  const n = asked.length;
  f.want(flaky);
  await f.idle();
  assert.equal(asked.length, n, "not hammered");
  now = first.retry + 1;
  f.want(flaky);
  await f.idle();
  assert.equal(asked.length, n + 1, "tried again after the wait");
  assert.equal(fill.recordOf(flaky).fails, 2);
  assert.ok(fill.recordOf(flaky).retry - now > first.retry - 1_000_000, "the wait doubles");
  fill.setWanter(filler.want);
});

test("a picture too large or not a picture is refused and nothing is written", async () => {
  const bad = "0100000000A0A000";
  world.set("https://img.example.com/html", Buffer.from("<html>not a picture</html>"));
  const f = createArtFiller({ fill, fetchImpl, gapMs: 0, log: () => {}, titledb: () => ({ iconUrl: "https://img.example.com/html" }), plugins: { list: () => [] } });
  f.start();
  f.want(bad);
  await f.idle();
  assert.equal(fill.kept(bad, "icon"), false);
  assert.equal(fill.recordOf(bad).fails, 1);
  fill.setWanter(filler.want);
});

test("setting off: nothing new is fetched, kept pictures are not shown, the version is the file-only one; on brings them back", async () => {
  const withFill = { icon: artworkVersion("icon", PLUGIN_ONLY), banner: artworkVersion("banner", PLUGIN_ONLY) };
  settings.save({ fillMissingArt: false });
  try {
    assert.equal(fill.enabled(), false);
    assert.equal(await status(`/api/library/icon/${PLUGIN_ONLY}`), 404);
    assert.equal(await status(`/api/library/banner/${PLUGIN_ONLY}`), 404);
    assert.equal(await status(`/api/library/screenshot/${PLUGIN_ONLY}/0`), 404);
    assert.equal(gameOf(PLUGIN_ONLY)?.icon, undefined);
    assert.notEqual(artworkVersion("icon", PLUGIN_ONLY), withFill.icon, "clients refetch");
    const before = asked.length;
    const off = "0100000000A0B000";
    const f = createArtFiller({ fill, fetchImpl, gapMs: 0, log: () => {}, titledb: () => ({ iconUrl: "https://img.example.com/db-icon.jpg" }), plugins: { list: () => [] } });
    f.start();
    f.want(off);
    await f.idle();
    assert.equal(asked.length, before, "no new download");
    assert.equal(fill.kept(off, "icon"), false);
    fill.setWanter(filler.want);
  } finally {
    settings.save({ fillMissingArt: null });
  }
  assert.equal(fill.enabled(), true);
  assert.equal(await status(`/api/library/icon/${PLUGIN_ONLY}`), 200);
  assert.equal(artworkVersion("icon", PLUGIN_ONLY), withFill.icon);
});

test("status counts titles by source and the games still without any icon", async () => {
  const s = filler.status();
  assert.ok(s.titledb >= 3);
  assert.equal(s.plugin, 1);
  assert.ok(s.missing >= 1, "the game nobody has art for");
  assert.equal(s.enabled, true);
});

test("the filler keeps its records on disk across a restart", async () => {
  fill.flush();
  fill.reset();
  assert.ok(fill.recordOf(DB_ONLY)?.got?.icon === "titledb");
  assert.equal(fill.kept(DB_ONLY, "icon"), true);
});

test("the setting is on by default, saved live, and worded in all twelve admin languages", async () => {
  assert.ok(settings.SETTINGS.fillMissingArt.check(true) && settings.SETTINGS.fillMissingArt.check(false) && !settings.SETTINGS.fillMissingArt.check("yes"));
  assert.equal(settings.describe().fillMissingArt.value, true, "on until the admin turns it off");
  const { TOP_WORDS } = await import("../../src/routes/admin/top-i18n.js");
  const langs = Object.keys(TOP_WORDS);
  assert.equal(langs.length, 12);
  for (const lang of langs) {
    for (const key of ["ss.f.fillMissingArt", "ss.f.fillMissingArtD", "ss.on.fillMissingArt", "ss.off.fillMissingArt", "ss.artFillCounts"]) {
      assert.ok(TOP_WORDS[lang][key], `${lang} ${key}`);
    }
    const counts = TOP_WORDS[lang]["ss.artFillCounts"];
    for (const slot of ["{t}", "{p}", "{m}"]) assert.ok(counts.includes(slot), `${lang} counts keep ${slot}`);
  }
  const { SERVER_SETTINGS_SCRIPT } = await import("../../src/routes/admin/server-settings-panel.js");
  assert.match(SERVER_SETTINGS_SCRIPT, /'fillMissingArt','bool'/);
});
