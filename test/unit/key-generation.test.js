// What the server knows about a game file's master key generation, and what the keys can reach: the facts
// the shop lists (item key generation, the library count), independent of any plugin. Synthetic files and
// random keys only.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildNcz, buildProgramNca, keysUpTo, makeKeys } from "../support/rewrap-files.js";
import { buildPfs0, buildXci } from "../support/switch-files.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "key-generation-"));
process.env.COOK_DATA_DIR = path.join(root, "data");

const { firmwareOf } = await import("../../src/meta/generations.js");
const { maxGeneration } = await import("../../src/meta/nca-crypto.js");
const { readKeyGeneration } = await import("../../src/meta/key-generation.js");
const { libraryAbove, titleKeyNeed } = await import("../../src/meta/key-needs.js");

after(() => fs.rmSync(root, { recursive: true, force: true }));

const K = makeKeys(20);

/** A file on disk; returns its path. */
function file(name, data) {
  const p = path.join(root, "games", name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, data);
  return p;
}

test("a generation's first firmware, one more per major version after the table", () => {
  assert.equal(firmwareOf(20), "21.0.0");
  assert.equal(firmwareOf(11), "12.1.0");
  assert.equal(firmwareOf(21), "22.0.0");
  assert.equal(firmwareOf(-1), null);
});

test("the keys' reach is the highest generation with both a key area key and a title kek", () => {
  assert.equal(maxGeneration(K.keys), 20);
  assert.equal(maxGeneration(keysUpTo(K, 15).keys), 15);
  const noKek = new Map([...K.keys].filter(([n]) => n !== "titlekek_0e"));
  assert.equal(maxGeneration(keysUpTo({ keys: noKek }, 14).keys), 13);
  assert.equal(maxGeneration(new Map([["key_area_key_application_00", "b".repeat(32)]])), null, "no header key");
});


test("a file's key generation is the highest among its NCA headers, NSZ and XCZ included", async () => {
  const data = buildPfs0([{ name: "a.ncz", data: buildNcz(K, 17).ncz }, { name: "b.nca", data: buildProgramNca(K, 12).nca }]);
  assert.equal(await readKeyGeneration(file("gen.nsz", data), K.keys), 17);
  assert.equal(await readKeyGeneration(file("gen.xcz", buildXci([{ name: "a.nca", data: buildProgramNca(K, 9).nca }])), K.keys), 9);
  assert.equal(await readKeyGeneration(file("gen2.nsz", data), new Map()), null, "no keys, no answer");
});

test("the library count names the games above the keys and the prod.keys version that covers them", () => {
  const gens = new Map([["A@0", 19], ["A@65536", 20], ["B@0", 12]]);
  const gen = (f) => gens.get(`${f.titleId}@${f.version}`);
  const files = [
    { titleId: "A", baseTitleId: "A", version: 0, kind: "base" },
    { titleId: "A", baseTitleId: "A", version: 65536, kind: "update" },
    { titleId: "B", baseTitleId: "B", version: 0, kind: "base" },
    { titleId: "C", baseTitleId: "C", version: 0, kind: "base" },
  ];
  assert.deepEqual(libraryAbove(16, files, gen), { above: 1, version: "21.0.0", known: 3, unknown: 1 });
  assert.deepEqual(libraryAbove(20, files, gen), { above: 0, version: null, known: 3, unknown: 1 });
  assert.deepEqual(titleKeyNeed("A", files, gen), { keyGeneration: 20, keyFirmware: "21.0.0" });
  assert.deepEqual(titleKeyNeed("C", files, gen), { keyGeneration: null, keyFirmware: null });
});
