import { test } from "node:test";
import assert from "node:assert/strict";

const sc = await import("../../src/retro/shortcut.js");

const game = (over = {}) => ({
  id: "snes-0123456789",
  name: "슈퍼 마리오 월드 (Super Mario World) [K v1.0]",
  core: "snes9x",
  romSdPath: "roms/snes/슈퍼 마리오 월드 (Super Mario World) [K v1.0].sfc",
  artKey: "aaaaaaaaaaaa",
  publisher: "RetroArch · 슈퍼 패미컴 (SNES)",
  ...over,
});

test("title IDs stay what they were when the server packed the shortcuts: clients recognise installed ones by them", () => {
  // Pinned from the code that built the NSPs. Changing the formula strands every installed shortcut.
  assert.equal(sc.shortcutTitleId("snes-0123456789"), "05961FDFAB761000");
  assert.equal(sc.shortcutTitleId("snes-1"), "059D3F23F3926000");
  assert.equal(sc.shortcutTitleId("homebrew-checkpoint"), "05D8F9440C748000");
  assert.equal(sc.shortcutTitleId("cookingfoil-client"), "0512BCE4CF34D000");
});

test("a shortcut's title ID is fixed, in the 05 range, and ends in 000", () => {
  const id = sc.shortcutTitleId("snes-0123456789");
  assert.match(id, /^05[0-9A-F]{11}000$/);
  assert.equal(sc.shortcutTitleId("snes-0123456789"), id, "same game, same ID: a reinstall replaces it");
  assert.notEqual(sc.shortcutTitleId("snes-0123456780"), id);
});

test("the HOME menu name is the Korean title without the English name or patch tags", () => {
  assert.equal(sc.displayName("슈퍼 마리오 월드 (Super Mario World) [K v1.0]"), "슈퍼 마리오 월드");
  assert.equal(sc.displayName("록맨 X (Rockman X (Japan)) [J-K]"), "록맨 X");
  assert.equal(sc.displayName("Xenogears KOR"), "Xenogears KOR");
  assert.equal(sc.displayName("(Only English) [K]"), "(Only English)", "nothing before the parentheses keeps them");
});

test("the shortcut starts the game's core with the bundle's ROM path", () => {
  assert.deepEqual(sc.launchTarget("snes9x", "roms/snes/a b.sfc"), {
    nroPath: "sdmc:/retroarch/cores/snes9x_libretro_libnx.nro",
    argv: 'sdmc:/retroarch/cores/snes9x_libretro_libnx.nro "sdmc:/roms/snes/a b.sfc"',
  });
  assert.equal(sc.launchTarget("snes9x", 'roms/snes/a"b.sfc'), null, "a quote would break argv");
  assert.equal(sc.launchTarget("snes9x", "roms/../x.sfc"), null);
  assert.equal(sc.launchTarget("", "roms/snes/a.sfc"), null);
});

test("the shortcut's key moves with the cores, cover and name but not with its title ID", () => {
  const plain = sc.shortcutSpec(game());
  assert.match(plain.key, /^[0-9a-f]{12}$/);
  assert.equal(sc.shortcutSpec(game({ cores: 3 })).key, plain.key, "3 cores is the default");
  const quad = sc.shortcutSpec(game({ cores: 4 }));
  assert.notEqual(quad.key, plain.key);
  assert.equal(quad.titleId, plain.titleId, "same title: installing it replaces the other");
  assert.notEqual(sc.shortcutSpec(game({ artKey: "bbbbbbbbbbbb" })).key, plain.key);
  assert.equal(sc.shortcutSpec(game({ core: "" })), null, "a game without a core has no shortcut");
});
