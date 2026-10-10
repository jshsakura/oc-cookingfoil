import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pickScore, baseIdOfPost, buildStore, ratingOf, setRatings, refresh, SCORE_LABELS,
} from "../../src/meta/scraper-ratings.js";

const steam = (percent, count, extra = {}) => ({ provider: "steam", percent, count, confidence: 1, label: "매우 긍정적", ...extra });
const igdb = (percent, count, extra = {}) => ({ provider: "igdb", percent, count, confidence: 1, label: "4.5/5", ...extra });

test("Steam wins when it has enough votes, and its label becomes an English key", () => {
  assert.deepEqual(pickScore({ steam: steam(91.6, 1234), igdb: igdb(80, 40) }),
    { score: 92, count: 1234, source: "steam", label: "Very Positive" });
});

test("a thin Steam sample falls through to IGDB, which carries no label", () => {
  assert.deepEqual(pickScore({ steam: steam(100, 12), igdb: igdb(84.4, 22) }), { score: 84, count: 22, source: "igdb" });
});

test("scores below the vote floors or with a shaky match are left out", () => {
  assert.equal(pickScore({ igdb: igdb(95, 14) }), null);
  assert.equal(pickScore({ steam: steam(95, 5000, { confidence: 0.7 }) }), null);
  assert.equal(pickScore({ rawg: { percent: 90, count: 99, confidence: 1 } }), null);
  assert.equal(pickScore({}), null);
});

test("a post maps to one base game through its base or update ids; bundles map to none", () => {
  assert.equal(baseIdOfPost({ metadata: { title_id: null }, download_items: [{ title_id: "0100E5E01C098800" }, { title_id: "0100E5E01C099001" }] }), "0100E5E01C098000");
  assert.equal(baseIdOfPost({ download_items: [{ title_id: "0100E5E01C098000" }, { title_id: "01000A10179CC000" }] }), null);
  assert.equal(baseIdOfPost({ download_items: [{ title_id: "0100E5E01C099001" }] }), null);
});

test("two posts for one game keep the better-sampled score", () => {
  const store = buildStore([
    { metadata: { title_id: "0100E5E01C098000" }, ratings: { igdb: igdb(70, 20) } },
    { metadata: { title_id: "0100E5E01C098000" }, ratings: { steam: steam(95, 900) } },
  ]);
  assert.equal(store.ratings["0100E5E01C098000"].source, "steam");
});

test("a Korean-only id borrows the score of the release sharing its art", () => {
  setRatings([["0100E5E01C098000", { score: 90, count: 500, source: "steam" }]]);
  assert.equal(ratingOf("0100E5E01C098000").score, 90);
  assert.equal(ratingOf("010011111111A000", { siblings: ["0100E5E01C098000"] }).score, 90);
  assert.equal(ratingOf("010011111111A000"), null);
});

test("every Steam summary has a label in every language", () => {
  for (const labels of Object.values(SCORE_LABELS)) for (const lang of ["en", "ko", "ja", "zh"]) assert.ok(labels[lang]);
});

test("refresh is off without a scraper URL and pages until has_next is false", async () => {
  assert.equal(await refresh({ baseUrl: "" }), false);
  const pages = [];
  const fetchImpl = async (url) => {
    const page = Number(new URL(url).searchParams.get("page"));
    pages.push(page);
    return { ok: true, json: async () => ({ posts: [], pagination: { has_next: page < 3 } }) };
  };
  assert.equal(await refresh({ baseUrl: "http://scraper.test", fetchImpl }), false); // no scores at all
  assert.deepEqual(pages, [1, 2, 3]);
});
