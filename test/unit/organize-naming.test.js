import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanName, nameFromFile, firstName, nameIn, gameFileName, freeFileName, isMeaningless, NAME_MAX_BYTES } from "../../src/meta/organize-naming.js";

const ID = "0100AAAA00010000";

test("a name is made safe for any filesystem and keeps its case", () => {
  assert.equal(cleanName("Zelda: Echoes of Wisdom"), "Zelda - Echoes of Wisdom");
  assert.equal(cleanName("A/B\\C*D?E\"F<G>H|I"), "ABCDEFGHI");
  assert.equal(cleanName("  ..My Game..  "), "My Game");
  assert.equal(cleanName("mIxEd CaSe"), "mIxEd CaSe");
  assert.equal(cleanName("e\u0301clair"), "\u00e9clair", "NFC");
  assert.equal(cleanName("  "), null);
  assert.equal(cleanName(null), null);
});

test("a name with a replacement character or a control character is no name at all", () => {
  assert.equal(cleanName("\uFFFD"), null);
  assert.equal(cleanName("Good \uFFFD Game"), null);
  assert.equal(cleanName("Tab\tGame"), null);
  assert.equal(cleanName("Nul\u0000Game"), null);
  assert.equal(cleanName("Esc\u001bGame"), null);
});

test("a long name is cut to the byte limit on a whole character", () => {
  const long = "가".repeat(200);
  const out = cleanName(long);
  assert.ok(Buffer.byteLength(out) <= NAME_MAX_BYTES);
  assert.ok(!out.includes("\uFFFD"));
  assert.equal(out, "가".repeat(Math.floor(NAME_MAX_BYTES / 3)));
  assert.equal(cleanName(`${"a".repeat(NAME_MAX_BYTES - 1)} .b`), "a".repeat(NAME_MAX_BYTES - 1), "no trailing space or dot after the cut");
});

test("site prefixes and release tags come off a file name", () => {
  assert.equal(nameFromFile(`[Example.com] Some Game [${ID}][v0].nsp`), "Some Game");
  assert.equal(nameFromFile("(www.example.org) Some Game (USA) (NSP).nsz"), "Some Game");
  assert.equal(nameFromFile("example.net - Some Game.xci"), "Some Game");
  assert.equal(nameFromFile("Some Game - example.com.nsp"), "Some Game");
  assert.equal(nameFromFile(`Some Game [UPD][${ID}][v65536][US][NSW].nsp`), "Some Game");
  assert.equal(nameFromFile("Some Game (Base) (eShop).nsp"), "Some Game");
  assert.equal(nameFromFile("Sequel (2) Deluxe.nsp"), "Sequel (2) Deluxe", "a title's own parentheses stay");
  assert.equal(nameFromFile(`\uFFFD [${ID}][v196608].nsz`), null);
  assert.equal(nameFromFile(`[${ID}][v0].nsp`), null);
  assert.equal(nameFromFile("dir/[Example.com] Game.nsp"), "Game", "only the base name counts");
});

test("the first usable candidate wins", () => {
  assert.equal(firstName([null, "", "\uFFFD", "Real"]), "Real");
  assert.equal(firstName([undefined, "  "]), null);
});

test("a title is taken in the first language of the priority it has", () => {
  assert.equal(nameIn({ en: "Game", ko: "게임" }, ["ko", "en", "ja"]), "게임");
  assert.equal(nameIn({ en: "Game", ja: "ゲーム" }, ["ko", "en-US", "ja"]), "Game");
  assert.equal(nameIn({ ja: "ゲーム" }, ["ko", "en"]), "ゲーム", "a language outside the list still beats nothing");
  assert.equal(nameIn({ ko: "\uFFFD", en: "Game" }, ["ko", "en"]), "Game", "a broken name is passed over");
  assert.equal(nameIn(null, ["ko"]), null);
});

