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

test("an item that changes again soon after it was read waits out the cooldown", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cf-watch-"));
  const seen = [];
  const w = watchItems(root, { depth: 1, quietMs: 100, cooldownMs: 800, onItem: (i) => seen.push([i, Date.now()]) });
  await w.ready;
  fs.mkdirSync(path.join(root, "app"));
  fs.writeFileSync(path.join(root, "app", "a.nro"), "x");
  for (let i = 0; i < 40 && !seen.length; i++) await new Promise((r) => setTimeout(r, 50));
  assert.equal(seen.length, 1);
  fs.writeFileSync(path.join(root, "app", "a.nro"), "xy");
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(seen.length, 1, "not read again inside the cooldown");
  for (let i = 0; i < 40 && seen.length < 2; i++) await new Promise((r) => setTimeout(r, 50));
  assert.equal(seen.length, 2, "read once the cooldown is over");
  assert.ok(seen[1][1] - seen[0][1] >= 750);
  await w.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test("with deep on, a file replaced by mv deep inside an item, at the same size, reports that item", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cf-watch-"));
  const deep = path.join(root, "cstrike", "cstrike", "gfx", "shell");
  fs.mkdirSync(deep, { recursive: true });
  fs.writeFileSync(path.join(deep, "splash.bmp"), "a".repeat(100));
  const seen = [];
  const w = watchItems(root, { depth: 1, deep: true, quietMs: 200, cooldownMs: 0, onItem: (i) => seen.push(i) });
  await w.ready;
  fs.writeFileSync(path.join(root, ".next.bmp"), "b".repeat(100));
  fs.renameSync(path.join(root, ".next.bmp"), path.join(deep, "splash.bmp"));
  for (let i = 0; i < 40 && !seen.length; i++) await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(seen, ["cstrike"]);

  // A folder made after the watch started is watched too.
  fs.mkdirSync(path.join(root, "cstrike", "cstrike", "maps"));
  await new Promise((r) => setTimeout(r, 400));
  seen.length = 0;
  fs.writeFileSync(path.join(root, "cstrike", "cstrike", "maps", "de_dust2.bsp"), "x");
  for (let i = 0; i < 40 && !seen.length; i++) await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(seen, ["cstrike"]);
  await w.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test("a file dated far ahead neither spins the watch nor stops its item from being reported", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cf-watch-"));
  const item = path.join(root, "app");
  fs.mkdirSync(item);
  const ahead = new Date(Date.now() + 30 * 86400e3);
  fs.writeFileSync(path.join(item, "notes.txt"), "x");
  fs.utimesSync(path.join(item, "notes.txt"), ahead, ahead);
  const warnings = [];
  const onWarning = (w) => warnings.push(w.name);
  process.on("warning", onWarning);
  const fsp = (await import("node:fs/promises")).default;
  const readdir = fsp.readdir;
  let reads = 0;
  t.mock.method(fsp, "readdir", (p, ...rest) => { if (String(p) === item) reads++; return readdir(p, ...rest); });
  const seen = [];
  const w = watchItems(root, { depth: 1, deep: true, quietMs: 200, cooldownMs: 0, onItem: (i) => seen.push(i) });
  await w.ready;
  fs.writeFileSync(path.join(item, "a.txt"), "x");
  await new Promise((r) => setTimeout(r, 1200));
  assert.deepEqual(seen, ["app"], "reported once quiet");
  fs.writeFileSync(path.join(item, "b.txt"), "x");
  for (let i = 0; i < 40 && seen.length < 2; i++) await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(seen, ["app", "app"], "and again when it changes later");
  assert.ok(reads < 10, `read ${reads} times`);
  assert.deepEqual(warnings.filter((n) => n === "TimeoutOverflowWarning"), []);
  process.off("warning", onWarning);
  await w.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test("with deep on, a folder deleted and made again under the same name is watched again", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cf-watch-"));
  fs.mkdirSync(path.join(root, "app"));
  const seen = [];
  const w = watchItems(root, { depth: 1, deep: true, quietMs: 100, cooldownMs: 0, onItem: (i) => seen.push(i) });
  await w.ready;
  fs.rmSync(path.join(root, "app"), { recursive: true });
  fs.mkdirSync(path.join(root, "app"));
  await new Promise((r) => setTimeout(r, 400));
  seen.length = 0;
  fs.writeFileSync(path.join(root, "app", "a.nro"), "x");
  for (let i = 0; i < 40 && !seen.length; i++) await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(seen, ["app"]);

  // Renamed: reported under its new name only.
  fs.renameSync(path.join(root, "app"), path.join(root, "moved"));
  await new Promise((r) => setTimeout(r, 400));
  seen.length = 0;
  fs.writeFileSync(path.join(root, "moved", "b.nro"), "x");
  await new Promise((r) => setTimeout(r, 600));
  assert.deepEqual(seen, ["moved"]);
  await w.close();
  fs.rmSync(root, { recursive: true, force: true });
});
