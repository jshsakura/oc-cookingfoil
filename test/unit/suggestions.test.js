import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { find, readDiscFiles, gdiTracks, createKept } = await import("../../src/library/suggestions.js");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "suggestions-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const SYSTEMS = {
  ps1: { folder: "ps1", extensions: [".cue", ".bin", ".chd", ".m3u"], names: { ko: "플레이스테이션" } },
  megadrive: { folder: "megadrive", extensions: [".md", ".bin"], names: { ko: "메가 드라이브" } },
  snes: { folder: "snes", extensions: [".sfc"], names: { ko: "슈퍼 패미컴" } },
};
const game = (rel, titleId, version, kind = "base", extra = {}) => ({ rel, name: "Game", size: 10, titleId, baseTitleId: titleId.slice(0, 13) + "000", version, kind, ...extra });

test("one game and version as both nsp and nsz is a twin, and dropping the nsp is recommended", () => {
  const out = find({ games: [game("A/Game.nsp", "0100000000010000", 0), game("A/Game.nsz", "0100000000010000", 0), game("B/Other.nsp", "0100000000020000", 0), game("B/Other.nsz", "0100000000020000", 65536)] });
  assert.equal(out.length, 1);
  assert.equal(out[0].code, "twin");
  assert.deepEqual(out[0].drops, [{ ext: "nsp", rels: ["A/Game.nsp"], recommended: true }, { ext: "nsz", rels: ["A/Game.nsz"], recommended: false }]);
  assert.equal(out[0].vars.exts, "nsp, nsz");
});

test("an update older than the newest published is found once per game, from its newest file", () => {
  const latest = (base) => ({ "0100000000010000": 196608, "0100000000020000": 65536 })[base] ?? null;
  const out = find({
    latestVersion: latest,
    games: [
      game("A/u1.nsp", "0100000000010800", 65536, "update", { baseTitleId: "0100000000010000" }),
      game("A/u2.nsp", "0100000000010800", 131072, "update", { baseTitleId: "0100000000010000" }),
      game("B/u.nsp", "0100000000020800", 65536, "update", { baseTitleId: "0100000000020000" }),
      game("C/u.nsp", "0100000000030800", 65536, "update", { baseTitleId: "0100000000030000" }),
    ],
  });
  assert.deepEqual(out.map((f) => [f.code, f.files[0].rel, f.vars.have, f.vars.latest, f.drops.length]), [["oldUpdate", "A/u2.nsp", 131072, 196608, 0]]);
});

test("a disc list naming a missing file, and a track no list names in a disc console's folder, are found", () => {
  const out = find({
    systems: SYSTEMS,
    discFiles: [
      { rel: "roms/ps1/Good.cue", size: 1, refs: ["Good.bin"] },
      { rel: "roms/ps1/Good.bin", size: 2 },
      { rel: "roms/ps1/Broken.cue", size: 1, refs: ["Broken (Track 1).bin", "Broken (Track 2).bin"] },
      { rel: "roms/ps1/Broken (Track 1).bin", size: 2 },
      { rel: "roms/ps1/Lone.bin", size: 3 },
      { rel: "roms/ps1/Card.ccd", size: 1 },
      { rel: "roms/ps1/Card.img", size: 2 },
      { rel: "roms/megadrive/Sonic.bin", size: 4 },
    ],
  });
  assert.deepEqual(out.map((f) => [f.code, f.files[0].rel]), [["discMissing", "roms/ps1/Broken.cue"], ["discLone", "roms/ps1/Lone.bin"]]);
  assert.equal(out[0].vars.missing, "Broken (Track 2).bin");
  assert.deepEqual(out[1].drops, [{ ext: "bin", rels: ["roms/ps1/Lone.bin"], recommended: false }]);
});

test("games without box art come as one finding per console, listing their names", () => {
  const out = find({ systems: SYSTEMS, retroGames: [
    { system: "snes", rel: "B.sfc", name: "B", icon: null },
    { system: "snes", rel: "A.sfc", name: "A", icon: null },
    { system: "snes", rel: "C.sfc", name: "C", icon: "/x.png" },
  ] });
  assert.deepEqual(out.map((f) => [f.code, f.vars.n, f.vars.names, f.vars.system]), [["noCover", 2, "A, B", "슈퍼 패미컴"]]);
});

test("a finding's id stays while its files do, and changes with them", () => {
  const one = (size) => find({ games: [game("A/Game.nsp", "0100000000010000", 0, "base", { size }), game("A/Game.nsz", "0100000000010000", 0)] })[0].id;
  assert.equal(one(10), one(10));
  assert.notEqual(one(10), one(11));
});

test("the disc files under roms are read with what each list names", async () => {
  const dir = path.join(tmp, "retro");
  const put = (rel, body = "x") => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), body); };
  put("roms/ps1/Game/Game.cue", 'FILE "Game.bin" BINARY\n');
  put("roms/ps1/Game/Game.bin");
  put("roms/ps1/Game.sfc");
  put("roms/dc/Game.gdi", '2\n1 0 4 2352 track01.bin 0\n2 600 0 2352 "track 02.raw" 0\n');
  put("thumbnails/ps1/Lone.bin");
  const out = await readDiscFiles(dir);
  assert.deepEqual(out.map((f) => [f.rel, f.refs]).sort(), [
    ["roms/dc/Game.gdi", ["track01.bin", "track 02.raw"]],
    ["roms/ps1/Game/Game.bin", undefined],
    ["roms/ps1/Game/Game.cue", ["Game.bin"]],
  ]);
  assert.deepEqual(gdiTracks("1\n1 0 4 2352 ../x.bin 0\n"), []);
});

test("kept ids are remembered in the file", async () => {
  const kept = createKept(path.join(tmp, "kept", "suggestions-kept.json"));
  assert.equal((await kept.read()).size, 0);
  await kept.add("abc");
  await kept.add("abc");
  assert.deepEqual([...(await kept.read())], ["abc"]);
});
