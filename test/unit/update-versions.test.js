import { test } from "node:test";
import assert from "node:assert/strict";
import { displayVersionOf } from "../../src/meta/update-versions.js";

test("update display version is the NUL-padded text at 0x3060 in the NACP", () => {
  const nacp = Buffer.alloc(0x4000);
  nacp.write("1.4.1", 0x3060, "utf8");
  assert.equal(displayVersionOf(nacp), "1.4.1");
});

test("an empty display version is reported as missing", () => {
  assert.equal(displayVersionOf(Buffer.alloc(0x4000)), null);
});
