import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parsePfs0Header, readPfs0Entries, copyPfs0Entry } from "../../src/meta/pfs0.js";

function buildPfs0(files) {
  const names = Buffer.concat(files.map(([name]) => Buffer.from(name + "\0")));
  const header = Buffer.alloc(0x10 + files.length * 0x18);
  header.write("PFS0", 0, "ascii");
  header.writeUInt32LE(files.length, 4);
  header.writeUInt32LE(names.length, 8);
  let dataOffset = 0, nameOffset = 0;
  files.forEach(([name, data], i) => {
    const at = 0x10 + i * 0x18;
    header.writeBigUInt64LE(BigInt(dataOffset), at);
    header.writeBigUInt64LE(BigInt(data.length), at + 8);
    header.writeUInt32LE(nameOffset, at + 16);
    dataOffset += data.length;
    nameOffset += name.length + 1;
  });
  return Buffer.concat([header, names, ...files.map(([, data]) => data)]);
}

test("pfs0: lists entries with absolute offsets and copies one without the rest", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cf-pfs0-"));
  const file = path.join(dir, "u.nsp");
  writeFileSync(file, buildPfs0([
    ["abc.cnmt.nca", Buffer.from("meta-bytes")],
    ["big.nca", Buffer.alloc(3 * 1024 * 1024, 7)],
    ["ctrl.nca", Buffer.from("control-bytes")],
  ]));
  const entries = await readPfs0Entries(file);
  assert.deepEqual(entries.map((e) => [e.name, e.size]), [["abc.cnmt.nca", 10], ["big.nca", 3 * 1024 * 1024], ["ctrl.nca", 13]]);
  const out = path.join(dir, "ctrl.nca");
  await copyPfs0Entry(file, entries[2], out);
  assert.equal(readFileSync(out, "utf8"), "control-bytes");
});

test("pfs0: anything that is not a PFS0 is refused", async () => {
  assert.equal(parsePfs0Header(Buffer.from("HFS0aaaaaaaaaaaaaaaa")), null);
  const dir = mkdtempSync(path.join(tmpdir(), "cf-pfs0-"));
  const file = path.join(dir, "x.xci");
  writeFileSync(file, Buffer.alloc(64));
  assert.equal(await readPfs0Entries(file), null);
});
