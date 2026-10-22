import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { execFileSync } from "node:child_process";
import { parseRange } from "../../src/helpers/byte-range.js";
import { sendTar } from "../../src/helpers/tar-stream.js";

test("one byte range is read; anything else sends the whole body", () => {
  assert.deepEqual(parseRange({ range: "bytes=0-99" }, 1000, "e"), [0, 99]);
  assert.deepEqual(parseRange({ range: "bytes=900-" }, 1000, "e"), [900, 999]);
  assert.deepEqual(parseRange({ range: "bytes=-100" }, 1000, "e"), [900, 999]);
  assert.deepEqual(parseRange({ range: "bytes=990-5000" }, 1000, "e"), [990, 999], "an end past the body is cut");
  assert.equal(parseRange({}, 1000, "e"), null);
  assert.equal(parseRange({ range: "bytes=0-1,5-6" }, 1000, "e"), null, "several ranges: the whole body");
  assert.equal(parseRange({ range: "lines=1-2" }, 1000, "e"), null);
  assert.equal(parseRange({ range: "bytes=1000-" }, 1000, "e"), "unsatisfiable");
  assert.equal(parseRange({ range: "bytes=5-2" }, 1000, "e"), "unsatisfiable");
  assert.deepEqual(parseRange({ range: "bytes=10-", "if-range": '"e"' }, 1000, "e"), [10, 999]);
  assert.equal(parseRange({ range: "bytes=10-", "if-range": '"old"' }, 1000, "e"), null, "changed since: start over");
});

test("a tar download resumes byte for byte, and its bytes follow only from the content hash", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tar-range-"));
  const big = path.join(dir, "data.bin");
  fs.writeFileSync(big, Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 251)));
  fs.writeFileSync(path.join(dir, "small.txt"), "hello");
  const files = () => ["data.bin", "small.txt"].map((n) => {
    const st = fs.statSync(path.join(dir, n));
    return { path: `atmosphere/x/${n}`, abs: path.join(dir, n), size: st.size, mtime: st.mtimeMs / 1000 };
  });
  const app = express();
  app.get("/fixed", (req, res) => sendTar(res, files(), { filename: "p.tar", etag: "contenthash", fixedTimes: true }));
  app.get("/plain", (req, res) => sendTar(res, files(), { filename: "r.tar", etag: "v1" }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (p, headers = {}) => {
    const r = await fetch(base + p, { headers });
    return { r, body: Buffer.from(await r.arrayBuffer()) };
  };
  try {
    const whole = await get("/fixed");
    assert.equal(whole.r.status, 200);
    assert.equal(whole.r.headers.get("accept-ranges"), "bytes");
    assert.equal(whole.r.headers.get("etag"), '"contenthash"');
    assert.equal(Number(whole.r.headers.get("content-length")), whole.body.length);

    // Cut anywhere, including inside headers and file bodies, the pieces join into the same archive.
    for (const cut of [1, 511, 512, 700, 3000, whole.body.length - 1]) {
      const rest = await get("/fixed", { Range: `bytes=${cut}-`, "If-Range": '"contenthash"' });
      assert.equal(rest.r.status, 206, `cut at ${cut}`);
      assert.equal(rest.r.headers.get("content-range"), `bytes ${cut}-${whole.body.length - 1}/${whole.body.length}`);
      assert.ok(Buffer.concat([whole.body.subarray(0, cut), rest.body]).equals(whole.body), `cut at ${cut}`);
    }
    const mid = await get("/fixed", { Range: "bytes=600-1599" });
    assert.ok(mid.body.equals(whole.body.subarray(600, 1600)));
    assert.equal((await get("/fixed", { Range: "bytes=600-", "If-Range": '"other"' })).r.status, 200, "another version: from the start");
    const past = await get("/fixed", { Range: `bytes=${whole.body.length}-` });
    assert.equal(past.r.status, 416);
    assert.equal(past.r.headers.get("content-range"), `bytes */${whole.body.length}`);

    // Touching a file changes no content: a fixed-time archive keeps its bytes and ETag.
    const plainBefore = (await get("/plain")).r.headers.get("etag");
    const later = new Date(Date.now() + 60_000);
    fs.utimesSync(big, later, later);
    const again = await get("/fixed");
    assert.ok(again.body.equals(whole.body), "same hash, same bytes");
    assert.notEqual((await get("/plain")).r.headers.get("etag"), plainBefore, "otherwise the ETag follows the file times");
  } finally {
    server.close();
  }
});

