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
