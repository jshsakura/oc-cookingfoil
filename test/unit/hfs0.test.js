import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseHfs0Header, readXciSecureEntries } from "../../src/meta/hfs0.js";
import { buildHfs0, buildXci } from "../support/switch-files.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "cook-hfs0-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));

test("parseHfs0Header lists names, sizes, hashed sizes and hashes, offsets after the string table", () => {
  const hfs = buildHfs0([{ name: "a.nca", data: Buffer.alloc(10, 1), hashedSize: 0x200 }, { name: "bb.nca", data: Buffer.alloc(5, 2) }]);

  const parsed = parseHfs0Header(hfs, 0x1000);

  assert.equal(parsed.entries.length, 2);
  const [a, b] = parsed.entries;
  assert.equal(a.name, "a.nca");
  assert.equal(a.size, 10);
  assert.equal(a.hashedSize, 0x200);
  assert.match(a.sha256, /^[0-9a-f]{64}$/);
  assert.equal(b.name, "bb.nca");
  // Data starts after the header, the 0x40-byte entries and the string table; offsets are absolute.
  assert.equal(hfs[a.offset - 0x1000], 1);
  assert.equal(hfs[b.offset - 0x1000], 2);
});

test("parseHfs0Header asks for more bytes when the buffer stops inside the string table", () => {
  const hfs = buildHfs0([{ name: "a.nca", data: Buffer.alloc(4) }]);

  const parsed = parseHfs0Header(hfs.subarray(0, 0x20));

  assert.ok(parsed.needBytes > 0x20);
});

test("parseHfs0Header returns null for anything that is not an HFS0", () => {
  assert.equal(parseHfs0Header(Buffer.from("PFS0".padEnd(0x40, "\0"))), null);
  assert.equal(parseHfs0Header(Buffer.alloc(4)), null);
  assert.equal(parseHfs0Header(null), null);
});

test("readXciSecureEntries finds the secure partition's NCAs with absolute offsets", async () => {
  const nca = Buffer.alloc(0x40, 7);
  const file = path.join(root, "game.xci");
  fs.writeFileSync(file, buildXci([{ name: "0123456789abcdef0123456789abcdef.nca", data: nca }]));

  const entries = await readXciSecureEntries(file);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, "0123456789abcdef0123456789abcdef.nca");
  const bytes = fs.readFileSync(file).subarray(entries[0].offset, entries[0].offset + entries[0].size);
  assert.deepEqual(bytes, nca);
});

test("readXciSecureEntries also reads an image with a 0x1000 key area in front", async () => {
  const file = path.join(root, "keyed.xci");
  fs.writeFileSync(file, Buffer.concat([Buffer.alloc(0x1000), buildXci([{ name: "a.nca", data: Buffer.alloc(8, 3) }])]));

  const entries = await readXciSecureEntries(file);

  assert.equal(entries[0].name, "a.nca");
  assert.equal(fs.readFileSync(file)[entries[0].offset], 3);
});

test("readXciSecureEntries returns null for a file that is not a gamecard image", async () => {
  const file = path.join(root, "junk.xci");
  fs.writeFileSync(file, Buffer.alloc(0x400, 9));

  assert.equal(await readXciSecureEntries(file), null);
});
