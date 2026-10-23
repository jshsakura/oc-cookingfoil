import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { INDEX_MIGRATIONS, openDatabase } from "../../src/db/database.js";
import { catalogStore, hashStore } from "../../src/db/stores.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "cf-db-"));

test("a catalog has nothing before its first full scan, then the scan's items", () => {
  const db = openDatabase(":memory:");
  const store = catalogStore(db, "things");
  assert.equal(store.load(), null);
  store.replace([{ id: "a", n: 1 }, { id: "b", n: 2 }], 1000);
  assert.deepEqual(store.load(), { at: 1000, items: [{ id: "a", n: 1 }, { id: "b", n: 2 }] });
  store.replace([], 2000);
  assert.deepEqual(store.load(), { at: 2000, items: [] }, "an empty folder is a scan too");
});

test("one item is changed or removed without touching the rest or the scan time", () => {
  const db = openDatabase(":memory:");
  const store = catalogStore(db, "things");
  store.replace([{ id: "a", n: 1 }, { id: "b", n: 2 }], 1000);
  store.put({ id: "b", n: 3 });
  store.put({ id: "c", n: 4 });
  store.remove("a", "missing");
  const { at, items } = store.load();
  assert.equal(at, 1000);
  assert.deepEqual(items.sort((x, y) => x.id.localeCompare(y.id)), [{ id: "b", n: 3 }, { id: "c", n: 4 }]);
});

test("catalogs share the file but not their items", () => {
  const db = openDatabase(":memory:");
  catalogStore(db, "one").replace([{ id: "a" }], 1);
  assert.equal(catalogStore(db, "two").load(), null);
});

test("file hashes are written through, survive a reopen, and are pruned to the files still there", () => {
  const dir = tmp();
  const file = path.join(dir, "index.db");
  const store = hashStore(openDatabase(file), "s");
  store.set("/a", { key: "1:2:3", hash: "aa" });
  store.set("/b", { key: "4:5:6", hash: "bb" });
  const again = hashStore(openDatabase(file), "s");
  assert.deepEqual(again.get("/a"), { key: "1:2:3", hash: "aa" });
  again.prune(new Set(["/b"]));
  assert.equal(again.get("/a"), undefined);
  assert.equal(hashStore(openDatabase(file), "s").size, 1);
  assert.equal(hashStore(openDatabase(file), "other").size, 0, "scopes are apart");
});

test("an index opened again is not migrated twice", () => {
  const file = path.join(tmp(), "index.db");
  openDatabase(file).close();
  const db = openDatabase(file);
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, INDEX_MIGRATIONS.length);
  assert.equal(db.prepare("PRAGMA journal_mode").get().journal_mode, "wal");
});

test("a broken index is deleted and started again; it only holds what the folders can tell again", async () => {
  const { openIndex } = await import("../../src/db/database.js");
  const file = path.join(tmp(), "index.db");
  fs.writeFileSync(file, "this is not a database at all, just bytes ".repeat(200));
  const db = openIndex(file);
  assert.equal(catalogStore(db, "x").load(), null);
  catalogStore(db, "x").replace([{ id: "a" }], 1);
  assert.equal(catalogStore(openIndex(file), "x").load().items.length, 1, "a sound one is kept");
});
