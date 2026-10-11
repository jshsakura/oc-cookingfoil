import { test } from "node:test";
import assert from "node:assert/strict";
import { titleKey } from "../../scripts/retro-ratings.mjs";

test("No-Intro names and LaunchBox names reduce to the same title", () => {
  assert.equal(titleKey("Rockman X3 (Japan)"), titleKey("Rockman X3"));
  assert.equal(titleKey("Ys Book I _ II (USA)"), titleKey("Ys Book I & II"));
  assert.equal(titleKey("Legend of Zelda, The - A Link to the Past (USA)"), titleKey("The Legend of Zelda: A Link to the Past"));
  assert.equal(titleKey("Final Fantasy IV Advance (USA)"), titleKey("Final Fantasy 4 Advance"));
  assert.equal(titleKey("Pokémon Gold (Korea) [b]"), titleKey("Pokemon Gold"));
  assert.notEqual(titleKey("Dragon Quest V (Japan)"), titleKey("Dragon Quest VI"));
});
