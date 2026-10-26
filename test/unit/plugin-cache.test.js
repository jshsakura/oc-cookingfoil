import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPluginCache } from "../../src/plugins/cache.js";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cf-pcache-"));
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

function put(cache, id, name, size, ageMs = 0) {
  const file = path.join(cache.dirOf(id), name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.alloc(size, 1));
  const t = (Date.now() - ageMs) / 1000;
  fs.utimesSync(file, t, t);
}

test("usage counts the bytes and files of each plugin, nested folders included", async () => {
  const cache = createPluginCache({ dataDir, capBytes: 1000 });
  put(cache, "a", "x.bin", 100);
  put(cache, "a", "deep/y.bin", 50);
  put(cache, "b", "z.bin", 10);
  assert.deepEqual(await cache.usageOf("a"), { bytes: 150, files: 2, capBytes: 1000 });
  assert.deepEqual(Object.keys(await cache.usage()).sort(), ["a", "b"]);
  assert.deepEqual(await cache.usageOf("none"), { bytes: 0, files: 0, capBytes: 1000 });
});

test("a plugin under its cap loses nothing; over it, the oldest files go until it is under 90% of the cap", async () => {
  const cache = createPluginCache({ dataDir, capBytes: 1000 });
  put(cache, "full", "old.bin", 400, 3000);
  put(cache, "full", "mid.bin", 400, 2000);
  put(cache, "full", "new.bin", 400, 1000);
  assert.deepEqual(await cache.sweep("b"), { removed: 0, freed: 0 });
  const r = await cache.sweep("full");
  assert.equal(r.removed, 1, "1200 bytes is over 1000: the oldest goes, and 800 is under 900");
  assert.deepEqual(fs.readdirSync(cache.dirOf("full")).sort(), ["mid.bin", "new.bin"]);
  put(cache, "full", "newer.bin", 400);
  assert.equal((await cache.sweep("full")).removed, 1, "1200 again: the next oldest goes");
  assert.deepEqual(fs.readdirSync(cache.dirOf("full")).sort(), ["new.bin", "newer.bin"]);
  assert.deepEqual(await cache.sweep("full"), { removed: 0, freed: 0 });
});

test("sweepAll sweeps every plugin, and clear empties one", async () => {
  const cache = createPluginCache({ dataDir, capBytes: 100 });
  put(cache, "p", "a.bin", 80, 2000);
  put(cache, "p", "b.bin", 80, 1000);
  put(cache, "q", "c.bin", 60);
  await cache.sweepAll();
  assert.deepEqual(fs.readdirSync(cache.dirOf("p")), ["b.bin"]);
  assert.deepEqual(fs.readdirSync(cache.dirOf("q")), ["c.bin"]);
  await cache.clear("q");
  assert.equal(fs.existsSync(cache.dirOf("q")), false);
});
