import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { videosOf, VIDEO_FIELDS, MAX_VIDEOS } from "../../src/meta/igdb-videos.js";
import { igdbRating, trailersOf, reset } from "../../src/meta/rating-sync.js";
import { igdbMeta } from "../../src/retro/meta/igdb.js";
import { fromIgdb, detailFields } from "../../src/retro/meta/fields.js";

beforeEach(() => reset());

const id = (n) => `vid${String(n).padStart(8, "0")}`;

/** IGDB answering `games` for every games query, the bodies it was sent kept in `asked`. */
function fakeIgdb(games) {
  const asked = [];
  const json = (body) => ({ ok: true, json: async () => body });
  const fetchImpl = async (url, init = {}) => {
    if (String(url).startsWith("https://id.twitch.tv/")) return json({ access_token: "t", expires_in: 3600 });
    asked.push(String(init.body));
    return json(games);
  };
  return { fetchImpl, asked };
}

test("IGDB videos become { id, name } in IGDB's order", () => {
  assert.deepEqual(videosOf([{ video_id: "dQw4w9WgXcQ", name: "Trailer" }, { video_id: "a-b_c1234XY", name: " Gameplay " }]), [
    { id: "dQw4w9WgXcQ", name: "Trailer" }, { id: "a-b_c1234XY", name: "Gameplay" },
  ]);
});

test("ids that are not YouTube's 11 characters are dropped, repeats too, and at most eight are kept", () => {
  const bad = [{ video_id: "short" }, { video_id: "toolongvideo1" }, { video_id: "bad id 1234" }, { video_id: "<script>abc" }, { video_id: 12345678901 }, null, "dQw4w9WgXcQ"];
  assert.equal(videosOf(bad), null);
  assert.deepEqual(videosOf([{ video_id: "dQw4w9WgXcQ" }, { video_id: "dQw4w9WgXcQ", name: "again" }]), [{ id: "dQw4w9WgXcQ", name: "" }]);
  const many = Array.from({ length: 12 }, (_, i) => ({ video_id: id(i), name: `v${i}` }));
  assert.equal(MAX_VIDEOS, 8);
  assert.deepEqual(videosOf(many).map((v) => v.id), many.slice(0, 8).map((v) => v.video_id));
});

test("stored videos read back by the same rules, and nothing at all is null", () => {
  assert.deepEqual(videosOf([{ id: "dQw4w9WgXcQ", name: "Trailer" }, { id: "nope" }]), [{ id: "dQw4w9WgXcQ", name: "Trailer" }]);
  for (const none of [undefined, null, [], "x", {}]) assert.equal(videosOf(none), null);
});

test("the Switch rating query asks for the videos and keeps them with the score", async () => {
  const { fetchImpl, asked } = fakeIgdb([{
    id: 7, name: "Hollow Knight", first_release_date: 1528934400, total_rating: 91.2, total_rating_count: 300,
    videos: [{ video_id: "dQw4w9WgXcQ", name: "Launch Trailer" }, { video_id: "broken" }],
  }]);
  const r = await igdbRating(["Hollow Knight"], 2018, { fetchImpl });
  assert.match(asked[0], new RegExp(VIDEO_FIELDS.replace(/\./g, "\\.")));
  assert.equal(asked.length, 1, "no request of its own");
  assert.deepEqual(r.videos, [{ id: "dQw4w9WgXcQ", name: "Launch Trailer" }]);
  assert.equal(r.percent, 91.2);
});

test("a Switch game without videos stays as it was; a match without a score still keeps its videos", async () => {
  const plain = await igdbRating(["Hollow Knight"], null, { fetchImpl: fakeIgdb([{ id: 7, name: "Hollow Knight", total_rating: 90, total_rating_count: 40 }]).fetchImpl });
  assert.deepEqual(plain, { id: 7, name: "Hollow Knight", confidence: 1, percent: 90, count: 40 });
  const unrated = await igdbRating(["Hollow Knight"], null, { fetchImpl: fakeIgdb([{ id: 7, name: "Hollow Knight", videos: [{ video_id: "dQw4w9WgXcQ" }] }]).fetchImpl });
  assert.deepEqual(unrated, { miss: true, videos: [{ id: "dQw4w9WgXcQ", name: "" }] });
  assert.deepEqual(await igdbRating(["Hollow Knight"], null, { fetchImpl: fakeIgdb([{ id: 7, name: "Hollow Knight: Silksong", videos: [{ video_id: "dQw4w9WgXcQ" }] }]).fetchImpl }), { miss: true });
});

test("collected Switch trailers are read by title id; a record without them has none", () => {
  reset({
    "0100000000010000": { igdb: { at: 1, percent: 90, count: 40, confidence: 1, videos: [{ id: "dQw4w9WgXcQ", name: "Trailer" }, { id: "bad" }] } },
    "0100000000020000": { igdb: { at: 1, percent: 90, count: 40, confidence: 1 } },
  });
  assert.deepEqual(trailersOf("0100000000010000"), [{ id: "dQw4w9WgXcQ", name: "Trailer" }]);
  assert.deepEqual(trailersOf("0100000000020000"), []);
  assert.deepEqual(trailersOf("0100000000030000"), []);
});

test("the retro IGDB query asks for the videos and the record keeps them", async () => {
  const { fetchImpl, asked } = fakeIgdb([{ id: 9, name: "Gunstar Heroes", videos: [{ video_id: "dQw4w9WgXcQ", name: "Trailer" }] }]);
  const record = await igdbMeta("md", ["Gunstar Heroes"], { fetchImpl });
  assert.match(asked[0], /videos\.video_id,videos\.name/);
  assert.equal(asked.length, 1);
  assert.deepEqual(record.videos, [{ id: "dQw4w9WgXcQ", name: "Trailer" }]);
});

test("a retro record without videos has no videos field, and the console's detail never carries them", () => {
  assert.equal("videos" in fromIgdb({ id: 1, name: "X" }), false);
  const record = fromIgdb({ id: 1, name: "X", summary: "Text.", videos: [{ video_id: "dQw4w9WgXcQ" }] });
  assert.equal("videos" in detailFields(record, "en"), false);
});
