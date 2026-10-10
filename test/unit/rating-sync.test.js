import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeName, similarity, bestMatch, steamRating, dueTitles, ratingOf, reset,
} from "../../src/meta/rating-sync.js";

beforeEach(() => reset());

test("names lose marks, bracketed tags and edition words before they are compared", () => {
  assert.equal(normalizeName("Hollow Knight™ [NSW] (Deluxe Edition)"), "hollow knight");
  assert.equal(normalizeName("No Man's Sky Nintendo Switch 2 Edition"), "no man s sky");
  assert.equal(normalizeName("Pokémon Legends: Z-A"), "pokemon legends z a");
});

test("similarity is 1 for the same game and low for a different one", () => {
  assert.equal(similarity("Hollow Knight", "Hollow Knight™"), 1);
  assert.ok(similarity("Hollow Knight", "Hollow Knight: Silksong") < 0.9);
  // a sequel is a different game even when the names are nearly the same
  assert.equal(similarity("Darkest Dungeon II", "Darkest Dungeon"), 0);
  assert.equal(similarity("Darkest Dungeon 2", "Darkest Dungeon II"), 1);
  assert.equal(similarity("Cyberpunk 2077", "Cyberpunk 2078"), 0);
});

test("the closest candidate wins", () => {
  const best = bestMatch(["Darkest Dungeon II"], [{ name: "Darkest Dungeon" }, { name: "Darkest Dungeon® II" }]);
  assert.equal(best.item.name, "Darkest Dungeon® II");
  assert.equal(best.confidence, 1);
});

function fakeSteam(items, summary) {
  return async (url) => ({
    ok: true,
    json: async () => (String(url).includes("storesearch") ? { items } : { success: 1, query_summary: summary }),
  });
}

test("a near-exact Steam match reads its review summary", async () => {
  const r = await steamRating(["Darkest Dungeon II"], {
    fetchImpl: fakeSteam([{ id: 1940340, name: "Darkest Dungeon® II" }],
      { total_reviews: 25575, total_positive: 19180, review_score_desc: "Mostly Positive" }),
  });
  assert.equal(r.id, 1940340);
  assert.equal(r.count, 25575);
  assert.equal(r.percent, 75);
  assert.equal(r.label, "Mostly Positive");
});

test("a loose match or a game without reviews is a miss", async () => {
  assert.deepEqual(await steamRating(["Hollow Knight"], { fetchImpl: fakeSteam([{ id: 1, name: "Hollow Knight: Silksong" }], {}) }), { miss: true });
  assert.deepEqual(await steamRating(["Tiny Game"], { fetchImpl: fakeSteam([{ id: 2, name: "Tiny Game" }], { total_reviews: 0 }) }), { miss: true });
});

test("never-looked-up titles come first, then misses past two weeks and hits past a week", () => {
  const day = 24 * 60 * 60 * 1000, now = 100 * day;
  const wanted = new Map([
    ["A", { names: ["A game"] }], ["B", { names: ["B game"] }], ["C", { names: ["C game"] }], ["D", { names: ["D game"] }], ["E", { names: [] }],
  ]);
  const store = {
    B: { steam: { at: now - 8 * day, percent: 90, count: 500 } },  // hit, a week old: due
    C: { steam: { at: now - 3 * day, miss: true } },               // recent miss: not due
    D: { steam: { at: now - 15 * day, miss: true } },              // old miss: due
  };
  assert.deepEqual(dueTitles(wanted, store, now).map((d) => d.tid), ["A", "D", "B"]);
});

test("collected scores pass the same vote floor and confidence as oc-scraper's", () => {
  reset({
    T1: { steam: { at: 1, percent: 91.6, count: 1234, confidence: 1, label: "Very Positive" } },
    T2: { steam: { at: 1, percent: 99, count: 12, confidence: 1 } },
  });
  assert.deepEqual(ratingOf("t1"), { score: 92, count: 1234, source: "steam", label: "Very Positive" });
  assert.equal(ratingOf("T2"), null);
});
