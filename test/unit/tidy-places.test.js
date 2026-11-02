import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { createPlaceTidy, moveArtKey, planHomebrew, planRetro, planTitled, retroFollowers } = await import("../../src/library/tidy-places.js");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tidy-places-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
let n = 0;

const SYSTEMS = {
  snes: { folder: "snes", extensions: [".sfc", ".smc"] },
  gba: { folder: "gba", extensions: [".gba"] },
  arcade: { folder: "arcade", extensions: [".zip"] },
  nes: { folder: "nes", extensions: [".nes", ".zip"] },
  ps1: { folder: "ps1", extensions: [".cue", ".bin", ".chd"] },
};
const files = (...rels) => rels.map((rel) => ({ rel, dir: false }));
const dirs = (...rels) => rels.map((rel) => ({ rel, dir: true }));

test("retro: a ROM out of place goes to the one console that plays it; one that fits stays", () => {
  const out = planRetro(files(
    "roms/snes/Fits.sfc",
    "roms/snes/Folder/Fits too.sfc",
    "Loose.sfc",
    "roms/gba/Wrong.sfc",
    "roms/snes/a/b/Deep.sfc",
    "new/Game.gba",
    "thumbnails/snes/Named_Boxarts/Cover.sfc",
    "notes.txt",
  ), SYSTEMS);
  assert.deepEqual(out.moves, [
    { from: "Loose.sfc", to: "roms/snes/Loose.sfc" },
    { from: "roms/gba/Wrong.sfc", to: "roms/snes/Wrong.sfc", follow: { from: { id: "gba", folder: "gba" }, to: { id: "snes", folder: "snes" }, name: "Wrong" } },
    { from: "roms/snes/a/b/Deep.sfc", to: "roms/snes/Deep.sfc" },
    { from: "new/Game.gba", to: "roms/gba/Game.gba" },
  ]);
  assert.deepEqual(out.held, []);
});

test("retro: an extension several consoles play, and a disc set's files, stay with their reason", () => {
  const out = planRetro(files("Game.zip", "Disc.cue", "roms/ps1/x/y/Disc.bin", "Game.chd"), SYSTEMS);
  assert.deepEqual(out.moves, [{ from: "Game.chd", to: "roms/ps1/Game.chd" }]);
  assert.deepEqual(out.held, [
    { rel: "Game.zip", code: "tidy.retroExt", vars: { ext: ".zip" } },
    { rel: "Disc.cue", code: "tidy.retroDisc" },
    { rel: "roms/ps1/x/y/Disc.bin", code: "tidy.retroDisc" },
  ]);
});

test("homebrew: a loose .nro gets a folder named after it; other loose files stay", () => {
  const out = planHomebrew([...files("My App!.nro", "readme.txt", "Tool/Tool.nro"), ...dirs("Tool")]);
  assert.deepEqual(out.moves, [{ from: "My App!.nro", to: "My-App/My App!.nro" }]);
  assert.deepEqual(out.held, [{ rel: "readme.txt", code: "tidy.looseFile" }]);
});

test("patches: a folder names its game by [id] or by the contents/ inside it, and goes under the base game's id", () => {
  const out = planTitled([
    ...dirs("60 FPS [0100000000010000]", "HD", "Mystery", "atmosphere", "0100000000010000", "homebrew"),
    ...files("HD/atmosphere/contents/0100000000020800/romfs/a.bin", "Mystery/readme.txt", "loose.txt", "0100000000010000/stray.txt"),
  ], "patches");
  assert.deepEqual(out.moves, [
    { from: "60 FPS [0100000000010000]", to: "0100000000010000/60 FPS" },
    { from: "HD", to: "0100000000020000/HD" },
  ]);
  assert.deepEqual(out.held.map((h) => [h.rel, h.code]), [
    ["Mystery", "tidy.noTitle"],
    ["atmosphere", "tidy.sdLayout"],
    ["loose.txt", "tidy.looseFile"],
    ["0100000000010000/stray.txt", "tidy.looseFile"],
  ]);
});

test("saves: only a folder's name tells its game", () => {
  const out = planTitled([...dirs("0100000000010000 All unlocked", "Mystery"), ...files("Mystery/atmosphere/contents/0100000000010000/x")], "saves");
  assert.deepEqual(out.moves, [{ from: "0100000000010000 All unlocked", to: "0100000000010000/All unlocked" }]);
  assert.deepEqual(out.held.map((h) => h.code), ["tidy.noTitle"]);
});

