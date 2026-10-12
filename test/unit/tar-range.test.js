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
