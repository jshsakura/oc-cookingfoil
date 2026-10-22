import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { CONSOLE, seedConsole } from "../support/console.js";

process.env.COOK_RATING_SYNC = "false";
const { releaseDateInt, playersInt, genreKeys, fromLaunchBox, fromMame, fromIgdb, fillFrom, detailFields, MAX_SHOTS } = await import("../../src/retro/meta/fields.js");
const { readLaunchBoxMeta, readMame } = await import("../../src/retro/meta/launchbox.js");
const { buildMeta, metaKey, pickGame } = await import("../../src/retro/meta/build.js");
const { shotUrls, downloadShots, localShots, needsShots, indexShots, fetchAllowed, readCapped } = await import("../../src/retro/meta/screenshots.js");
const ratings = await import("../../src/retro/art/ratings.js");
const { retroDetailFields, metaOwner } = await import("../../src/retro/meta/detail.js");
const store = await import("../../src/retro/meta/store.js");
const sync = await import("../../src/retro/meta/sync.js");
const { gameId } = await import("../../src/retro/catalog.js");

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
const SNES = { folder: "snes" };
const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const put = (root, rel, body = "x") => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body);
};
const imageResponse = (body = PNG) => new Response(body, { status: 200 });
const noNetwork = () => { throw new Error("no network on this path"); };

test("release dates become YYYYMMDD integers, a year alone YYYY0000", () => {
  assert.equal(releaseDateInt("1994-12-01"), 19941201);
  assert.equal(releaseDateInt("1991-07-13T00:00:00-04:00"), 19910713);
  assert.equal(releaseDateInt(null, "1987"), 19870000);
  // LaunchBox sometimes carries a date that is not the release (the year disagrees): the year wins.
  assert.equal(releaseDateInt("2026-05-22", "1994"), 19940000);
  assert.equal(releaseDateInt("garbage"), null);
  assert.equal(releaseDateInt(null, "198?"), null);
});

test("players are whole numbers; genres are known keys only, without repeats", () => {
  assert.equal(playersInt("2"), 2);
  assert.equal(playersInt("0"), null);
  assert.equal(playersInt(""), null);
  assert.deepEqual(genreKeys(["Action", " Platform", "Role-Playing", "Beat 'em Up", "Compilation"]), ["Action", "Platformer", "RPG"]);
  assert.equal(genreKeys(["Compilation"]), null);
});

test("a LaunchBox game maps to the detail's fields; unknown ones are left out", () => {
  const record = fromLaunchBox(
    { DatabaseID: "12", Name: "Chrono Trigger", Overview: "Time travel.\r\n\r\nParty RPG.", Publisher: "Square", ReleaseYear: "1995", ReleaseDate: "1995-03-11", MaxPlayers: "1", Genres: "Role-Playing" },
    [{ FileName: "b.png", Type: "Screenshot - Game Title" }, { FileName: "a.png", Type: "Screenshot - Gameplay" }, { FileName: "../x.png", Type: "Screenshot - Gameplay" }],
  );
  assert.deepEqual(record, {
    source: "launchbox", id: "12", description: { en: "Time travel.\n\nParty RPG." }, publisher: "Square",
    releaseDate: 19950311, numberOfPlayers: 1, genres: ["RPG"],
    shots: ["https://images.launchbox-app.com/a.png", "https://images.launchbox-app.com/b.png"],
  });
  assert.equal("developer" in record, false);
  const coop = fromLaunchBox({ DatabaseID: "2", Name: "y", Genres: "Action; Beat 'em Up", Cooperative: "true", ESRB: "E10+ - Everyone 10+" });
  assert.deepEqual([coop.genres, coop.styles, coop.cooperative, coop.esrb], [["Action"], ["beat-em-up"], true, "E10+"]);
  const plain = fromLaunchBox({ DatabaseID: "3", Name: "z", Genres: "RPG", Cooperative: "false", ESRB: "Not Rated" });
  for (const k of ["styles", "cooperative", "esrb"]) assert.equal(k in plain, false, `${k} is left out when unknown`);
  const many = fromLaunchBox({ DatabaseID: "1", Name: "x" }, Array.from({ length: 12 }, (_, i) => ({ FileName: `${i}.png`, Type: "Screenshot - Gameplay" })));
  assert.equal(many.shots.length, MAX_SHOTS);
});

