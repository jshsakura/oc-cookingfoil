import { test } from "node:test";
import assert from "node:assert/strict";
import { GRID_SCRIPT } from "../../src/routes/admin/grid.js";
import { TOP_WORDS } from "../../src/routes/admin/top-i18n.js";

const { gridKey, gridCompare } = new Function("window", "document", "topText", `${GRID_SCRIPT}; return { gridKey, gridCompare };`)({}, {}, (k) => TOP_WORDS.ko[k]);
const cell = (text, sort) => ({ textContent: text, dataset: sort == null ? {} : { sort: String(sort) }, querySelector: () => null });
const order = (texts, desc = false) => {
  const cmp = gridCompare.bind({ i: 0 });
  const node = (t) => ({ data: { _n: [cell(t)] } });
  const sorted = [...texts].sort((a, b) => cmp(null, null, node(a), node(b), desc));
  return desc ? sorted.reverse() : sorted;
};

test("table cells sort by what they mean, not by their letters", () => {
  assert.deepEqual(order(["10분 전", "3분 전", "2시간 전", "1일 전"]), ["1일 전", "2시간 전", "10분 전", "3분 전"]);
  assert.deepEqual(order(["900 KB", "1.5 GB", "12.0 MB", "2 MB"]), ["900 KB", "2 MB", "12.0 MB", "1.5 GB"]);
  assert.deepEqual(order(["2026. 10. 3. 오후 1:00:00", "2026. 9. 30. 오전 11:00:00", "2026. 10. 3. 오전 9:00:00"]),
    ["2026. 9. 30. 오전 11:00:00", "2026. 10. 3. 오전 9:00:00", "2026. 10. 3. 오후 1:00:00"]);
  assert.deepEqual(order(["1,200", "30", "4"]), ["4", "30", "1,200"]);
  assert.deepEqual(order(["게임 10", "게임 9", "가나"]), ["가나", "게임 9", "게임 10"]);
  assert.equal(gridKey(cell("아무 글", 42)), 42, "data-sort wins");
});

test("empty cells stay at the bottom whichever way the column is sorted", () => {
  assert.deepEqual(order(["—", "3", "1"]), ["1", "3", "—"]);
  assert.deepEqual(order(["—", "3", "1"], true).filter((x) => x !== "—").length, 2);
  const cmp = gridCompare.bind({ i: 0 });
  const node = (t) => ({ data: { _n: [cell(t)] } });
  assert.ok(cmp(null, null, node("—"), node("1"), true) < 0, "descending: AG Grid flips the result, so empty must compare low to land last");
});

test("a count with its share in brackets sorts as a number", () => {
  assert.deepEqual(order(["10 (50%)", "2 (10%)", "0 (0%)"]), ["0 (0%)", "2 (10%)", "10 (50%)"]);
});
