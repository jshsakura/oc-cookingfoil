import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchRanks, nsuIdIndex, rankOf, setRanks } from "../../src/meta/eshop-popularity.js";

// Fakes the store search: ranks 1..total in shuffled order, 500 hits per page.
function fakeIndex(total) {
  const asked = [];
  const fetchImpl = async (_url, init) => {
    const params = new URLSearchParams(JSON.parse(init.body).params);
    const [, low, high] = /popularityRank > (\d+) AND popularityRank <= (\d+)/.exec(params.get("filters")).map(Number);
    const page = Number(params.get("page"));
    asked.push([low, page]);
    const inWindow = [];
    for (let rank = low + 1; rank <= Math.min(total, high); rank++) inWindow.push(rank);
    inWindow.reverse();
    const hits = inWindow.slice(page * 500, (page + 1) * 500)
      .map((rank) => ({ nsuid: String(70010000000000 + rank), popularityRank: rank }));
    return { ok: true, json: async () => ({ hits }) };
  };
  return { fetchImpl, asked };
}

test("ranks are read window by window, whatever order the index returns them in", async () => {
  const { fetchImpl, asked } = fakeIndex(1700);
  const ranks = await fetchRanks({ fetchImpl });
  assert.equal(ranks.size, 1700);
  assert.equal(ranks.get("70010000000001"), 1);
  assert.equal(ranks.get("70010000001700"), 1700);
  assert.deepEqual(asked.slice(0, 4), [[0, 0], [0, 1], [900, 0], [900, 1]]);
});

test("US titledb maps nsuid to title id in both raw and slim shapes", () => {
  const raw = { "70010000000001": { id: "0100000000010000", nsuId: 70010000000001 } };
  const slim = { _schemaVersion: 4, "0100000000020000": { id: "0100000000020000", nsuId: "70010000000002" } };
  assert.equal(nsuIdIndex(raw).get("70010000000001"), "0100000000010000");
  assert.equal(nsuIdIndex(slim).get("70010000000002"), "0100000000020000");
});

test("rankOf answers by title id, case-insensitively, and null when unranked", () => {
  setRanks([["0100000000010000", 3]]);
  assert.equal(rankOf("0100000000010000"), 3);
  assert.equal(rankOf("0100000000010000".toLowerCase()), 3);
  assert.equal(rankOf("0100000000020000"), null);
});