test("MAME and IGDB records use the same shapes", () => {
  assert.deepEqual(fromMame({ Publisher: "Capcom", Year: "1991", Genre: "Fighter / Versus", PlayMode: "2P sim", Series: "Street Fighter" }),
    { source: "mame", publisher: "Capcom", releaseDate: 19910000, numberOfPlayers: 2, genres: ["Fighting"], simultaneous: 2, arcadeStyle: "versus-fighter", series: "Street Fighter" });
  assert.equal(fromMame({ PlayMode: "2P alt" }).simultaneous, undefined, "taking turns is not playing at once");
  assert.equal(fromMame({ Genre: "Puzzle / Drop" }).arcadeStyle, "puzzle", "a kind with no style of its own takes its group's");
  const igdb = fromIgdb({
    id: 7, summary: "A summary.", first_release_date: 700000000, genres: [{ name: "Platform" }, { name: "Indie" }],
    involved_companies: [{ company: { name: "Dev Co" }, developer: true }, { company: { name: "Pub Co" }, publisher: true }],
    multiplayer_modes: [{ offlinemax: 2 }], screenshots: [{ image_id: "abc" }],
  });
  assert.deepEqual(igdb, {
    source: "igdb", id: "7", description: { en: "A summary." }, publisher: "Pub Co", developer: "Dev Co",
    releaseDate: 19920307, numberOfPlayers: 2, genres: ["Platformer"],
    shots: ["https://images.igdb.com/igdb/image/upload/t_screenshot_big/abc.jpg"],
  });
  assert.equal(fromIgdb({ id: 1, game_modes: [{ slug: "single-player" }] }).numberOfPlayers, 1);
  assert.deepEqual(fillFrom({ source: "launchbox", publisher: "A" }, { source: "mame", publisher: "B", releaseDate: 19910000 }),
    { source: "launchbox", publisher: "A", releaseDate: 19910000 });
});

test("detail fields follow the request language with English as the fallback", () => {
  const record = { source: "launchbox", description: { en: "English text.", ko: "한국어 설명." }, genres: ["RPG", "Action"], releaseDate: 19950311 };
  const ko = detailFields(record, "ko");
  assert.equal(ko.description, "한국어 설명.");
  assert.deepEqual(ko.genres, ["RPG", "액션"]);
  const ja = detailFields(record, "ja");
  assert.equal(ja.description, "English text.");
  assert.deepEqual(ja.genres, ["ロールプレイング", "アクション"]);
  assert.equal(detailFields(record, "zh").genres[1], "動作");
  assert.equal(ja.releaseDate, 19950311);
  for (const k of ["publisher", "developer", "numberOfPlayers", "screenshots"]) assert.equal(k in ja, false, `${k} is left out`);
  assert.deepEqual(detailFields(null, "en"), {});
  assert.deepEqual(detailFields({ source: "igdb", miss: true }, "en"), {});
  assert.equal(detailFields(record, "en", Array.from({ length: 10 }, (_, i) => `/s/${i}`)).screenshots.length, 8);
});

