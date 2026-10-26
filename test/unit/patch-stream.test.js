import { test } from "node:test";
import assert from "node:assert/strict";
import { overlay } from "../../src/helpers/patch-stream.js";
import { applyPatches } from "../support/rewrap-files.js";

test("a patch map laid over any chunk of the stream writes exactly the overlapping bytes", () => {
  const patches = [{ offset: 10, bytes: Buffer.from("ABCD") }, { offset: 20, bytes: Buffer.from("EF") }];
  const file = Buffer.alloc(30, 0x2e);
  const whole = applyPatches(file, patches);
  for (let start = 0; start < 30; start++) {
    for (let end = start + 1; end <= 30; end++) {
      assert.ok(overlay(file.subarray(start, end), start, patches).equals(whole.subarray(start, end)), `${start}-${end}`);
    }
  }
  const untouched = file.subarray(0, 5);
  assert.equal(overlay(untouched, 0, patches), untouched, "no copy when nothing overlaps");
});