function setup(key) {
  const dir = path.join(tmp, String(n++));
  fs.mkdirSync(dir, { recursive: true });
  const put = (rel) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), rel);
  };
  const walk = (rel, out) => {
    const abs = path.join(dir, rel);
    const isDir = fs.statSync(abs).isDirectory();
    out.push({ rel, dir: isDir });
    if (isDir) for (const name of fs.readdirSync(abs)) walk(rel ? `${rel}/${name}` : name, out);
    return out;
  };
  const collect = async (rels) => rels.flatMap((rel) => (rel ? walk(rel, []) : fs.readdirSync(dir).flatMap((name) => walk(name, []))));
  const lines = [];
  const journal = async (line) => (lines.push(line), { id: `j${lines.length}` });
  let rescans = 0;
  const tidy = createPlaceTidy({
    root: () => ({ key, dir }), collect, journal, rescan: () => rescans++,
    planner: (entries) => planRetro(entries, SYSTEMS), followers: retroFollowers(dir),
    keep: (d) => d === "roms" || /^roms\/[^/]+$/.test(d) || ["thumbnails", "bezels", "art-map"].includes(d.split("/")[0]),
  });
  return { dir, put, tidy, lines, rescans: () => rescans };
}

test("a tidy shows its moves first, holds what would land on a taken name, and carries out only what the preview showed", async () => {
  const { dir, put, tidy, lines, rescans } = setup("retro");
  put("new/One.sfc");
  put("new/Two.gba");
  put("Taken.sfc");
  put("roms/snes/Taken.sfc");
  put("roms/gba/Only.sfc");
  const plan = await tidy.plan([""], "ko");
  assert.equal(plan.root, "retro");
  assert.deepEqual(plan.moves.map((m) => m.from).sort(), ["new/One.sfc", "new/Two.gba", "roms/gba/Only.sfc"]);
  assert.deepEqual(plan.held.map((h) => [h.rel, h.code]), [["Taken.sfc", "tidy.exists"]]);
  assert.match(plan.held[0].reason, /roms\/snes\/Taken\.sfc 에 같은 이름이 이미 있어/);

  const out = await tidy.apply([""], plan.moves.filter((m) => m.from !== "new/Two.gba"), { by: "admin" });
  assert.deepEqual(out.moved.map((m) => m.to).sort(), ["roms/snes/One.sfc", "roms/snes/Only.sfc"]);
  assert.ok(fs.existsSync(path.join(dir, "new/Two.gba")), "a move the run did not accept stays");
  assert.ok(fs.existsSync(path.join(dir, "roms/gba")), "a console's folder stays even when a tidy empties it");
  assert.equal(lines.length, 2, "every move is journaled for undo");
  assert.deepEqual(out.moved.map((m) => m.undo), ["j1", "j2"]);
  assert.equal(rescans(), 1);
});

test("a folder a tidy empties goes, unless it is a console's folder", async () => {
  const { dir, put, tidy } = setup("retro");
  put("new/deeper/One.sfc");
  const plan = await tidy.plan(["new"]);
  await tidy.apply(["new"], plan.moves);
  assert.ok(!fs.existsSync(path.join(dir, "new")));
  assert.ok(fs.existsSync(path.join(dir, "roms/snes/One.sfc")));
});

const readJson = (dir, rel) => JSON.parse(fs.readFileSync(path.join(dir, rel), "utf8"));