const XML = `<?xml version="1.0"?>
<LaunchBox>
  <Game>
    <Name>Chrono Trigger</Name>
    <ReleaseDate>1995-03-11</ReleaseDate>
    <Overview>First paragraph &amp; more.

Second paragraph.</Overview>
    <MaxPlayers>1</MaxPlayers>
    <ReleaseType>Released</ReleaseType>
    <DatabaseID>10</DatabaseID>
    <Platform>Super Nintendo Entertainment System</Platform>
    <CommunityRatingCount>50</CommunityRatingCount>
    <Genres>Role-Playing</Genres>
    <Developer>Square</Developer>
    <Publisher>Square</Publisher>
  </Game>
  <Game>
    <Name>Chrono Trigger</Name>
    <ReleaseType>ROM Hack</ReleaseType>
    <DatabaseID>11</DatabaseID>
    <Platform>Super Nintendo Entertainment System</Platform>
    <CommunityRatingCount>90</CommunityRatingCount>
  </Game>
  <Game>
    <Name>Rockman X</Name>
    <Overview>Mega Man X.</Overview>
    <DatabaseID>20</DatabaseID>
    <Platform>Super Nintendo Entertainment System</Platform>
    <Genres />
  </Game>
  <Game>
    <Name>Mega Man X</Name>
    <DatabaseID>21</DatabaseID>
    <Platform>Super Nintendo Entertainment System</Platform>
    <Publisher>Capcom</Publisher>
  </Game>
  <Game>
    <Name>Street Fighter II: The World Warrior</Name>
    <Overview>Fight.</Overview>
    <DatabaseID>30</DatabaseID>
    <Platform>Arcade</Platform>
  </Game>
  <Game>
    <Name>Unrelated</Name>
    <DatabaseID>40</DatabaseID>
    <Platform>Super Nintendo Entertainment System</Platform>
  </Game>
  <GameAlternateName>
    <AlternateName>Rockman X2 Sub</AlternateName>
    <DatabaseID>21</DatabaseID>
    <Region>Japan</Region>
  </GameAlternateName>
  <GameImage>
    <DatabaseID>10</DatabaseID>
    <FileName>shot-a.png</FileName>
    <Type>Screenshot - Gameplay</Type>
  </GameImage>
  <GameImage>
    <DatabaseID>10</DatabaseID>
    <FileName>box.png</FileName>
    <Type>Box - Front</Type>
  </GameImage>
  <GameImage>
    <DatabaseID>40</DatabaseID>
    <FileName>other.png</FileName>
    <Type>Screenshot - Gameplay</Type>
  </GameImage>
</LaunchBox>
`;
const MAME = `<LaunchBox>
  <MameFile>
    <FileName>sf2</FileName>
    <Name>Street Fighter II: The World Warrior</Name>
    <Publisher>Capcom</Publisher>
    <Year>1991</Year>
    <Genre>Fighter / Versus</Genre>
    <PlayMode>2P sim</PlayMode>
  </MameFile>
  <MameFile>
    <FileName>sf2j</FileName>
    <Name>Street Fighter II: The World Warrior</Name>
    <CloneOf>sf2</CloneOf>
  </MameFile>
  <MameFile>
    <FileName>pacman</FileName>
    <Name>Pac-Man</Name>
  </MameFile>
</LaunchBox>
`;
const WANTED = new Set(["Super Nintendo Entertainment System", "Arcade"]);

test("Metadata.xml is read with multi-line overviews, kept to the wanted titles", async () => {
  const keys = new Set(["chrono trigger", "rockman x2 sub", "street fighter 2 world warrior"]);
  let opened = 0;
  const data = await readLaunchBoxMeta(() => { opened++; return Readable.from([XML]); }, WANTED, keys);
  assert.equal(data.games.get("10").Overview, "First paragraph & more.\n\nSecond paragraph.");
  assert.deepEqual([...data.games.keys()].sort(), ["10", "11", "21", "30"], "unnamed games are not kept; 21 is found by its alternate name");
  assert.equal(data.games.get("21").Publisher, "Capcom", "a game found by an alternate name is read in full");
  assert.equal(opened, 2);
  assert.deepEqual(data.images.get("10"), [{ FileName: "shot-a.png", Type: "Screenshot - Gameplay" }]);
  assert.equal(data.images.has("40"), false);
  const mame = await readMame(Readable.from([MAME]), new Set(["sf2", "sf2j"]));
  assert.deepEqual([...mame.keys()], ["sf2", "sf2j"]);
  assert.equal(mame.get("sf2j").CloneOf, "sf2");
});

test("games match LaunchBox by their original title, alternate names and MAME names", async () => {
  const data = await readLaunchBoxMeta(() => Readable.from([XML]), WANTED);
  const mame = await readMame(Readable.from([MAME]));
  const games = [
    { system: "snes", name: "크로노 트리거 (Chrono Trigger) [K]", original: "Chrono Trigger (USA)" },
    { system: "snes", name: "Rockman X2 Sub (Japan)" },
    { system: "snes", name: "Nothing Like It (Japan)" },
    { system: "arcade", name: "스트리트 파이터 2", set: "sf2j", cloneOf: "sf2" },
    { system: "arcade", name: "Pac-Man", set: "pacman" },
  ];
  const meta = buildMeta(games, data, mame);
  const ct = meta[metaKey(games[0])];
  assert.equal(ct.id, "10", "the release wins over a more voted hack of the same name");
  assert.equal(ct.developer, "Square");
  assert.deepEqual(ct.shots, ["https://images.launchbox-app.com/shot-a.png"]);
  assert.equal(meta["snes/Rockman X2 Sub (Japan)"].id, "21");
  assert.equal(meta["snes/Nothing Like It (Japan)"], undefined, "no match, no record");
  const sf2 = meta["arcade/sf2j"];
  assert.equal(sf2.source, "launchbox");
  assert.equal(sf2.description.en, "Fight.");
  assert.equal(sf2.publisher, "Capcom", "MAME fills in what LaunchBox lacks");
  assert.equal(sf2.numberOfPlayers, 2);
  assert.equal(meta["arcade/pacman"], undefined, "a MAME entry with nothing but a name is no record");
  assert.equal(pickGame([]), null);
  assert.equal(metaKey({ system: "ps1", name: "Game", m3u: true, extras: [{ rel: "Game/Game (Disc 1).chd" }] }), "ps1/Game (Disc 1)");
});

