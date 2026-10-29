import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { jsonFile } from "../../src/helpers/json-file.js";

// A list that reads a store once per game checks the file once, and an edit by hand still shows
// on the next request without a restart.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cf-json-file-"));
const file = path.join(dir, "votes.json");
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("reads in one run check the file once, and an edit by hand shows on the next run", async () => {
  fs.writeFileSync(file, JSON.stringify({ a: 1 }));
  const store = jsonFile(file);
  const stat = fs.statSync;
  let stats = 0;
  fs.statSync = (...args) => (args[0] === file && stats++, stat(...args));
  try {
    for (let i = 0; i < 1000; i++) assert.equal(store.read().a, 1);
    assert.equal(stats, 1, "one check for a thousand reads");
    await tick();
    fs.writeFileSync(file, JSON.stringify({ a: 2, pad: "x" }));
    assert.equal(store.read().a, 2, "the edit shows on the next run");
    assert.equal(stats, 2);
  } finally {
    fs.statSync = stat;
  }
});

test("the server's own write shows at once, in the same run", () => {
  const store = jsonFile(path.join(dir, "own.json"));
  assert.deepEqual(store.read(), {});
  store.write({ b: 1 });
  assert.equal(store.read().b, 1);
});
