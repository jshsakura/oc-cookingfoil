import { test } from "node:test";
import assert from "node:assert/strict";
import { englishTitle, titleMatcher } from "../../src/retro/art/titles.js";
import { matchRom as matchArt, targetNames, bezelUrl } from "../../src/retro/art/sync.js";
import { buildMeta, metaKey, titlesOf, wantedKeys } from "../../src/retro/meta/build.js";
import { consoleIndex, matchRom as matchAchievements } from "../../src/retro/achievements/match.js";

// Invented game names, unrelated to any library or commercial release.
const LOCAL = "별빛 항로";
const TITLE = "Starlight Route";

test("lookup titles distinguish English aliases from release tags and preserve nested groups", () => {
  const cases = [
    [`${LOCAL} (${TITLE}) [J-K v1.2]`, TITLE],
    [`${LOCAL} (${TITLE}) (Korea) (Rev 1) [K]`, TITLE],
    [`${LOCAL} (${TITLE}) (En,Fr,De,Es,It,Nl) [K]`, TITLE],
    [`${LOCAL} (${TITLE}) (Unl) [K]`, TITLE],
    [`${LOCAL} (${TITLE}) (Disc 1 of 2) [K]`, TITLE],
    [`${LOCAL} (초판) (${TITLE} (Sky)) [K]`, `${TITLE} (Sky)`],
    [`${TITLE} (USA) (Rev 1)`, TITLE],
    [`${TITLE} (En,Ja,Ko) [K]`, TITLE],
    [`${TITLE} (Sky) [K]`, `${TITLE} (Sky)`],
    ["Café Route (Europe)", "Café Route"],
    [`${LOCAL} (World of Stars) [K]`, "World of Stars"],
    [`${LOCAL} [K]`, LOCAL],
    [`${LOCAL} (${TITLE}`, `${LOCAL} (${TITLE}`],
  ];
  for (const [name, expected] of cases) assert.equal(englishTitle(name), expected, name);
});

test("localized stems connect art, bezels, descriptions, screenshots and achievement candidates", () => {
  const names = [`${TITLE} (Japan)`, `${TITLE} (USA)`, `${TITLE} II (USA)`];
  const matcher = titleMatcher(names);
  const lb = { DatabaseID: "101", Name: TITLE, Platform: "Nintendo Game Boy Advance", Overview: "Follow the stars.", Genres: "Adventure" };
  const data = {
    games: new Map([[lb.DatabaseID, lb]]), alternates: [],
    images: new Map([[lb.DatabaseID, [{ FileName: "starlight.png", Type: "Screenshot - Gameplay" }]]]),
  };
  const ra = consoleIndex([{ id: 201, title: TITLE, count: 5, hashes: ["a".repeat(32)] }]);
  for (const name of [`${LOCAL} (${TITLE}) [J-K v1.2]`, `${LOCAL} (${TITLE}) (Korea) [K]`, `${TITLE} (USA)`]) {
    const game = { system: "gba", name };
    const target = matchArt("gba", name, null, matcher);
    assert.equal(target, names[0]);
    assert.deepEqual(targetNames("gba", name, target), { art: target, bezel: target });
    const sources = [["bezelproject-GBA", "Nintendo-GameBoyAdvance"]];
    const indexes = new Map([[sources[0][0], new Map([[sources[0][1], new Set([target])]])]]);
    assert.ok(bezelUrl(sources, indexes, target).includes(encodeURIComponent(target)));
    assert.ok(wantedKeys([game]).has("starlight route"));
    const record = buildMeta([game], data)[metaKey(game)];
    assert.equal(record.id, "101");
    assert.equal(record.description.en, lb.Overview);
    assert.deepEqual(record.shots, ["https://images.launchbox-app.com/starlight.png"]);
    assert.deepEqual(matchAchievements(ra, null, titlesOf(game)), { id: 201, by: "title" });
    assert.deepEqual(matchAchievements(ra, "a".repeat(32), titlesOf(game)), { id: 201, by: "hash" });
  }
  assert.equal(matchArt("gba", `${LOCAL} (Uncharted Route) [K]`, null, matcher), null);
  assert.deepEqual(buildMeta([{ system: "snes", name: `${LOCAL} (${TITLE}) [K]` }], data), {});
});

test("explicit mappings and arcade set metadata retain their lookup priority", () => {
  assert.deepEqual(titlesOf({ name: `${LOCAL} (${TITLE}) [K]`, original: "Mapped Route (Japan)", names: { en: "Manual Route" } }),
    ["Mapped Route (Japan)", "Manual Route", TITLE]);
  const arcade = { system: "arcade", set: "fictionalset", name: `${LOCAL} (${TITLE})` };
  assert.deepEqual(titlesOf(arcade, new Map([[arcade.set, { Name: "Arcade Route" }]])), ["Arcade Route"]);
  assert.equal(metaKey(arcade), "arcade/fictionalset");
});
