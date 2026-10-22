import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanName, nameFromFile, firstName, nameIn, gameFileName, freeFileName, NAME_MAX_BYTES } from "../../src/meta/organize-naming.js";

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
