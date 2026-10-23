import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { entryStream, zipDirectory } from "../../src/helpers/zip-read.js";

// Zips whose directory lies: a central directory far bigger than its entries,
// and an entry that inflates far past the size it declares.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "zip-read-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));

/** A one-file zip of `body` (deflated), declaring `size` as its uncompressed size, with `pad` bytes after its directory record counted in the directory. */
function oneFileZip(name, data, { size = data.length, pad = 0 } = {}) {
  const body = zlib.deflateRawSync(data);
  const nameBuf = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(size, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  const dir = Buffer.alloc(46);
  dir.writeUInt32LE(0x02014b50, 0);
  dir.writeUInt16LE(8, 10);
  dir.writeUInt32LE(zlib.crc32(data) >>> 0, 16);
  dir.writeUInt32LE(body.length, 20);
  dir.writeUInt32LE(size, 24);
  dir.writeUInt16LE(nameBuf.length, 28);
  const head = Buffer.concat([local, nameBuf, body]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + nameBuf.length + pad, 12);
  end.writeUInt32LE(head.length, 16);
  const abs = path.join(root, `${name}.zip`);
  fs.writeFileSync(abs, Buffer.concat([head, dir, nameBuf]));
  // The padding is a hole in a sparse file: nothing is written for it.
  if (pad) fs.truncateSync(abs, head.length + 46 + nameBuf.length + pad);
  fs.appendFileSync(abs, end);
  return abs;
}

test("a zip whose directory reads as it should lists its entry", async () => {
  const entries = await zipDirectory(oneFileZip("ok.bin", Buffer.alloc(100, 1)));
  assert.deepEqual(entries.map((e) => [e.name, e.size]), [["ok.bin", 100]]);
});

test("a central directory over 64 MB, or too big for its entry count, is not read", async () => {
  assert.deepEqual(await zipDirectory(oneFileZip("huge.bin", Buffer.alloc(100, 1), { pad: 65 * 1024 * 1024 })), []);
  assert.deepEqual(await zipDirectory(oneFileZip("padded.bin", Buffer.alloc(100, 1), { pad: 300 * 1024 })), [], "one entry cannot fill 300 KB");
});

test("an entry that inflates past its declared size fails instead of going on", async () => {
  const abs = oneFileZip("bomb.bin", Buffer.alloc(16 * 1024 * 1024), { size: 1024 });
  const [entry] = await zipDirectory(abs);
  const stream = await entryStream(abs, entry);
  let read = 0;
  await assert.rejects(async () => {
    for await (const chunk of stream) read += chunk.length;
  }, /declared/);
  assert.ok(read <= 1024 + 64 * 1024, `stopped early, passed on ${read} bytes`);
});

test("an entry of its declared size streams whole", async () => {
  const data = Buffer.from(Array.from({ length: 5000 }, (_, i) => i & 0xff));
  const abs = oneFileZip("fine.bin", data);
  const [entry] = await zipDirectory(abs);
  const chunks = [];
  for await (const chunk of await entryStream(abs, entry)) chunks.push(chunk);
  assert.deepEqual(Buffer.concat(chunks), data);
});
