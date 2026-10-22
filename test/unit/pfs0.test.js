import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parsePfs0Header, readPfs0Entries, copyPfs0Entry, MAX_CNMT_NCA_BYTES, MAX_CONTROL_NCA_BYTES } from "../../src/meta/pfs0.js";

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

// A PFS0 header whose entry table lies about where an entry is or how big it is.
function lyingPfs0(entry, tailBytes = 1 << 20) {
  const name = Buffer.from(`${entry.name}\0`);
  const header = Buffer.alloc(0x10 + 0x18);
  header.write("PFS0", 0, "ascii");
  header.writeUInt32LE(1, 4);
  header.writeUInt32LE(name.length, 8);
  header.writeBigUInt64LE(BigInt(entry.offset), 0x10);
  header.writeBigUInt64LE(BigInt(entry.size), 0x18);
  return Buffer.concat([header, name, Buffer.alloc(tailBytes, 1)]);
}

test("pfs0: an entry that reaches past the end of the file or past the cap is refused before a byte is written", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cf-pfs0-"));
  const cases = {
    "size past the end": { offset: 0, size: 2 ** 40 },
    "u64 max size": { offset: 0, size: "18446744073709551615" },
    "offset past the end": { offset: 2 ** 50, size: 100 },
    "u64 max offset": { offset: "18446744073709551615", size: 1 },
    "one byte past the end": { offset: 1, size: 1 << 20 },
  };
  for (const [label, lie] of Object.entries(cases)) {
    const file = path.join(dir, "bad.nsp");
    writeFileSync(file, lyingPfs0({ name: "a.cnmt.nca", ...lie }));
    const [entry] = await readPfs0Entries(file);
    const out = path.join(dir, "out.nca");
    await assert.rejects(copyPfs0Entry(file, entry, out), /outside the file/, label);
    assert.equal(existsSync(out), false, `${label}: nothing written`);
  }
  const file = path.join(dir, "big.nsp");
  writeFileSync(file, lyingPfs0({ name: "a.cnmt.nca", offset: 0, size: 2 << 20 }, 2 << 20));
  const [entry] = await readPfs0Entries(file);
  const out = path.join(dir, "out.nca");
  await assert.rejects(copyPfs0Entry(file, entry, out, { maxBytes: MAX_CNMT_NCA_BYTES }), /bigger than/);
  assert.equal(existsSync(out), false, "a cnmt NCA over its cap is not copied");
  await copyPfs0Entry(file, entry, out);
  assert.equal(statSync(out).size, 2 << 20, "within the default cap it copies");
  assert.equal(MAX_CNMT_NCA_BYTES, 1 << 20);
  assert.equal(MAX_CONTROL_NCA_BYTES, 64 << 20);
  rmSync(dir, { recursive: true, force: true });
});