test("a ScummVM game is found by the English title in its title.json, not its ScummVM id", async () => {
  const { PLATFORMS } = await import("../../src/retro/art/titles.js");
  const xml = `<?xml version="1.0"?>
<LaunchBox>
  <Game>
    <Name>The Secret of Monkey Island</Name>
    <DatabaseID>77</DatabaseID>
    <Platform>ScummVM</Platform>
    <Overview>Become a pirate.</Overview>
    <Developer>Lucasfilm Games</Developer>
  </Game>
</LaunchBox>`;
  const data = await readLaunchBoxMeta(() => Readable.from([xml]), new Set(PLATFORMS.scummvm));
  const game = { system: "scummvm", name: "monkey", names: { en: "The Secret of Monkey Island", ko: "원숭이 섬의 비밀" } };
  const record = buildMeta([game], data)[metaKey(game)];
  assert.equal(metaKey(game), "scummvm/monkey");
  assert.equal(record.id, "77");
  assert.equal(record.description.en, "Become a pirate.");
});

test("screenshots are downloaded once, at most 8, and served with a ?v= of their file", async () => {
  const dir = tmp("retro-shots-");
  const record = { shots: [...Array.from({ length: 10 }, (_, i) => `https://images.launchbox-app.com/${i}.png`)] };
  const asked = [];
  const fetchImpl = async (url) => { asked.push(url); return imageResponse(); };
  assert.equal(needsShots(dir, SNES, "snes/Game", record), true);
  const r = await downloadShots(dir, SNES, "snes/Game", record, { fetchImpl });
  assert.equal(r.saved, 8);
  assert.equal(asked.length, 8);
  assert.equal(needsShots(dir, SNES, "snes/Game", record), false);
  assert.equal((await downloadShots(dir, SNES, "snes/Game", record, { fetchImpl })).saved, 0, "files on disk are not fetched again");
  assert.ok(fs.existsSync(path.join(dir, "screenshots/snes/Game/1.png")));
  const urls = shotUrls(dir, SNES, "snes/Game", "/api/retro/games/x");
  assert.equal(urls.length, 8);
  assert.match(urls[0], /^\/api\/retro\/games\/x\/screenshot\/1\?v=[0-9a-f]{12}$/);
  fs.writeFileSync(path.join(dir, "screenshots/snes/Game/1.png"), Buffer.concat([PNG, PNG]));
  assert.notEqual(shotUrls(dir, SNES, "snes/Game", "/b")[0], urls[0].replace("/api/retro/games/x", "/b"), "a changed file gets a new ?v=");
});

test("only images from the known hosts are written", async () => {
  const dir = tmp("retro-shots-");
  const record = { shots: ["https://images.launchbox-app.com/a.png", "https://evil.example.org/b.png", "https://images.igdb.com/c.jpg"] };
  const fetchImpl = async (url) => (url.includes("igdb") ? new Response("<html>", { status: 200 }) : imageResponse());
  const r = await downloadShots(dir, SNES, "snes/G", record, { fetchImpl });
  assert.deepEqual(r, { saved: 1, skipped: 2, have: 1 });
  assert.deepEqual(localShots(dir, SNES, "snes/G").map((s) => s.n), [1]);
  assert.equal(localShots(dir, SNES, "snes/../../etc").length, 0);
});

test("a redirect is followed only to an allowed host, and a body over 5 MB is dropped while it streams", async () => {
  const dir = tmp("retro-shots-");
  const hops = [];
  const fetchImpl = async (url, opts) => {
    hops.push([url, opts.redirect]);
    if (url.endsWith("/out.png")) return new Response(null, { status: 302, headers: { location: "https://evil.example.org/x.png" } });
    if (url.endsWith("/move.png")) return new Response(null, { status: 301, headers: { location: "/moved.png" } });
    if (url.endsWith("/huge.png")) {
      // No Content-Length: the limit has to hold while reading.
      let sent = 0;
      const stream = new ReadableStream({ pull(c) { if (sent > 7) return c.close(); sent++; c.enqueue(new Uint8Array(1024 * 1024)); } });
      return new Response(stream, { status: 200 });
    }
    return imageResponse();
  };
  assert.equal(await fetchAllowed("https://images.launchbox-app.com/out.png", fetchImpl), null, "a hop off the allow list is not followed");
  assert.ok(!hops.some(([u]) => u.includes("evil")));
  assert.ok(hops.every(([, r]) => r === "manual"));
  assert.equal((await fetchAllowed("https://images.launchbox-app.com/move.png", fetchImpl)).status, 200, "a hop on the same host is");
  assert.equal(hops.at(-1)[0], "https://images.launchbox-app.com/moved.png");
  const record = { shots: ["https://images.launchbox-app.com/huge.png", "https://images.launchbox-app.com/out.png", "https://images.launchbox-app.com/ok.png"] };
  assert.deepEqual(await downloadShots(dir, SNES, "snes/H", record, { fetchImpl }), { saved: 1, skipped: 2, have: 1 });
  assert.equal(await readCapped(new Response("x".repeat(10), { headers: { "content-length": "10" } }), 5), null);
});

