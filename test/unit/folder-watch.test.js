import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The folder watch: which item an event belongs to, and one report per item
// only after its writes have gone quiet.
const { itemOf, watchItems } = await import("../../src/meta/folder-watch.js");

test("an event names the item it is under, at the item's depth", () => {
  assert.equal(itemOf("/s", "/s/0100000000010000/My Save/data/a.bin", 2), "0100000000010000/My Save");
  assert.equal(itemOf("/h", "/h/jak3/data/x", 1), "jak3");
  assert.equal(itemOf("/s", "/s/0100000000010000", 2), null, "the title folder alone is no item");
  assert.equal(itemOf("/s", "/other/x/y", 2), null);
  assert.equal(itemOf("/s", "/s", 1), null);
});

test("an item is reported once, after its writes stop", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cf-watch-"));
  const seen = [];
  const w = watchItems(root, { depth: 1, quietMs: 300, onItem: (i) => seen.push(i) });
  await w.ready;
  fs.mkdirSync(path.join(root, "app"));
  for (let i = 0; i < 5; i++) {
    fs.appendFileSync(path.join(root, "app", "big.bin"), "x".repeat(1000));
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.deepEqual(seen, [], "nothing while the copy is still writing");
  for (let i = 0; i < 40 && !seen.length; i++) await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(seen, ["app"]);
  fs.writeFileSync(path.join(root, ".hidden"), "x");
  await new Promise((r) => setTimeout(r, 600));
  assert.deepEqual(seen, ["app"], "dot names are ignored");
  await w.close();
  fs.rmSync(root, { recursive: true, force: true });
});
