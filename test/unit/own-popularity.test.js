import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../../src/db/database.js";
import { baseOfPath, recordCompleted, completedCounts, fillRanks } from "../../src/meta/own-popularity.js";
import { parseMetadata } from "../../src/plugins/agent-answer.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 29);
const GAME = "0100AAAA00000000";
const rec = (over = {}) => ({
  complete: true, endedAt: NOW - DAY, who: { kind: "device", id: "aaaa0000" },
  file: { path: `/games/Some Game [${GAME}][v0].nsp` }, ...over,
});
const fresh = () => openDatabase(":memory:");

test("the base title comes from the file's title id; an update or DLC counts for its game", () => {
  assert.equal(baseOfPath(`/g/Game [${GAME}].nsp`), GAME);
  assert.equal(baseOfPath("/g/Game [0100AAAA00000800][v65536].nsp"), GAME);
  assert.equal(baseOfPath("/g/no id.nsp"), null);
});

test("a finished transfer counts once per requester, however often they finish it", () => {
  const db = fresh();
  assert.equal(recordCompleted(rec(), { db, now: () => NOW }), true);
  recordCompleted(rec({ endedAt: NOW - 2 * DAY }), { db, now: () => NOW });
  recordCompleted(rec({ who: { kind: "device", id: "bbbb1111" } }), { db, now: () => NOW });
  assert.equal(completedCounts({ db, now: () => NOW }).get(GAME), 2);
});

test("a transfer that did not cover the whole file, or has no title id, counts for nothing", () => {
  const db = fresh();
  assert.equal(recordCompleted(rec({ complete: false }), { db, now: () => NOW }), false);
  assert.equal(recordCompleted(rec({ file: { path: "/g/x.nsp" } }), { db, now: () => NOW }), false);
  assert.equal(completedCounts({ db, now: () => NOW }).size, 0);
});

test("a download older than the window is not counted", () => {
  const db = fresh();
  recordCompleted(rec({ endedAt: NOW - 100 * DAY }), { db, now: () => NOW });
  assert.equal(completedCounts({ db, now: () => NOW, days: 90 }).get(GAME), undefined);
  assert.equal(completedCounts({ db, now: () => NOW, days: 120 }).get(GAME), 1);
});

const item = (title_id, extra = {}) => ({ title_id, app_type: "base", ...extra });

test("games without a rank follow the ranked ones: most finished first, then the newer release", () => {
  const items = [
    item("A", { rank: 5 }), item("B", { release_date: 20200101 }), item("C", { release_date: 20240101 }),
    item("D", { release_date: 20100101 }), { title_id: "A", app_type: "update" },
  ];
  fillRanks(items, new Map([["D", 3]]));
  const rank = Object.fromEntries(items.filter((i) => i.app_type === "base").map((i) => [i.title_id, i.rank]));
  assert.deepEqual(rank, { A: 5, D: 6, C: 7, B: 8 });
  assert.equal(items[4].rank, undefined);
});

test("several files of one game share one rank, and nothing is ranked when nothing is a game", () => {
  const items = [item("X"), item("X"), item("Y")];
  fillRanks(items, new Map([["Y", 1]]));
  assert.deepEqual(items.map((i) => i.rank), [2, 2, 1]);
  assert.deepEqual(fillRanks([{ title_id: "Z", app_type: "dlc" }], new Map()), [{ title_id: "Z", app_type: "dlc" }]);
});

test("a metadata plugin's rank is kept when it is a whole number from 1 up, and dropped otherwise", () => {
  assert.equal(parseMetadata({ fields: { rank: 12 } }).fields.rank, 12);
  for (const bad of [0, -3, 1.5, "7", null]) assert.equal(parseMetadata({ fields: { rank: bad } }).fields.rank, undefined);
});
