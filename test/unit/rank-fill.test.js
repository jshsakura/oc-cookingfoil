import { test } from "node:test";
import assert from "node:assert/strict";
import { fillMissingRanks } from "../../src/meta/rank-fill.js";

test("unranked base games follow the last ranked one, newest release first", () => {
  const items = [
    { app_type: "base", name: "A", rank: 40 },
    { app_type: "base", name: "Old", release_date: 20180101 },
    { app_type: "base", name: "New", release_date: 20240101 },
    { app_type: "base", name: "B", rank: 7 },
    { app_type: "base", name: "Undated" },
  ];
  const out = fillMissingRanks(items);
  assert.deepEqual(out.map((i) => [i.name, i.rank]), [["A", 40], ["Old", 42], ["New", 41], ["B", 7], ["Undated", 43]]);
  assert.equal(items[1].rank, undefined);
});

test("updates and DLC are left without a rank", () => {
  const out = fillMissingRanks([{ app_type: "update", name: "U" }, { app_type: "dlc", name: "D" }]);
  assert.deepEqual(out.map((i) => i.rank), [undefined, undefined]);
});