test("the screenshot index counts each game folder's screenshots in one async pass", async () => {
  const dir = tmp("retro-index-");
  put(dir, "screenshots/snes/A/1.png", PNG);
  put(dir, "screenshots/snes/A/2.jpg", PNG);
  put(dir, "screenshots/snes/A/notes.txt", "x");
  put(dir, "screenshots/snes/B/1.png", PNG);
  const counts = await indexShots(dir);
  assert.equal(counts.get(path.join(dir, "screenshots/snes/A")), 2);
  assert.equal(counts.get(path.join(dir, "screenshots/snes/B")), 1);
  assert.equal((await indexShots(path.join(dir, "missing"))).size, 0);
});

test("LaunchBox reads: a failed unzip is no update, and a far shorter read is not applied", async () => {
  assert.equal(ratings.shrankTooMuch(100, 79), true);
  assert.equal(ratings.shrankTooMuch(100, 80), false);
  assert.equal(ratings.shrankTooMuch(5, 0), false, "too few earlier records to compare");
  assert.equal(ratings.comparableCount({ snes: { A: {}, B: {} }, gone: { C: {} } }, new Set(["snes\0A", "snes\0B"])), 2);
  // A zip that unzip can't read: whatever was parsed (nothing), the read throws.
  const cache = tmp("retro-lb-");
  fs.writeFileSync(path.join(cache, "Metadata.zip"), "not a zip");
  await assert.rejects(ratings.readXml(path.join(cache, "Metadata.zip"), "Metadata.xml", async (open) => {
    for await (const _ of open()) { /* drain */ }
    return "parsed";
  }), /unzip Metadata\.xml/);
  // The details refresh stops before touching records or screenshots.
  const dir = tmp("retro-lbdir-");
  put(dir, "screenshots/snes/G/1.png", PNG);
  const previous = { "snes/G": { source: "launchbox", shots: ["https://images.launchbox-app.com/g.png"] } };
  store.reset(previous, 1);
  const unchanged = async () => new Response(null, { status: 304 });
  try {
    await assert.rejects(sync.refreshLaunchBox({ dir, cacheDir: cache, games: [{ system: "snes", name: "G" }], systems: { snes: SNES }, fetchImpl: unchanged }), /unzip/);
    assert.deepEqual(store.all(), previous, "records kept");
    assert.ok(fs.existsSync(path.join(dir, "screenshots/snes/G/1.png")), "screenshots kept");
    // A good zip with far fewer matches than last time: not applied either.
    const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`snes/Game ${i}`, { source: "launchbox", shots: [`https://images.launchbox-app.com/${i}.png`] }]));
    store.reset(many, 1);
    const games = Array.from({ length: 20 }, (_, i) => ({ system: "snes", name: `Game ${i}` }));
    for (let i = 0; i < 20; i++) put(dir, `screenshots/snes/Game ${i}/1.png`, PNG);
    const xml = `<LaunchBox>\n  <Game>\n    <Name>Game 1</Name>\n    <DatabaseID>1</DatabaseID>\n    <Platform>Super Nintendo Entertainment System</Platform>\n  </Game>\n</LaunchBox>\n`;
    const work = tmp("retro-lbzip-");
    fs.writeFileSync(path.join(work, "Metadata.xml"), xml);
    fs.rmSync(path.join(cache, "Metadata.zip"));
    await new Promise((res, rej) => spawn("zip", ["-q", path.join(cache, "Metadata.zip"), "Metadata.xml"], { cwd: work }).on("close", (c) => (c ? rej(new Error(`zip ${c}`)) : res())));
    await assert.rejects(sync.refreshLaunchBox({ dir, cacheDir: cache, games, systems: { snes: SNES }, fetchImpl: unchanged }), /크게 줄어/);
    assert.deepEqual(store.all(), many, "records kept");
    assert.ok(fs.existsSync(path.join(dir, "screenshots/snes/Game 5/1.png")), "screenshots kept");
  } finally {
    store.reset();
    sync.reset();
  }
});

