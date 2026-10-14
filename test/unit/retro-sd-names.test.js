import { test } from "node:test";
import assert from "node:assert/strict";
import { asciiOnly, assignSdNames, rewriteCue, sdStem, tagsOf, withoutTags, NAME_MAX } from "../../src/retro/sd-names.js";

const ZELDA = "젤다의 전설 1 - 하이랄 판타지 (Zelda no Densetsu 1 - The Hyrule Fantasy) [J-K v20230715 v1 font.galmuri]";

test("an SD name is the English title, ASCII only, tags gone", () => {
  assert.equal(sdStem(ZELDA), "Zelda no Densetsu 1 - The Hyrule Fantasy");
  assert.equal(sdStem("록맨 X (Rockman X (Japan)) [J-K]"), "Rockman X (Japan)", "nested parentheses stay");
  assert.equal(sdStem("Super Mario World (USA)"), "Super Mario World (USA)", "an ASCII name keeps its region");
  assert.equal(sdStem("Pokémon Gold & Silver: Crystal!"), "Pokemon Gold and Silver Crystal");
  assert.equal(sdStem("한글만 있는 이름"), "", "nothing ASCII is left");
  assert.ok(sdStem("A".repeat(200)).length <= NAME_MAX - 22);
  assert.equal(asciiOnly("a/b\\c:d"), "a b c d");
});

test("display names lose their tags, which stay available as the variant", () => {
  assert.equal(withoutTags(ZELDA), "젤다의 전설 1 - 하이랄 판타지 (Zelda no Densetsu 1 - The Hyrule Fantasy)");
  assert.equal(tagsOf(ZELDA), "J-K v20230715 v1 font.galmuri");
  assert.equal(tagsOf("Super Mario World (USA)"), null);
});

test("a cue names its tracks by their new names", () => {
  const cue = 'FILE "Game (Track 1).bin" BINARY\n  TRACK 01 MODE2/2352\nFILE Track2.bin BINARY\n';
  const out = rewriteCue(cue, new Map([["Game (Track 1).bin", "X (Track 1).bin"], ["Track2.bin", "X (Track 2).bin"]]));
  assert.equal(out, 'FILE "X (Track 1).bin" BINARY\n  TRACK 01 MODE2/2352\nFILE "X (Track 2).bin" BINARY\n');
});

test("patch variants of one game get distinct names; a disc set's playlist follows its discs", async () => {
  const games = [
    { id: "nes-aaaaaa0001", system: "nes", name: `${ZELDA}`, rel: "z1.zip", extras: [] },
    { id: "nes-bbbbbb0002", system: "nes", name: "젤다의 전설 1 - 하이랄 판타지 (Zelda no Densetsu 1 - The Hyrule Fantasy) [J-K v1]", rel: "z2.zip", extras: [] },
    {
      id: "ps1-cccccc0003", system: "ps1", name: "제노기어스 (Xenogears) [K]", rel: "Xeno.m3u", abs: null,
      m3u: "Xeno (Disc 1).chd\nXeno (Disc 2).chd\n",
      extras: [{ rel: "Xeno (Disc 1).chd", abs: "/x/1" }, { rel: "Xeno (Disc 2).chd", abs: "/x/2" }],
    },
  ];
  await assignSdNames(games, async () => "");
  assert.equal(games[0].sd.rom, "roms/nes/Zelda no Densetsu 1 - The Hyrule Fantasy.zip");
  assert.equal(games[1].sd.rom, "roms/nes/Zelda no Densetsu 1 - The Hyrule Fantasy (bb0002).zip");
  assert.equal(games[2].sd.rom, "roms/ps1/Xenogears.m3u");
  assert.equal(games[2].sd.romText, "Xenogears (Disc 1).chd\nXenogears (Disc 2).chd\n");
  assert.equal(games[2].sd.extras.get("Xeno (Disc 2).chd").sd, "roms/ps1/Xenogears (Disc 2).chd");
  for (const g of games) assert.ok(/^[\x20-\x7e]+$/.test(g.sd.rom) && g.sd.rom.split("/").at(-1).length <= NAME_MAX);
});

test("a file whose name has nothing ASCII left gets a name from its game, and a Korean arcade set falls back too", async () => {
  const games = [
    { id: "gba-aaaaaa0001", system: "gba", name: "Golden Sun", rel: "gs.gba", extras: [{ rel: "설명서", abs: "/x/1" }, { rel: "자료.sav", abs: "/x/2" }, { rel: "map.png", abs: "/x/3" }] },
    { id: "arcade-bbbbbb0002", system: "arcade", name: "Street Fighter II", rel: "스트리트파이터.zip", keepFileName: true, extras: [] },
  ];
  await assignSdNames(games, async () => "");
  const sd = [...games[0].sd.extras.values()].map((x) => x.sd);
  assert.deepEqual(sd, ["roms/gba/Golden Sun (extra 1)", "roms/gba/Golden Sun (extra 2).sav", "roms/gba/map.png"]);
  assert.equal(games[1].sd.rom, "roms/arcade/Street Fighter II.zip");
  for (const g of games) for (const p of [g.sd.rom, ...[...g.sd.extras.values()].map((x) => x.sd)]) assert.ok(/^[\x20-\x7e]+$/.test(p), p);
});
