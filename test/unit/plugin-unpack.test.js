import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { unpackPlugin, UnpackError, UNPACK_LIMITS } from "../../src/plugins/unpack.js";
import { zip, good, PLUGIN_JSON, INDEX_JS } from "../support/zip-builder.js";

const work = fs.mkdtempSync(path.join(os.tmpdir(), "cf-unpack-"));
after(() => fs.rmSync(work, { recursive: true, force: true }));
let n = 0;
const fresh = () => path.join(work, `d${n++}`);
const listing = (dir) => fs.readdirSync(dir, { recursive: true }).sort();

/** Refused with `code`, and nothing left on disk (neither the folder nor anything beside it). */
async function refused(buffer, code, limits) {
  const dest = fresh();
  const codes = [].concat(code);
  await assert.rejects(() => unpackPlugin(buffer, dest, limits), (err) => err instanceof UnpackError && codes.includes(err.code), String(code));
  assert.equal(fs.existsSync(dest), false, "nothing left behind");
}

test("a good zip unpacks to plain files with their manifest", async () => {
  const dest = fresh();
  const r = await unpackPlugin(zip(good([{ name: "lib/", data: "" }, { name: "lib/util.js", data: "export const x = 1;" }])), dest);
  assert.equal(r.manifest.id, "demo");
  assert.equal(r.manifest.version, "1.2.0");
  assert.deepEqual(listing(dest), ["index.js", "lib", path.join("lib", "util.js"), "plugin.json"]);
  assert.equal(fs.readFileSync(path.join(dest, "index.js"), "utf8"), INDEX_JS);
  assert.equal(fs.statSync(path.join(dest, "index.js")).mode & 0o777, 0o644);
  assert.equal(fs.statSync(path.join(dest, "lib")).mode & 0o777, 0o755);
  assert.equal(r.files, 3);
});

test("one folder around everything is taken off; junk the OS adds is skipped", async () => {
  const dest = fresh();
  await unpackPlugin(zip([{ name: "demo/", data: "" }, { name: "demo/plugin.json", data: PLUGIN_JSON }, { name: "demo/index.js", data: INDEX_JS }, { name: "__MACOSX/demo/._index.js", data: "x" }, { name: "demo/.DS_Store", data: "x" }]), dest);
  assert.deepEqual(listing(dest), ["index.js", "plugin.json"]);
});

test("names that leave the folder or hide a trick are refused", async () => {
  for (const name of ["../evil.js", "a/../../evil.js", "/etc/evil.js", "..\\evil.js", "C:/evil.js", "a//b.js", "./x.js", "a\0b.js"]) {
    // yauzl itself refuses some of these as a bad zip before the unpacker's own check sees them; either way nothing is written.
    await refused(zip(good([{ name, data: "x" }])), ["bad-name", "bad-zip"]);
  }
  await refused(zip(good([{ name: "x".repeat(241), data: "x" }])), "bad-name");
  await refused(zip(good([{ name: "a/b/c/d/e/f/g/h/i.js", data: "x" }])), "too-deep");
});

test("symlinks and other special entries are refused; a DOS-made zip has no modes to check", async () => {
  await refused(zip(good([{ name: "link", data: "/etc/passwd", mode: 0o120777 }])), "special-entry");
  await refused(zip(good([{ name: "dev", data: "", mode: 0o020666 }])), "special-entry");
  await refused(zip(good([{ name: "dir/", data: "", mode: 0o120777 }])), "special-entry");
  const dest = fresh();
  await unpackPlugin(zip([{ name: "plugin.json", data: PLUGIN_JSON, host: "dos" }, { name: "index.js", data: INDEX_JS, host: "dos" }]), dest);
});

test("two names that differ only in case are refused", async () => {
  await refused(zip(good([{ name: "Lib.js", data: "a" }, { name: "lib.JS", data: "b" }])), "duplicate-name");
  await refused(zip(good([{ name: "same.js", data: "a" }, { name: "same.js", data: "b" }])), "duplicate-name");
});

test("encrypted entries and unknown methods are refused", async () => {
  await refused(zip(good([{ name: "secret.js", data: "x", encrypted: true }])), "encrypted");
  const odd = zip(good());
  odd.writeUInt16LE(12, odd.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 10); // central header of the first entry: method 12 (bzip2)
  await refused(odd, "bad-method");
});

test("too many entries, a file or a total over its limit, and a zip over its limit are refused", async () => {
  await refused(zip(good(Array.from({ length: 6 }, (_, i) => ({ name: `f${i}.js`, data: "x" })))), "too-many-entries", { entries: 5 });
  await refused(zip(good([{ name: "big.bin", data: Buffer.alloc(2000) }])), "file-too-large", { fileBytes: 1000 });
  await refused(zip(good([{ name: "a.bin", data: Buffer.alloc(800) }, { name: "b.bin", data: Buffer.alloc(800) }])), "too-large", { fileBytes: 1000, totalBytes: 1500 });
  await refused(zip(good()), "zip-too-large", { zipBytes: 100 });
  await refused(Buffer.alloc(0), "bad-zip");
  await refused(Buffer.from("this is not a zip"), "bad-zip");
});

test("a zip bomb is stopped by the bytes written, not by what its headers say", async () => {
  // 70 MB of zeros deflates to ~70 KB: honest headers, over the 64 MB total.
  const bomb = zip(good([{ name: "a.bin", data: Buffer.alloc(30 * 1024 * 1024) }, { name: "b.bin", data: Buffer.alloc(30 * 1024 * 1024) }, { name: "c.bin", data: Buffer.alloc(10 * 1024 * 1024) }]));
  assert.ok(bomb.length < 1024 * 1024);
  await refused(bomb, "too-large");
  // Headers that understate the entry: the stream is longer than it claimed.
  await refused(zip(good([{ name: "lie.bin", data: Buffer.alloc(5000), claim: 10 }])), "bad-zip");
  assert.equal(UNPACK_LIMITS.totalBytes, 64 * 1024 * 1024);
});

test("a zip without a usable manifest or entry file is refused", async () => {
  await refused(zip([{ name: "index.js", data: INDEX_JS }]), "no-manifest");
  await refused(zip([{ name: "plugin.json", data: PLUGIN_JSON }]), "no-index");
  await refused(zip([{ name: "plugin.json", data: "{nope" }, { name: "index.js", data: INDEX_JS }]), "bad-manifest");
  await refused(zip([{ name: "plugin.json", data: JSON.stringify({ id: "Bad Id", apiVersion: 1, version: "1.0.0", name: { en: "x" }, provides: ["metadata"] }) }, { name: "index.js", data: INDEX_JS }]), "bad-manifest");
  await refused(zip([{ name: "plugin.json", data: JSON.stringify({ id: "demo", apiVersion: 2, version: "1.0.0", name: { en: "x" } }) }, { name: "index.js", data: INDEX_JS }]), "incompatible");
  await refused(zip([{ name: "a/plugin.json", data: PLUGIN_JSON }, { name: "b/index.js", data: INDEX_JS }]), "no-manifest");
});
