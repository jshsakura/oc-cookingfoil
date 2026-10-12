import { test } from "node:test";
import assert from "node:assert/strict";
import { compareVersions, inspectNro } from "../../src/meta/client-build.js";

/** A minimal NRO: header, then an ASET block whose NACP carries `version`. */
function fakeNro(version, { nroSize = 0x100 } = {}) {
  const head = Buffer.alloc(nroSize);
  head.write("NRO0", 0x10);
  head.writeUInt32LE(nroSize, 0x18);
  const aset = Buffer.alloc(0x38);
  aset.write("ASET", 0);
  aset.writeBigUInt64LE(0x38n, 0x18);
  aset.writeBigUInt64LE(0x4000n, 0x20);
  const nacp = Buffer.alloc(0x4000);
  nacp.write(version, 0x3060);
  return Buffer.concat([head, aset, nacp]);
}

const code = (buf) => {
  try {
    inspectNro(buf);
    return "ok";
  } catch (err) {
    return err.code;
  }
};

test("a whole build passes and its version comes from the NACP", () => {
  assert.deepEqual(inspectNro(fakeNro("0.2.8")), { version: "0.2.8" });
});

test("broken builds are turned down, each with its reason", () => {
  const good = fakeNro("0.2.8");
  assert.equal(code(Buffer.alloc(0)), "empty");
  assert.equal(code(Buffer.from("PK\x03\x04 not an nro".repeat(20))), "not-nro");
  assert.equal(code(good.subarray(0, good.length - 1)), "truncated");
  assert.equal(code(good.subarray(0, 0x120)), "truncated", "cut inside the ASET header");
  assert.equal(code(Buffer.concat([good, Buffer.from("x")])), "trailing-bytes");
  const noAset = Buffer.from(good);
  noAset.write("XXXX", 0x100);
  assert.equal(code(noAset), "no-assets");
  assert.equal(code(fakeNro("0.2")), "bad-version");
  assert.equal(code(fakeNro("latest")), "bad-version");
});

test("versions compare by number, not as text", () => {
  assert.equal(compareVersions("0.2.10", "0.2.9"), 1);
  assert.equal(compareVersions("0.2.8", "0.2.8"), 0);
  assert.equal(compareVersions("0.1.99", "0.2.0"), -1);
});
