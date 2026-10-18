import { test } from "node:test";
import assert from "node:assert/strict";
import { replaceIcon } from "../../src/meta/homebrew-nro-icon.js";

/** An .nro: 0x100 bytes of executable, then ASET with an icon, a NACP and a RomFS. */
function nro({ icon = Buffer.from("OLD-ICON"), nacp = Buffer.alloc(0x4000, 7), romfs = Buffer.from("ROMFS-DATA") } = {}) {
  const head = Buffer.alloc(0x100, 1);
  head.write("NRO0", 0x10);
  head.writeUInt32LE(0x100, 0x18);
  const aset = Buffer.alloc(0x38);
  aset.write("ASET", 0);
  let at = 0x38;
  for (const [field, buf] of [[0x08, icon], [0x18, nacp], [0x28, romfs]]) {
    aset.writeBigUInt64LE(BigInt(at), field);
    aset.writeBigUInt64LE(BigInt(buf.length), field + 8);
    at += buf.length;
  }
  return Buffer.concat([head, aset, icon, nacp, romfs]);
}

const part = (buf, field) => {
  const off = Number(buf.readBigUInt64LE(0x100 + field));
  const size = Number(buf.readBigUInt64LE(0x100 + field + 8));
  return buf.subarray(0x100 + off, 0x100 + off + size);
};

test("the icon is replaced and the executable, NACP and RomFS stay as they were", () => {
  const src = nro();
  const icon = Buffer.from("A NEW AND LONGER ICON");
  const out = replaceIcon(src, icon);
  assert.deepEqual(out.subarray(0, 0x100), src.subarray(0, 0x100));
  assert.deepEqual(part(out, 0x08), icon);
  assert.deepEqual(part(out, 0x18), part(src, 0x18));
  assert.deepEqual(part(out, 0x28), Buffer.from("ROMFS-DATA"));
});

test("an .nro without RomFS keeps none", () => {
  const out = replaceIcon(nro({ romfs: Buffer.alloc(0) }), Buffer.from("ICON"));
  assert.equal(Number(out.readBigUInt64LE(0x100 + 0x30)), 0);
  assert.deepEqual(part(out, 0x08), Buffer.from("ICON"));
});

test("a file that is not an .nro with assets is left alone", () => {
  assert.equal(replaceIcon(Buffer.alloc(0x200), Buffer.from("ICON")), null);
  const bare = nro().subarray(0, 0x100);
  assert.equal(replaceIcon(bare, Buffer.from("ICON")), null);
});

test("an asset section that points past the file is refused", () => {
  const bad = Buffer.from(nro());
  bad.writeBigUInt64LE(0xffffffn, 0x100 + 0x30);
  assert.throws(() => replaceIcon(bad, Buffer.from("ICON")), /past the file/);
});