test("both LaunchBox readers share one download of Metadata.zip", async () => {
  const cache = tmp("retro-lbfetch-");
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 20));
    return new Response("ZIPBYTES", { status: 200 });
  };
  const [a, b] = await Promise.all([ratings.fetchMetadata(cache, fetchImpl), ratings.fetchMetadata(cache, fetchImpl)]);
  assert.equal(a, b);
  assert.equal(calls, 1, "the second waits for the first");
  assert.equal(fs.readFileSync(a, "utf8"), "ZIPBYTES");
  assert.deepEqual(fs.readdirSync(cache), ["Metadata.zip"], "no temporary file is left");
});

test("a game's detail reads only memory and disk, and versions share one record", async () => {
  const dir = tmp("retro-detail-");
  put(dir, "screenshots/snes/Base (Japan)/1.png", PNG);
  store.reset({ "snes/Base (Japan)": { source: "launchbox", description: { en: "Text." }, publisher: "P" }, "snes/Patched [K]": { source: "igdb", miss: true } });
  const base = { system: "snes", name: "Base (Japan)" };
  const patched = { system: "snes", name: "Patched [K]" };
  const realFetch = globalThis.fetch;
  globalThis.fetch = noNetwork;
  try {
    const fields = retroDetailFields({ dir, systems: { snes: SNES }, candidates: [patched, base], base: "/api/retro/games/p", lang: "ko" });
    assert.equal(fields.description, "Text.");
    assert.equal(fields.publisher, "P");
    assert.equal(fields.screenshots.length, 1);
    assert.equal(metaOwner([patched]), null, "a remembered miss is no record");
    assert.deepEqual(retroDetailFields({ dir, systems: { snes: SNES }, candidates: [patched], base: "/b", lang: "en" }), {});
  } finally {
    globalThis.fetch = realFetch;
    store.reset();
  }
});

test("a LaunchBox rebuild keeps IGDB answers for the rest and drops screenshots that changed", () => {
  const previous = { "a/x": { source: "igdb", publisher: "Q" }, "a/y": { source: "launchbox", shots: ["u1"] }, "a/z": { source: "launchbox", shots: ["u2"] } };
  const fresh = { "a/y": { source: "launchbox", shots: ["u9"] }, "a/z": { source: "launchbox", shots: ["u2"] } };
  assert.deepEqual(Object.keys(sync.mergeRecords(previous, fresh)).sort(), ["a/x", "a/y", "a/z"]);
  assert.deepEqual(sync.changedShots(previous, sync.mergeRecords(previous, fresh)), ["a/y"]);
  const now = 10 ** 12;
  const games = [{ system: "a", name: "x" }, { system: "a", name: "w" }, { system: "a", name: "m" }];
  const due = sync.igdbDue(games, { "a/x": { source: "igdb" }, "a/m": { source: "igdb", miss: true, at: now - 1000 } }, now);
  assert.deepEqual(due.map((g) => g.name), ["w"]);
});

test("the background loop does nothing while its setting is off, and no screenshots without the art setting", async () => {
  const dir = tmp("retro-loop-");
  const games = [{ system: "snes", name: "G" }];
  const current = async () => ({ games, systems: { snes: SNES } });
  const asked = [];
  const fetchImpl = async (url) => { asked.push(url); return imageResponse(); };
  sync.reset();
  store.reset({ "snes/G": { source: "launchbox", shots: ["https://images.launchbox-app.com/g.png"] } }, Date.now());
  try {
    let read = 0;
    assert.equal(await sync.tick({ dir, current: async () => { read++; return current(); }, fetchImpl, settings: () => ({ on: false, art: true }) }), null);
    assert.equal(read, 0, "not even the catalog is read");
    assert.deepEqual(await sync.tick({ dir, current, fetchImpl, settings: () => ({ on: true, art: false }), pauseMs: 0 }), { igdb: 0, ko: 0, shots: 0, left: 0 });
    assert.equal(asked.length, 0);
    assert.deepEqual(await sync.tick({ dir, current, fetchImpl, settings: () => ({ on: true, art: true }), pauseMs: 0 }), { igdb: 0, ko: 0, shots: 1, left: 0 });
    assert.deepEqual(asked, ["https://images.launchbox-app.com/g.png"]);
  } finally {
    store.reset();
    sync.reset();
  }
});