test("a game file is named <name> [ID][vN].ext, with a number when the name is taken", () => {
  assert.equal(gameFileName("My Game", { titleId: ID, version: 0 }, ".nsz"), `My Game [${ID}][v0].nsz`);
  assert.equal(gameFileName("My Game", { titleId: ID, version: 65536 }, ".NSP", 2), `My Game (2) [${ID}][v65536].NSP`);
});

test("a taken file name, in any case, gets the next free number and is never reused", () => {
  const id = { titleId: ID, version: 0 };
  const taken = new Set([`g/my game [${ID.toLowerCase()}][v0].nsp`, `g/my game (2) [${ID.toLowerCase()}][v0].nsp`]);
  assert.equal(freeFileName("G", "My Game", id, ".nsp", (rel) => taken.has(rel.toLowerCase())), `G/My Game (3) [${ID}][v0].nsp`);
  assert.equal(freeFileName("G", "Fresh", id, ".nsp", () => false), `G/Fresh [${ID}][v0].nsp`);
  assert.equal(freeFileName("G", "Full", id, ".nsp", () => true), null, "after a few numbers it holds instead");
});

test("a browser's duplicate number at the end of a downloaded name comes off", () => {
  assert.equal(nameFromFile("Super Game (2).nsp"), "Super Game");
  assert.equal(nameFromFile("Super Game (Base) (USA) (1).nsz"), "Super Game");
  assert.equal(nameFromFile("nsw2u.com - Super Game (2).nsp"), "Super Game");
  assert.equal(nameFromFile("Sequel (2) Deluxe.nsp"), "Sequel (2) Deluxe", "a number inside the title stays");
  assert.equal(nameFromFile("Game (12).nsp"), "Game (12)", "only a single digit is a duplicate number");
});

test("a scene name's dots between words become spaces when the name has no spaces", () => {
  assert.equal(nameFromFile("Super.Mario.Odyssey.NSW-BigBlueBox.nsp"), "Super Mario Odyssey NSW-BigBlueBox");
  assert.equal(nameFromFile(`Cool.Game.[${ID}][v0].nsp`), "Cool Game");
  assert.equal(nameFromFile("Mr. Driller DrillLand.nsp"), "Mr. Driller DrillLand", "a name with spaces keeps its dots");
});

test("a Windows device name is refused with or without an extension, and in the stem", () => {
  for (const bad of ["con", "AUX", "aux.txt", "Nul.tar.gz", "com1.nsp", "LPT9.x", "aux .txt", "CONIN$", "conout$"]) {
    assert.equal(cleanName(bad), null, bad);
  }
  assert.equal(nameFromFile("aux.nsp"), null);
  assert.equal(nameFromFile("aux.txt.nsp"), "aux txt", "a scene name's dots become spaces first, which Windows takes");
  assert.equal(cleanName("Auxiliary"), "Auxiliary");
  assert.equal(cleanName("Console Wars"), "Console Wars");
});

test("bidi and zero-width characters are taken out of a name", () => {
  assert.equal(cleanName("Name\u202Ertl"), "Namertl");
  assert.equal(cleanName("⁦Game⁩"), "Game");
  assert.equal(cleanName("Zero​width﻿"), "Zerowidth");
  assert.equal(cleanName("Mark‏‎؜"), "Mark");
  assert.equal(nameFromFile(`Evil\u202Evsn.exe [${ID}][v0].nsp`), "Evilvsn exe", "its dots become spaces too");
  assert.equal(cleanName("\u202E​"), null, "nothing left is no name");
});

test("a meaningless DLC file name is told apart from a real one", () => {
  for (const junk of ["dlc2", "dlc_01", "DLC-3", "01", "123", "aoc", "a-dlc", "upd", "update 2", "add-on 1", "x"]) {
    assert.equal(isMeaningless(junk), true, junk);
  }
  for (const real of ["Costume Pack", "Season Pass", "Expansion 2", "DLC Pack: Ghosts", "Ys"]) {
    assert.equal(isMeaningless(real), false, real);
  }
});
