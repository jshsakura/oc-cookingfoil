import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import * as art from "../../src/retro/art/sync.js";
import { autoArt, pendingArt } from "../../src/retro/art/auto.js";
import { looseKey, titleMatcher } from "../../src/retro/art/titles.js";
import { useKoreanNames } from "../../src/retro/ko-names.js";

const system = { folder: "snes", libretro: "Nintendo - Super Nintendo Entertainment System" };
const SHA256 = "ab".repeat(32);
const NAMES = ["Example Quest (USA)", "Example Quest (Japan)", "Star Pilot - Into the Void (USA)", "Star Pilot - Into the Void (Japan)", "Twin Runner (USA)", "Twin Runner - Second Lap (USA)"];
const dirs = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "retro-art-auto-"));
  dirs.push(d);
  return d;
};
after(() => {
  useKoreanNames(null);
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

useKoreanNames({ systems: { snes: { [SHA256.slice(0, 32)]: ["가상 퀘스트", "Example Quest", "0a1b2c3d", ""] } } });

/** GitHub's tree API listing NAMES as libretro's box art. */
const fakeNames = async (url) => {
  if (String(url).endsWith("/git/trees/HEAD")) return Response.json({ tree: [{ path: "Named_Boxarts", sha: "x" }] });
  if (String(url).endsWith("/git/trees/x")) return Response.json({ tree: NAMES.map((n) => ({ path: `${n}.png` })) });
  return new Response("", { status: 404 });
};

test("a ROM named in Korean alone is matched by its content hash, before any title", () => {
  const m = titleMatcher(NAMES);
  assert.equal(art.matchRom("snes", "가상 퀘스트", { sha256: SHA256, crc32: "0a1b2c3d" }, m), "Example Quest (Japan)");
  assert.equal(art.matchRom("snes", "가상 퀘스트", null, m), null);
  assert.equal(art.matchRom("snes", "가상 퀘스트", { skip: "format" }, m), null);
});

test("matchSystem maps by hash first, then the English title, and remembers what it looked up", async () => {
  const dir = tmp();
  const roms = ["가상 퀘스트", "별 조종사 (Star Pilot: Into the Void) [K]", "모르는 게임"];
  const r = await art.matchSystem(dir, "snes", system, roms, { fetchImpl: fakeNames, rowOf: (rom) => (rom === "가상 퀘스트" ? { sha256: SHA256 } : null) });
  assert.deepEqual(r, { matched: roms.slice(0, 2), missed: ["모르는 게임"] });
  assert.deepEqual(art.readMap(dir, "snes"), { "가상 퀘스트": "Example Quest (Japan)", "별 조종사 (Star Pilot: Into the Void) [K]": "Star Pilot - Into the Void (Japan)" });
  assert.ok(art.wasMatched("snes", "모르는 게임"));
});

test("a loose title drops the subtitle and answers only when one game fits", () => {
  const m = titleMatcher(NAMES);
  assert.equal(looseKey("Star Pilot - Into the Void (USA)"), "star pilot");
  assert.equal(looseKey("Star Pilot_ Into the Void"), "star pilot");
  assert.equal(m.exact("Star Pilot"), null);
  assert.equal(m.loose("Star Pilot"), "Star Pilot - Into the Void (Japan)");
  assert.equal(m.loose("Star Pilot: Director's Cut"), "Star Pilot - Into the Void (Japan)");
  // Two different games share "Twin Runner": no guess.
  assert.equal(m.loose("Twin Runner: Final Lap"), null);
  assert.equal(art.matchRom("snes", "달리기 (Twin Runner: Final Lap)", null, m), null);
  assert.equal(art.matchRom("snes", "별 (Star Pilot)", null, m), "Star Pilot - Into the Void (Japan)");
});

const game = (name, extra = {}) => ({ system: "snes", name, rel: `${name}.sfc`, icon: null, ...extra });
const catalogOf = (dir, games) => ({ dir, systems: { snes: system, ws: { libretro: "Bandai - WonderSwan" } }, games });
const settle = async (auto) => {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 5));
    await auto.idle();
  }
};

