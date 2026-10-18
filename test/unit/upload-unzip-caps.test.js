import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { unzip } from "../../src/meta/library-upload.js";

// An admin's .zip upload (patches, saves) is unpacked only when what it says it
// holds fits: a few KB that expand past the cap are refused before anything is written.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "cook-unzip-caps-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));

function zipOf(name, files) {
  const src = path.join(root, `${name}-src`);
  fs.mkdirSync(src);
  for (const [rel, bytes] of Object.entries(files)) fs.writeFileSync(path.join(src, rel), Buffer.alloc(bytes));
  const zip = path.join(root, `${name}.zip`);
  execFileSync("zip", ["-qr", zip, "."], { cwd: src });
  return zip;
}

test("a zip that unpacks past the size cap is refused and nothing is written", async () => {
  const zip = zipOf("bomb", { "zeros.bin": 2_000_000 });
  assert.ok(fs.statSync(zip).size < 20_000, "small on the wire");
  const out = path.join(root, "bomb-out");
  fs.mkdirSync(out);
  await assert.rejects(unzip(zip, out, { maxBytes: 1_000_000 }), (err) => err.status === 413);
  assert.deepEqual(fs.readdirSync(out), []);
});

test("a zip with more entries than the cap is refused", async () => {
  const zip = zipOf("many", Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`f${i}.txt`, 1])));
  const out = path.join(root, "many-out");
  fs.mkdirSync(out);
  await assert.rejects(unzip(zip, out, { maxEntries: 10 }), (err) => err.status === 413);
  assert.deepEqual(fs.readdirSync(out), []);
});

/** A zip whose headers claim every file holds 10 bytes, whatever it really inflates to. */
function lyingZipOf(name, bytes) {
  const buf = fs.readFileSync(zipOf(name, { "zeros.bin": bytes }));
  for (let i = 0; i + 4 <= buf.length; i++) {
    const sig = buf.readUInt32LE(i);
    if (sig === 0x04034b50) buf.writeUInt32LE(10, i + 22);
    if (sig === 0x02014b50) buf.writeUInt32LE(10, i + 24);
  }
  const zip = path.join(root, `${name}-lying.zip`);
  fs.writeFileSync(zip, buf);
  return zip;
}

test("a zip that lies about its sizes is stopped by what it actually writes", async () => {
  const zip = lyingZipOf("liar", 5_000_000);
  const out = path.join(root, "liar-out");
  fs.mkdirSync(out);
  await assert.rejects(unzip(zip, out, { maxBytes: 1_000_000 }), (err) => err.status === 413);
  assert.deepEqual(fs.readdirSync(out), [], "what was written is removed");
});

test("a zip within both caps unpacks", async () => {
  const zip = zipOf("fine", { "a.bin": 1000, "b.bin": 1000 });
  const out = path.join(root, "fine-out");
  fs.mkdirSync(out);
  await unzip(zip, out, { maxBytes: 10_000, maxEntries: 10 });
  assert.deepEqual(fs.readdirSync(out).sort(), ["a.bin", "b.bin"]);
});
