import { test } from "node:test";
import assert from "node:assert/strict";
import { editionOf } from "../../src/retro/edition.js";

test("Korean patch tags become flags", () => {
  assert.deepEqual(editionOf("J-K v20221128 v1.1"), { korean: true, source: "patch", from: "jp", version: "v1.1" });
  assert.deepEqual(editionOf("U-K"), { korean: true, source: "patch", from: "us" });
  assert.deepEqual(editionOf("K"), { korean: true, source: "patch" });
  assert.deepEqual(editionOf("K v1.0-260911"), { korean: true, source: "patch", version: "v1.0-260911" });
  assert.deepEqual(editionOf("GBA,SNES한글팬메이드"), { korean: true, source: "patch" });
  assert.deepEqual(editionOf("ko-test"), { korean: true, source: "patch" });
  assert.deepEqual(editionOf("Korean Translation 911202"), { korean: true, source: "patch" });
});

test("Korean releases are official, unlicensed ones unofficial", () => {
  assert.deepEqual(editionOf("Korea"), { korean: true, source: "official" });
  assert.deepEqual(editionOf("Japan, Korea"), { korean: true, source: "official" });
  assert.deepEqual(editionOf("Korean release"), { korean: true, source: "official" });
  assert.deepEqual(editionOf("Korea Unl"), { korean: true, source: "unofficial" });
  assert.deepEqual(editionOf("Unl-K"), { korean: true, source: "unofficial" });
});

test("other tags carry no Korean flags", () => {
  for (const t of ["Japan", "USA", "PSP", "Japan Rev 3", "World 911202", "", null]) assert.equal(editionOf(t), null, String(t));
});