test("only games without art, missing from the map and never tried, are pending", () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, "art-map"));
  fs.writeFileSync(path.join(dir, "art-map", "snes.json"), JSON.stringify({ "No Art": null, Mapped: "Example Quest (USA)" }));
  const state = catalogOf(dir, [game("New"), game("No Art"), game("Mapped"), game("Has Icon", { icon: "x.png" }), game("Tried"), { ...game("Swan"), system: "ws" }]);
  const pending = pendingArt(dir, state, new Set(["snes/Tried"]), () => false);
  assert.deepEqual(pending, [{ system: "snes", key: "snes/New" }]);
  assert.deepEqual(pendingArt(dir, state, new Set(), (id, rom) => rom === "New").map((p) => p.key), ["snes/Tried"]);
});

/** A start() like startArtSync's: its job ends with a rescan, as the real one does. */
function fakeStart(rescan) {
  const calls = [];
  const start = async (id) => {
    calls.push(id);
    return { job: {}, done: Promise.resolve().then(() => rescan()) };
  };
  return { calls, start };
}

test("new ROMs without art start one job after a burst of scans, and its own rescan starts nothing", async () => {
  const dir = tmp();
  let state = catalogOf(dir, [game("Alpha"), game("Beta")]);
  let auto;
  const { calls, start } = fakeStart(() => auto.onScan(state));
  auto = autoArt({ dir, start, enabled: () => true, delayMs: 1, attempted: () => false });
  auto.onScan(state);
  auto.onScan(state);
  auto.onScan(state);
  await settle(auto);
  assert.deepEqual(calls, ["snes"]);
  // Another folder's scan, and the same games again: nothing.
  auto.onScan({ ...state, dir: tmp() });
  auto.onScan(state);
  await settle(auto);
  assert.deepEqual(calls, ["snes"]);
  // A ROM put in later starts one more.
  state = catalogOf(dir, [game("Alpha"), game("Beta"), game("Gamma")]);
  auto.onScan(state);
  await settle(auto);
  assert.deepEqual(calls, ["snes", "snes"]);
});

test("switched off, scans start nothing", async () => {
  const dir = tmp();
  const { calls, start } = fakeStart(() => {});
  const auto = autoArt({ dir, start, enabled: () => false, delayMs: 1, attempted: () => false });
  auto.onScan(catalogOf(dir, [game("Alpha")]));
  await settle(auto);
  assert.deepEqual(calls, []);
});

test("when another job is running, the ROMs wait for that job's rescan instead of being given up", async () => {
  const dir = tmp();
  const state = catalogOf(dir, [game("Alpha")]);
  const calls = [];
  let busy = true;
  const start = async (id) => {
    calls.push(id);
    return busy ? { error: "busy", status: 409 } : { job: {}, done: Promise.resolve() };
  };
  const auto = autoArt({ dir, start, enabled: () => true, delayMs: 1, attempted: () => false });
  auto.onScan(state);
  await settle(auto);
  assert.deepEqual(calls, ["snes"]);
  busy = false;
  auto.onScan(state); // the other job's rescan
  await settle(auto);
  assert.deepEqual(calls, ["snes", "snes"]);
  auto.onScan(state);
  await settle(auto);
  assert.equal(calls.length, 2);
});

test("a SteamGridDB cover that redirects off SteamGridDB's image host is refused", async () => {
  const dir = tmp();
  const seen = [];
  const png = await sharp({ create: { width: 4, height: 6, channels: 3, background: "#123456" } }).png().toBuffer();
  const net = async (url, init) => {
    seen.push(String(url));
    assert.equal(init.redirect, "manual");
    if (String(url).includes("/away")) return new Response(null, { status: 302, headers: { location: "https://evil.example/a.png" } });
    if (String(url).includes("/moved")) return new Response(null, { status: 301, headers: { location: "https://cdn2.steamgriddb.com/grid/real.png" } });
    return new Response(png);
  };
  await assert.rejects(art.saveCover(dir, system, "Away", "https://cdn2.steamgriddb.com/grid/away.png", { fetchImpl: net }), /SteamGridDB/);
  await assert.rejects(art.fetchSgdbImage("https://cdn2.steamgriddb.com/grid/away.png", { fetchImpl: net }), /SteamGridDB/);
  assert.ok(!seen.some((u) => u.includes("evil.example")));
  assert.ok(!fs.existsSync(art.boxartPath(dir, system, "Away")));
  // A hop within its own host is followed.
  await art.saveCover(dir, system, "Moved", "https://cdn2.steamgriddb.com/grid/moved.png", { fetchImpl: net });
  assert.ok(fs.existsSync(art.boxartPath(dir, system, "Moved")));
});
