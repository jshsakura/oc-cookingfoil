import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import express from "express";
import jsonCompression, { pickEncoding } from "../../src/helpers/json-compression.js";

const BIG = { items: Array.from({ length: 200 }, (_, i) => ({ id: i, name: `Game ${i}` })) };

async function serve() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "json-gz-"));
  fs.writeFileSync(path.join(dir, "data.json"), JSON.stringify(BIG));
  const app = express();
  app.use(jsonCompression());
  app.get("/big", (req, res) => res.json(BIG));
  app.get("/small", (req, res) => res.json({ ok: true }));
  app.get("/ended", (req, res) => res.type("application/json").end(JSON.stringify(BIG)));
  app.get("/file", (req, res) => res.sendFile(path.join(dir, "data.json")));
  app.get("/attachment", (req, res) => res.attachment("backup.json").json(BIG));
  app.get("/text", (req, res) => res.type("text/plain").send("x".repeat(5000)));
  app.get("/pre", (req, res) => res.set({ "Content-Type": "application/json", "Content-Encoding": "gzip" }).send(zlib.gzipSync(JSON.stringify(BIG))));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

const raw = (url, headers = { "Accept-Encoding": "gzip" }) => new Promise((resolve, reject) => {
  http.get(url, { headers }, (res) => {
    const chunks = [];
    res.on("data", (c) => chunks.push(c)).on("end", () => resolve({ headers: res.headers, body: Buffer.concat(chunks) }));
  }).on("error", reject);
});

test("JSON over 1 KB goes gzipped to a client that accepts it, and nothing else changes", async () => {
  const { server, base } = await serve();
  try {
    const big = await raw(`${base}/big`);
    assert.equal(big.headers["content-encoding"], "gzip");
    assert.deepEqual(JSON.parse(zlib.gunzipSync(big.body)), BIG);
    assert.ok(big.body.length < JSON.stringify(BIG).length / 3);
    assert.equal((await raw(`${base}/ended`)).headers["content-encoding"], "gzip", "a body written with res.end too");
    const br = await raw(`${base}/big`, { "Accept-Encoding": "gzip, deflate, br" });
    assert.equal(br.headers["content-encoding"], "br", "brotli first, as a browser lists it last");
    assert.deepEqual(JSON.parse(zlib.brotliDecompressSync(br.body)), BIG);

    assert.equal((await raw(`${base}/big`, {})).headers["content-encoding"], undefined, "no Accept-Encoding, plain");
    assert.equal((await raw(`${base}/small`)).headers["content-encoding"], undefined, "under 1 KB, plain");
    assert.equal((await raw(`${base}/text`)).headers["content-encoding"], undefined, "only JSON");

    const file = await raw(`${base}/file`);
    assert.equal(file.headers["content-encoding"], undefined, "a file keeps its bytes");
    assert.equal(file.headers["accept-ranges"], "bytes");
    assert.equal(Number(file.headers["content-length"]), JSON.stringify(BIG).length);
    assert.equal((await raw(`${base}/attachment`)).headers["content-encoding"], undefined, "a download keeps its bytes");

    const pre = await raw(`${base}/pre`);
    assert.equal(pre.headers["content-encoding"], "gzip");
    assert.deepEqual(JSON.parse(zlib.gunzipSync(pre.body)), BIG, "an already encoded reply is not compressed twice");
  } finally {
    server.close();
  }
});

test("brotli is picked first whenever the client takes it, and a q of 0 refuses", () => {
  assert.equal(pickEncoding("gzip, deflate, br"), "br");
  assert.equal(pickEncoding("gzip, deflate"), "gzip");
  assert.equal(pickEncoding("br;q=0, gzip;q=0.5"), "gzip");
  assert.equal(pickEncoding("*"), "br");
  assert.equal(pickEncoding("*;q=0, gzip"), "gzip");
  assert.equal(pickEncoding("identity"), null);
  assert.equal(pickEncoding(undefined), null);
});
