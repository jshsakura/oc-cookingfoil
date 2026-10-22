import { test } from "node:test";
import assert from "node:assert/strict";
import { guessUpload } from "../../src/routes/admin/upload-guess.js";

const SYSTEMS = [
  { id: "snes", extensions: [".sfc", ".smc", ".zip"] },
  { id: "psx", extensions: [".cue", ".bin", ".chd"] },
  { id: "md", extensions: [".md", ".bin", ".gen"] },
];
const guess = (o) => guessUpload({ systems: SYSTEMS, ...o });

test("packages and a lone .nro say what they are by name", () => {
  assert.deepEqual(guess({ names: ["Game [0100000000010000][v0].nsz", "Other.xci"] }), { kind: "game" });
  assert.deepEqual(guess({ names: ["app.nro"] }), { kind: "homebrew" });
  assert.deepEqual(guess({ names: ["cookingfoil.nro"] }), { kind: "client" }, "the client build itself");
  assert.deepEqual(guess({ names: ["CookingFoil-0.3.61.nro"] }), { kind: "client" });
  assert.deepEqual(guess({ names: [] }), { kind: null });
});

test("a patch zip names its game, filed under the base title id", () => {
  const g = guess({ names: ["60fps.zip"], zipNames: ["atmosphere/", "atmosphere/contents/0100F2C0115B6801/exefs/main.npdm"] });
  assert.deepEqual(g, { kind: "patch", titleId: "0100F2C0115B6000", name: "60fps" });
});

test("a folder is a patch, a homebrew app or else a save", () => {
  assert.equal(guess({ names: ["a", "b"], paths: ["KoPatch/atmosphere/contents/0100152000022000/romfs/a", "KoPatch/x"] }).kind, "patch");
  assert.deepEqual(guess({ names: ["x.nro"], paths: ["Port/switch/port/x.nro"] }), { kind: "homebrew", name: "Port" });
  assert.deepEqual(guess({ names: ["userdata.dat"], paths: ["MK8 save/userdata.dat"] }), { kind: "save", name: "MK8 save" });
});

test("a zip that can't be read or says nothing leaves the kind to the admin", () => {
  assert.deepEqual(guess({ names: ["thing.zip"], zipNames: null }), { kind: "retro", systems: ["snes"] }, "a lone zip with no listing is a ROM zip");
  assert.deepEqual(guess({ names: ["thing.zip"], zipNames: ["save.dat"] }), { kind: null, name: "thing" });
  assert.deepEqual(guess({ names: ["Mario.zip"], zipNames: ["Mario.sfc"] }), { kind: "retro", systems: ["snes"] }, "a zipped ROM");
});

test("retro ROMs pick the consoles their extension fits", () => {
  assert.deepEqual(guess({ names: ["Mario.sfc"] }), { kind: "retro", systems: ["snes"] });
  assert.deepEqual(guess({ names: ["Game.cue", "Game.bin"] }), { kind: "retro", systems: ["psx"] }, "the .cue says PlayStation");
  assert.deepEqual(guess({ names: ["Sonic.bin"] }), { kind: "retro", systems: ["psx", "md"] }, "shared extension: the admin checks");
  assert.deepEqual(guess({ names: ["readme.txt"] }), { kind: null });
});

test("loose files of different kinds are not guessed as one", () => {
  assert.deepEqual(guess({ names: ["Game.nsp", "Mario.sfc"] }), { kind: null, mixed: true }, "a package next to a ROM");
  assert.deepEqual(guess({ names: ["app.nro", "Mario.sfc"] }), { kind: null, mixed: true }, "an app next to a ROM");
  assert.deepEqual(guess({ names: ["Mario.sfc", "Zelda.sfc"] }), { kind: "retro", systems: ["snes"] }, "the same kind stays one guess");
  assert.deepEqual(guess({ names: ["a.nsp", "b.xci"] }), { kind: "game" }, "packages of two formats are still packages");
});

test("a file the names cannot place is left unknown, never given a kind", () => {
  assert.deepEqual(guess({ names: ["notes.txt"] }), { kind: null });
  assert.deepEqual(guess({ names: ["photo.png", "readme.md"] }), { kind: null });
});