test("a file of 8 GiB or more has its exact size in a pax record and base-256", async () => {
  const { header, headerSize } = await import("../../src/helpers/ustar.js");
  const size = 49 * 1024 ** 3 + 7;
  const h = header({ path: "atmosphere/contents/0100000000010000/romfs/big.rpf", size, mtime: 0 });
  assert.equal(h.length, headerSize({ path: "atmosphere/contents/0100000000010000/romfs/big.rpf", size }));
  assert.match(h.subarray(512, 1024).toString("utf8"), new RegExp(` size=${size}\n`), "pax size record");
  const own = h.subarray(h.length - 512);
  assert.equal(own[124], 0x80, "GNU base-256 marker");
  assert.equal(own.subarray(125, 136).readBigUInt64BE(3), BigInt(size));
  assert.equal(own[156], "0".charCodeAt(0), "a regular file");
  // A reader sees the real size: Python's tarfile reads pax and base-256 alike.
  const out = execFileSync("python3", ["-c", "import sys,tarfile,io;t=tarfile.open(fileobj=io.BytesIO(sys.stdin.buffer.read()),mode='r|');m=t.next();print(m.name,m.size)"], { input: h });
  assert.equal(out.toString().trim(), `atmosphere/contents/0100000000010000/romfs/big.rpf ${size}`);
  assert.equal(header({ path: "a.bin", size: 3 * 1024 ** 3 }).length, 512, "under 8 GiB: one plain header");
});

test("many small files read ahead still make the same archive, cut anywhere", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tar-ahead-"));
  // More small files than are read at once, a big one among them, and an empty one.
  const sizes = [...Array.from({ length: 30 }, (_, i) => (i * 977) % 4000 + 1), 0, 3 * 1024 * 1024, 700, 513];
  const files = sizes.map((size, i) => {
    const abs = path.join(dir, `f${String(i).padStart(2, "0")}.bin`);
    fs.writeFileSync(abs, Buffer.from(Array.from({ length: size }, (_, j) => (i * 31 + j) % 256)));
    return { path: `switch/app/f${String(i).padStart(2, "0")}.bin`, abs, size, mtime: 0 };
  });
  const app = express();
  app.get("/t", (req, res) => sendTar(res, files, { filename: "t.tar", etag: "h", fixedTimes: true }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/t`;
  const get = async (headers = {}) => Buffer.from(await (await fetch(base, { headers })).arrayBuffer());
  try {
    const whole = await get();
    // Each body is where its header says, with its own bytes.
    let at = 0;
    for (const f of files.filter((x) => x.size)) {
      at = whole.indexOf(`${f.path}\0`, at);
      assert.ok(whole.subarray(at + 512, at + 512 + f.size).equals(fs.readFileSync(f.abs)), f.path);
    }
    for (const cut of [100, 5000, 40_000, 1_000_000, whole.length - 600]) {
      const rest = await get({ Range: `bytes=${cut}-`, "If-Range": '"h"' });
      assert.ok(Buffer.concat([whole.subarray(0, cut), rest]).equals(whole), `cut at ${cut}`);
    }
    // A small file that shrank stops the download rather than shifting every later entry.
    fs.truncateSync(files[20].abs, 1);
    await assert.rejects(get());
  } finally {
    server.close();
  }
});

test("a file that grew after the listing was made stops the download instead of being cut short", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tar-grew-"));
  const f = path.join(dir, "body.nro");
  fs.writeFileSync(f, "x".repeat(26));
  const { archive } = await import("../../src/helpers/tar-stream.js");
  const entries = [{ path: "switch/body.nro", abs: f, size: 26, mtime: 0 }];
  fs.writeFileSync(f, "y".repeat(38));
  await assert.rejects(async () => { for await (const _chunk of archive(entries)) { /* drain */ } }, /changed while sending/);
});
