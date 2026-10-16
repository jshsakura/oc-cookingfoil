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

test("a copy still writing deep inside an item, below what the watch sees, puts the report off", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cf-watch-"));
  const deep = path.join(root, "port", "data", "levels");
  fs.mkdirSync(deep, { recursive: true });
  const seen = [];
  const w = watchItems(root, { depth: 1, quietMs: 300, onItem: (i) => seen.push(i) });
  await w.ready;
  fs.writeFileSync(path.join(root, "port", "port.nro"), "x");
  // Deeper than the watch: no events, but the files keep changing for a while.
  for (let i = 0; i < 6; i++) {
    fs.appendFileSync(path.join(deep, "l1.bin"), "x".repeat(1000));
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.deepEqual(seen, [], "not reported while the deep copy writes");
  for (let i = 0; i < 40 && !seen.length; i++) await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(seen, ["port"]);
  await w.close();
  fs.rmSync(root, { recursive: true, force: true });
});