const PORT = 21100 + (process.pid % 500);
const BASE = `http://127.0.0.1:${PORT}`;
// An approved console: the shop takes its keys, never a password.
const AUTH = CONSOLE;

async function boot(retroDir, dataDir) {
  fs.mkdirSync(path.join(dataDir, "games"), { recursive: true });
  await seedConsole(dataDir);
  const child = spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: { ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: dataDir, COOK_GAMES_DIR: path.join(dataDir, "games"), COOK_RETRO_DIR: retroDir,
      COOK_AUTH_USERS: "alice:alice-password", COOK_TITLEDB_AUTO_FETCH: "false", COOK_RATING_SYNC: "false", COOK_RETRO_META: "false" },
    stdio: "ignore",
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) return child;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill("SIGKILL");
  throw new Error("server did not start");
}

test("GET /api/retro/games/:id carries the saved details and serves the screenshots", async () => {
  const dir = tmp("retro-api-");
  const data = tmp("retro-api-data-");
  put(dir, "roms/snes/Chrono Trigger (USA).sfc", "CT");
  put(dir, "roms/snes/Unknown Game (Japan).sfc", "UG");
  put(dir, "screenshots/snes/Chrono Trigger (USA)/1.png", PNG);
  put(data, "retro-meta.json", JSON.stringify({ version: 1, builtAt: Date.now(), games: {
    "snes/Chrono Trigger (USA)": { source: "launchbox", description: { en: "Time travel." }, publisher: "Square", developer: "Square", releaseDate: 19950311, numberOfPlayers: 1, genres: ["RPG"], shots: ["https://images.launchbox-app.com/a.png"] },
  } }));
  const server = await boot(dir, data);
  try {
    const ct = await (await fetch(`${BASE}/api/retro/games/${gameId("snes", "Chrono Trigger (USA).sfc")}`, { headers: { ...AUTH, "Accept-Language": "ko-KR,ko;q=0.9" } })).json();
    assert.equal(ct.description, "Time travel.");
    assert.equal(ct.publisher, "Square");
    assert.equal(ct.developer, "Square");
    assert.equal(ct.releaseDate, 19950311);
    assert.equal(ct.numberOfPlayers, 1);
    assert.deepEqual(ct.genres, ["RPG"]);
    assert.equal(ct.screenshots.length, 1);
    const shot = await fetch(BASE + ct.screenshots[0], { headers: AUTH });
    assert.equal(shot.status, 200);
    assert.match(shot.headers.get("cache-control"), /immutable/);
    assert.ok(Buffer.from(await shot.arrayBuffer()).equals(PNG));
    const stale = await fetch(`${BASE}${ct.screenshots[0].replace(/v=\w+/, "v=000000000000")}`, { headers: AUTH });
    assert.match(stale.headers.get("cache-control"), /no-cache/);
    assert.equal((await fetch(`${BASE}/api/retro/games/${ct.id}/screenshot/9`, { headers: AUTH })).status, 404);
    const unknown = await (await fetch(`${BASE}/api/retro/games/${gameId("snes", "Unknown Game (Japan).sfc")}`, { headers: AUTH })).json();
    for (const k of ["description", "publisher", "developer", "releaseDate", "numberOfPlayers", "genres", "screenshots"]) assert.equal(k in unknown, false, `${k} is left out`);
  } finally {
    server.kill("SIGKILL");
  }
});

