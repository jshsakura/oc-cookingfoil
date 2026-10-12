import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as art from "../../src/retro/art/sync.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const system = { folder: "Nintendo - Super Nintendo Entertainment System" };
const NAMES = ["Rockman X (Japan)", "Mega Man X (USA)", "Super Mario World (USA)", "Super Mario World 2 - Yoshi's Island (USA)"];
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

/** GitHub's tree API for one repo, then PNGs for any raw URL. */
function fakeNet(seen = []) {
  return async (url) => {
    seen.push(String(url));
    if (String(url).endsWith("/git/trees/HEAD")) return Response.json({ tree: [{ path: "Named_Boxarts", sha: "x" }] });
    if (String(url).endsWith("/git/trees/x")) return Response.json({ tree: NAMES.map((n) => ({ path: `${n}.png` })) });
    if (String(url).includes("GameBezels")) return new Response("", { status: 404 });
    return new Response(PNG);
  };
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "retro-art-"));

test("unmapped ROMs are matched by their English title; ones set by hand, even to none, are left alone", async () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, "art-map"));
  fs.writeFileSync(path.join(dir, "art-map", "snes.json"), JSON.stringify({ "록맨 X (Rockman X) [K]": null }));
  const r = await art.matchSystem(dir, "snes", system, ["슈퍼 마리오 월드 (Super Mario World) [K]", "록맨 X (Rockman X) [K]", "없는 게임 (Nothing Like It)"], { fetchImpl: fakeNet() });
  assert.deepEqual(r, { matched: ["슈퍼 마리오 월드 (Super Mario World) [K]"], missed: ["없는 게임 (Nothing Like It)"] });
  assert.deepEqual(art.readMap(dir, "snes"), { "록맨 X (Rockman X) [K]": null, "슈퍼 마리오 월드 (Super Mario World) [K]": "Super Mario World (USA)" });
});

test("candidates put the same title first, then names holding every word", async () => {
  const names = await art.candidates("snes-c", system, "super mario world", { fetchImpl: fakeNet() });
  assert.deepEqual(names, ["Super Mario World (USA)", "Super Mario World 2 - Yoshi's Island (USA)"]);
  assert.deepEqual(await art.candidates("snes-c", system, "  ", { fetchImpl: fakeNet() }), []);
});

test("a hand match replaces the box art; null removes it and keeps it out of automatic matching", async () => {
  const dir = tmp();
  const rom = "록맨 X (Rockman X) [K]";
  fs.mkdirSync(path.dirname(art.boxartPath(dir, system, rom)), { recursive: true });
  fs.writeFileSync(art.boxartPath(dir, system, rom), "old");
  const seen = [];
  globalThis.fetch = fakeNet(seen);
  const r = await art.applyMatch(dir, "snes", system, rom, "Rockman X (Japan)");
  assert.equal(r.boxart, "ok");
  assert.deepEqual(fs.readFileSync(art.boxartPath(dir, system, rom)), PNG);
  assert.ok(seen.some((u) => u.includes("Named_Boxarts/Rockman%20X%20(Japan).png")));
  await art.applyMatch(dir, "snes", system, rom, null);
  assert.equal(fs.existsSync(art.boxartPath(dir, system, rom)), false);
  assert.equal(art.readMap(dir, "snes")[rom], null);
});

test("covers are taken only from SteamGridDB's image host", async () => {
  const dir = tmp();
  await assert.rejects(art.saveCover(dir, system, "x", "https://evil.example/a.png", { fetchImpl: fakeNet() }), /SteamGridDB/);
  await assert.rejects(art.saveCover(dir, system, "x", "file:///etc/passwd", { fetchImpl: fakeNet() }), /SteamGridDB/);
});

test("a bezel falls back to the same title from another region, then gives way to the system default", () => {
  const sources = [["bezelproject-SFC", "SFC"], ["bezelproject-SNES", "SNES"]];
  const indexes = new Map([
    ["bezelproject-SFC", new Map([["SFC", new Set(["Rockman X (Japan)"])]])],
    ["bezelproject-SNES", new Map([["SNES", new Set(["Mega Man X (USA)", "Super Mario World (USA)"])]])],
  ]);
  assert.match(art.bezelUrl(sources, indexes, "Rockman X (Japan)"), /bezelproject-SFC\/master\/.*Rockman%20X%20\(Japan\)\.png$/);
  assert.match(art.bezelUrl(sources, indexes, "Super Mario World (Japan)"), /bezelproject-SNES\/.*Super%20Mario%20World%20\(USA\)\.png$/, "another region of the same title");
  assert.equal(art.bezelUrl(sources, indexes, "Nothing Like It (Japan)"), null, "nothing close: the server's default bezel applies");
});

test("arcade bezels go by set name, falling back to the parent set's", () => {
  const dir = tmp();
  const indexes = new Map([["bezelproject-MAME", new Map([["ArcadeBezels", new Set(["mslug", "samsho2"])]])]]);
  const parents = { samsho2k: "samsho2", mslugx: null, rbff2k: "rbff2" };
  const jobs = art.arcadeBezelJobs(dir, { folder: "FBNeo - Arcade Games" }, ["mslug", "samsho2k", "mslugx", "rbff2k"], indexes, (s) => parents[s] ?? null, true);
  assert.equal(jobs.length, 2, "mslug itself and samsho2k through samsho2; the rest keep the default bezel");
});

test("LaunchBox ratings: same platform, enough votes, and no guessing between different games", async () => {
  const { Readable } = await import("node:stream");
  const { buildRatings, readLaunchBox } = await import("../../src/retro/art/ratings.js");
  const dir = tmp();
  fs.mkdirSync(path.join(dir, "art-map"));
  fs.writeFileSync(path.join(dir, "art-map", "snes.json"), JSON.stringify({ a: "Super Mario World (USA)", b: "Rockman X (Japan)", c: "Twin (USA)", d: null }));
  const game = (id, name, rating, count, platform = "Super Nintendo Entertainment System") =>
    `<Game>\n<Name>${name}</Name>\n<DatabaseID>${id}</DatabaseID>\n<Platform>${platform}</Platform>\n<CommunityRating>${rating}</CommunityRating>\n<CommunityRatingCount>${count}</CommunityRatingCount>\n</Game>`;
  const xml = [
    "<LaunchBox>",
    game(1, "Super Mario World", 4.5, 120),
    game(2, "Mega Man X", 4.25, 80),
    "<GameAlternateName>\n<AlternateName>Rockman X</AlternateName>\n<DatabaseID>2</DatabaseID>\n</GameAlternateName>",
    game(3, "Twin", 4, 10), game(4, "Twin", 2, 10),
    game(5, "Super Mario World", 1, 1, "Nintendo 64"),
    "</LaunchBox>",
  ].join("\n");
  const data = await readLaunchBox(Readable.from([xml]), new Set(["Super Nintendo Entertainment System", "Nintendo 64"]));
  const { ratings, summary } = buildRatings(dir, data);
  assert.deepEqual(ratings, { snes: { a: { rating: 90, count: 120 }, b: { rating: 85, count: 80 } } });
  assert.equal(summary.snes, "2/3");
});