test("a ROM that changes console takes its box art, bezel files and art-map key, each move journaled", async () => {
  const { dir, put, tidy, lines } = setup("retro");
  put("roms/gba/Wrong.sfc");
  put("thumbnails/gba/Named_Boxarts/Wrong.png");
  put("bezels/gba/Wrong.png");
  put("bezels/gba/Wrong_override.cfg");
  put("thumbnails/gba/Named_Boxarts/Other.png");
  fs.mkdirSync(path.join(dir, "art-map"));
  fs.writeFileSync(path.join(dir, "art-map/gba.json"), JSON.stringify({ Wrong: "Wrong (USA)", Other: "Other (USA)" }));

  const plan = await tidy.plan(["roms"]);
  assert.equal(plan.moves.length, 1);
  assert.deepEqual(plan.moves[0].art.map((a) => a.to), ["thumbnails/snes/Named_Boxarts/Wrong.png", "bezels/snes/Wrong.png", "bezels/snes/Wrong_override.cfg"]);
  assert.deepEqual(plan.moves[0].key, { from: "art-map/gba.json", to: "art-map/snes.json", name: "Wrong" });

  const out = await tidy.apply(["roms"], plan.moves);
  assert.deepEqual(out.moved.map((m) => [m.to, Boolean(m.art)]), [
    ["roms/snes/Wrong.sfc", false],
    ["thumbnails/snes/Named_Boxarts/Wrong.png", true],
    ["bezels/snes/Wrong.png", true],
    ["bezels/snes/Wrong_override.cfg", true],
  ]);
  for (const rel of ["roms/snes/Wrong.sfc", "thumbnails/snes/Named_Boxarts/Wrong.png", "bezels/snes/Wrong_override.cfg", "thumbnails/gba/Named_Boxarts/Other.png"]) {
    assert.ok(fs.existsSync(path.join(dir, rel)), rel);
  }
  assert.ok(!fs.existsSync(path.join(dir, "bezels/gba/Wrong.png")));
  assert.ok(fs.existsSync(path.join(dir, "bezels/gba")), "the old console's art folder stays");
  assert.deepEqual(readJson(dir, "art-map/gba.json"), { Other: "Other (USA)" });
  assert.deepEqual(readJson(dir, "art-map/snes.json"), { Wrong: "Wrong (USA)" });
  assert.equal(lines.length, 4);
  assert.deepEqual(lines[0].extra, { rewrite: { type: "art-key", from: "art-map/gba.json", to: "art-map/snes.json", name: "Wrong" } });
});

test("a ROM whose art would land on a taken name stays, with its art", async () => {
  const { dir, put, tidy } = setup("retro");
  put("roms/gba/Wrong.sfc");
  put("thumbnails/gba/Named_Boxarts/Wrong.png");
  put("thumbnails/snes/Named_Boxarts/Wrong.png");
  const plan = await tidy.plan(["roms"], "ko");
  assert.deepEqual(plan.moves, []);
  assert.deepEqual(plan.held.map((h) => h.code), ["tidy.exists"]);
  assert.match(plan.held[0].reason, /thumbnails\/snes\/Named_Boxarts\/Wrong\.png/);
  assert.ok(fs.existsSync(path.join(dir, "roms/gba/Wrong.sfc")));
});

test("a ROM that only moves up inside its console's folder leaves its art where it is", async () => {
  const { put, tidy } = setup("retro");
  put("roms/snes/a/b/Deep.sfc");
  put("thumbnails/snes/Named_Boxarts/Deep.png");
  const plan = await tidy.plan(["roms"]);
  assert.deepEqual(plan.moves, [{ from: "roms/snes/a/b/Deep.sfc", to: "roms/snes/Deep.sfc" }]);
});

test("an art-map key moves only when the other map has none, and moves back the same way", async () => {
  const dir = path.join(tmp, String(n++));
  fs.mkdirSync(path.join(dir, "art-map"), { recursive: true });
  fs.writeFileSync(path.join(dir, "art-map/gba.json"), JSON.stringify({ A: "a" }));
  fs.writeFileSync(path.join(dir, "art-map/snes.json"), JSON.stringify({ B: "b" }));
  assert.equal(await moveArtKey(dir, { from: "art-map/gba.json", to: "art-map/snes.json", name: "A" }), true);
  assert.deepEqual(readJson(dir, "art-map/snes.json"), { B: "b", A: "a" });
  assert.equal(await moveArtKey(dir, { from: "art-map/gba.json", to: "art-map/snes.json", name: "A" }), false);
  fs.writeFileSync(path.join(dir, "art-map/gba.json"), JSON.stringify({ B: "keep" }));
  assert.equal(await moveArtKey(dir, { from: "art-map/snes.json", to: "art-map/gba.json", name: "B" }), false, "a key the other map has is never overwritten");
  assert.equal(await moveArtKey(dir, { from: "art-map/snes.json", to: "art-map/gba.json", name: "A" }), true);
  assert.deepEqual(readJson(dir, "art-map/gba.json"), { B: "keep", A: "a" });
  assert.deepEqual(readJson(dir, "art-map/snes.json"), { B: "b" });
});
