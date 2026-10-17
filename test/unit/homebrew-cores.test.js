import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.COOK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hb-cores-"));
const cores = await import("../../src/meta/homebrew-cores.js");

const ID = "m-0123456789ab";
const OTHER = "m-ba9876543210";

test("a shortcut gets cores 0 to 3 unless the admin chose 3", () => {
  assert.equal(cores.coresOf(ID), 4, "the default");
  assert.equal(cores.set(ID, 3), true);
  assert.equal(cores.coresOf(ID), 3);
  assert.equal(cores.coresOf(OTHER), 4, "another app keeps the default");
  assert.equal(cores.set(ID, 4), true);
  assert.equal(cores.coresOf(ID), 4);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(process.env.COOK_DATA_DIR, "homebrew", "cores.json"), "utf8")), {}, "the default is not stored");
});

test("a wrong id or count is refused", () => {
  assert.equal(cores.set("nope", 3), false);
  assert.equal(cores.set(ID, 2), false);
  assert.equal(cores.set(ID, 5), false);
});

test("an app saved as 4 before the default changed stays 4", () => {
  fs.mkdirSync(path.join(process.env.COOK_DATA_DIR, "homebrew"), { recursive: true });
  fs.writeFileSync(path.join(process.env.COOK_DATA_DIR, "homebrew", "cores.json"), JSON.stringify({ [OTHER]: 4 }));
  cores.reset();
  assert.equal(cores.coresOf(OTHER), 4);
});
