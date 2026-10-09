import { test } from "node:test";
import assert from "node:assert/strict";
import { dlcDisplayName } from "../../src/meta/dlc-name.js";

test("a DLC's own titledb name wins", () => {
  assert.equal(dlcDisplayName({ ownName: "예약 구매 보너스", fileName: "Unknown", baseName: "Graveyard Keeper 2", titleId: "0100005027A19001" }), "예약 구매 보너스");
});

test("the filename is used when titledb has no entry", () => {
  assert.equal(dlcDisplayName({ fileName: "Outer Emote Roar", baseName: "DAEMON X MACHINA", titleId: "0100B6400CA57090" }), "Outer Emote Roar");
});

test("an Unknown filename becomes the base game name with the add-on number", () => {
  assert.equal(dlcDisplayName({ fileName: "Unknown", baseName: "DAVE THE DIVER", titleId: "010097F018539003" }), "DAVE THE DIVER DLC 3");
  assert.equal(dlcDisplayName({ fileName: " unknown ", baseName: "Rift", titleId: "0100BDA01AABD012" }), "Rift DLC 18");
});

test("with nothing known it still never says Unknown", () => {
  assert.equal(dlcDisplayName({ fileName: "Unknown", titleId: "0100A7C01B793001" }), "DLC 1");
});