test("facets, fact filters and theme rows read the collected metadata", async () => {
  const dir = tmp("retro-themes-");
  const data = tmp("retro-themes-data-");
  const meta = {};
  for (let i = 0; i < 10; i++) {
    put(dir, `roms/snes/Quest ${i} (USA).sfc`, `Q${i}`);
    meta[`snes/Quest ${i} (USA)`] = { source: "launchbox", genres: ["RPG"], numberOfPlayers: i < 3 ? 2 : 1, releaseDate: 19950000 + i };
  }
  put(dir, "roms/snes/Puzzle (Japan).sfc", "P");
  meta["snes/Puzzle (Japan)"] = { source: "launchbox", genres: ["Puzzle"], releaseDate: 19880000 };
  // The RPGs came a year ago; ten other games came today.
  const yearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  for (let i = 0; i < 10; i++) fs.utimesSync(path.join(dir, `roms/snes/Quest ${i} (USA).sfc`), yearAgo, yearAgo);
  for (let i = 0; i < 10; i++) put(dir, `roms/snes/Fresh ${i} (USA).sfc`, `F${i}`);
  put(data, "retro-meta.json", JSON.stringify({ version: 2, builtAt: Date.now(), games: meta }));
  const server = await boot(dir, data);
  try {
    const facets = await (await fetch(`${BASE}/api/retro/systems/snes/facets`, { headers: { ...AUTH, "Accept-Language": "ko" } })).json();
    assert.equal(facets.total, 21);
    assert.deepEqual(facets.genres.map((g) => [g.key, g.count]), [["rpg", 10], ["puzzle", 1]]);
    assert.deepEqual(facets.players, [{ value: 2, count: 3 }]);
    assert.deepEqual(facets.decades, [{ value: 1980, count: 1 }, { value: 1990, count: 10 }]);
    assert.equal((await fetch(`${BASE}/api/retro/systems/nes/facets`, { headers: AUTH })).status, 404);
    const filters = await fetch(`${BASE}/api/retro/systems/snes/filters`, { headers: AUTH });
    const { groups, sorts } = await filters.json();
    assert.deepEqual(groups.find((g) => g.key === "genre").options.map((o) => [o.key, o.count]), [["rpg", 10], ["puzzle", 1]]);
    assert.ok(sorts.length >= 4);
    // fetch() adds "Cache-Control: no-cache" to a conditional request unless one is given; consoles send none.
    const again = await fetch(`${BASE}/api/retro/systems/snes/filters`, { headers: { ...AUTH, "Cache-Control": "max-age=0", "If-None-Match": filters.headers.get("etag") } });
    assert.equal(again.status, 304, "unchanged filters are not sent again");
    assert.equal((await fetch(`${BASE}/api/retro/systems/nes/filters`, { headers: AUTH })).status, 404);

    const two = await (await fetch(`${BASE}/api/retro/games?system=snes&genre=rpg&players=2`, { headers: AUTH })).json();
    assert.equal(two.total, 3);
    assert.deepEqual(two.games[0].genres, ["rpg"]);
    assert.equal(two.games[0].players, 2);
    assert.equal(two.games[0].year, 1995);
    assert.deepEqual(two.games[0].labels, [["year", "1995"], ["players", "2"]], "the card's labels in the order to draw them");
    assert.equal(two.labels.players.ko, "{0}인", "the list carries the label dictionary");
    assert.equal((await (await fetch(`${BASE}/api/retro/games?decade=1980`, { headers: AUTH })).json()).total, 1);

    const res = await fetch(`${BASE}/api/retro/themes?rows=6`, { headers: { ...AUTH, "Accept-Language": "ko" } });
    assert.equal(res.headers.get("cache-control"), "no-store");
    const { themes } = await res.json();
    assert.deepEqual(themes[0] && [themes[0].id, themes[0].name, themes[0].games.length], ["recent", "최근 추가", 11], "the ten that came today and the puzzle");
    assert.equal(themes.length, 2, "then one row of the RPGs; a game is in one row only");
    assert.ok(["genre:rpg", "decade:1990", "decade:1990:genre:rpg"].includes(themes[1].id), themes[1].id);
    assert.equal(themes[1].games.length, 10);
    assert.deepEqual(themes.map((t) => t.icon), ["clock", { "genre:rpg": "tag", "decade:1990": "calendar", "decade:1990:genre:rpg": "calendar" }[themes[1].id]]);
    const one = await (await fetch(`${BASE}/api/retro/themes?rows=1&limit=3`, { headers: AUTH })).json();
    assert.deepEqual(one.themes.map((t) => [t.id, t.games.length]), [["recent", 3]]);
  } finally {
    server.kill("SIGKILL");
  }
});

test("the activity line says what was gathered, for which systems, and what is left", async () => {
  const { systemNames, tickSummary } = await import("../../src/retro/meta/sync.js");
  const systems = { snes: { names: { ko: "슈퍼 패미컴" } }, gba: { names: { ko: "게임보이 어드밴스" } } };
  assert.equal(systemNames(["snes", "gba", "snes", "odd"], systems), "슈퍼 패미컴, 게임보이 어드밴스, odd");
  assert.equal(tickSummary({ igdb: 0, ko: 50, shots: 31, left: 2310 }), "한국어 설명 50개 · 스크린샷 31장 · 남은 2,310개");
  assert.equal(tickSummary({ igdb: 3, ko: 0, shots: 0 }), "IGDB 게임 정보 3개");
});
