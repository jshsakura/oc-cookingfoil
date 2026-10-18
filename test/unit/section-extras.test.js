import { test } from "node:test";
import assert from "node:assert/strict";
import { sectionExtras } from "../../src/meta/section-extras.js";

test("sectionExtras passes popularity rank and player count", () => {
  assert.deepEqual(sectionExtras({ rank: 42, numberOfPlayers: 4 }), { rank: 42, players: 4 });
  assert.deepEqual(sectionExtras({ rank: "7" }), { rank: 7 });
});
test("sectionExtras drops missing or bogus values", () => {
  assert.deepEqual(sectionExtras(null), {});
  assert.deepEqual(sectionExtras({ rank: 0, numberOfPlayers: -1 }), {});
  assert.deepEqual(sectionExtras({ rank: 1.5, numberOfPlayers: 500 }), {});
  assert.deepEqual(sectionExtras({ rank: "abc" }), {});
});
