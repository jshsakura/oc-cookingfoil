import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { extrasByApp, inside } from "../../src/routes/admin/homebrew-apps-api.js";

test("a homebrew app's patches and saves are grouped under it; game ones are left out", () => {
  const patches = [
    { id: "hb-aaaaaaaaaaaa-111111111111", homebrew: "wwhd", name: "60fps", size: 10, files: 2, title_id: null, verified: true },
    { id: "0100000000010000-222222222222", homebrew: undefined, name: "game mod", size: 5, files: 1, title_id: "0100000000010000" },
  ];
  const saves = [{ id: "hb-aaaaaaaaaaaa-333333333333", homebrew: "wwhd", name: "100%", size: 3, files: 1, titleId: null }];
  const out = extrasByApp(patches, saves);
  assert.deepEqual([...out.keys()], ["wwhd"]);
  assert.deepEqual(out.get("wwhd"), {
    patches: [{ id: "hb-aaaaaaaaaaaa-111111111111", name: "60fps", size: 10, files: 2, verified: true, homebrew: "wwhd",
      ko: null, description: null, version: null, author: null, game_version: null }],
    saves: [{ id: "hb-aaaaaaaaaaaa-333333333333", name: "100%", size: 3, files: 1, verified: false }],
  });
});

test("a folder to delete must stay under its root", () => {
  const root = path.resolve("/patches");
  assert.equal(inside(root, "homebrew/wwhd", "60fps"), path.join(root, "homebrew/wwhd/60fps"));
  assert.equal(inside(root, "homebrew/wwhd", "../../.."), null);
  assert.equal(inside(root, ""), null, "never the root itself");
});
