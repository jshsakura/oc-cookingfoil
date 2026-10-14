import { test } from "node:test";
import assert from "node:assert/strict";

// The updates the admin picks from when noting which one a patch was made for.
const { updateChoices, libraryUpdates } = await import("../../src/routes/admin/patches-api.js");

const BASE = "0100726014352000";
const UPDATE = "0100726014352800";
const files = [
  { kind: "base", baseTitleId: BASE, name: `Diablo II [${BASE}][v0]` },
  { kind: "update", baseTitleId: BASE, name: `Diablo II [${UPDATE}][v2097152]`, version_name: "1.0.32.0" },
  { kind: "update", baseTitleId: "0100000000010000", name: "Other [0100000000010800][v65536]" },
  { kind: "dlc", baseTitleId: BASE, name: `Diablo II DLC [0100726014353001][v0]` },
];
const history = [{ version: 2097152, date: "2026-04-01" }, { version: 2162688, date: "2026-06-02" }, { version: 2228224, date: null }];

test("titledb's updates and the library's own are listed newest first", () => {
  assert.deepEqual(updateChoices(BASE, history, files), [
    { version: 2228224, date: null, display: null, in_library: false },
    { version: 2162688, date: "2026-06-02", display: null, in_library: false },
    { version: 2097152, date: "2026-04-01", display: "1.0.32.0", in_library: true },
  ]);
});

test("an update only the library has is listed too", () => {
  assert.deepEqual(updateChoices(BASE, [], files), [{ version: 2097152, date: null, display: "1.0.32.0", in_library: true }]);
});

test("the library's update versions are grouped by game", () => {
  const owned = libraryUpdates(files);
  assert.deepEqual([...owned.get(BASE)], [2097152]);
  assert.deepEqual([...owned.get("0100000000010000")], [65536]);
  assert.equal(owned.size, 2, "base games and DLC are not updates");
});
