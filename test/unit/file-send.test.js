// Game files are read in large pieces but answer exactly as express.static did:
// ranges, If-Range, validators and the paths it refuses.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import express from "express";
import { largeFiles, parseRange, GAME_FILE_RE } from "../../src/helpers/file-send.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "file-send-"));
const body = Buffer.from(Array.from({ length: 10_000 }, (_, i) => i % 251));
let server, base, staticEtag;

before(async () => {
  fs.mkdirSync(path.join(root, "Game [0100000000010000]"));
  fs.writeFileSync(path.join(root, "Game [0100000000010000]", "game.nsz"), body);
  fs.writeFileSync(path.join(root, ".hidden.nsp"), body);
  fs.writeFileSync(path.join(root, "notes.txt"), "plain");
  const app = express();
  app.use(largeFiles(root, GAME_FILE_RE));
  app.use(express.static(root));
  await new Promise((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  // what express.static alone would say for the same file
  const plain = express().use(express.static(root));
  const s2 = await new Promise((resolve) => { const s = plain.listen(0, "127.0.0.1", () => resolve(s)); });
  staticEtag = (await fetch(`http://127.0.0.1:${s2.address().port}/Game%20%5B0100000000010000%5D/game.nsz`, { method: "HEAD" })).headers.get("etag");
  s2.close();
});
after(() => { server.close(); fs.rmSync(root, { recursive: true, force: true }); });

const url = `/Game%20%5B0100000000010000%5D/game.nsz`;

test("a whole file comes back with the same validators as express.static", async () => {
  const r = await fetch(base + url);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("accept-ranges"), "bytes");
  assert.equal(r.headers.get("etag"), staticEtag);
  assert.ok(r.headers.get("last-modified"));
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), body);
});

test("a range comes back as 206 with its bytes, an open range runs to the end, a suffix takes the tail", async () => {
  let r = await fetch(base + url, { headers: { Range: "bytes=100-199" } });
  assert.equal(r.status, 206);
  assert.equal(r.headers.get("content-range"), `bytes 100-199/${body.length}`);
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), body.subarray(100, 200));
  r = await fetch(base + url, { headers: { Range: "bytes=9990-" } });
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), body.subarray(9990));
  r = await fetch(base + url, { headers: { Range: "bytes=-5" } });
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), body.subarray(body.length - 5));
});

test("a range past the end is 416, and If-Range with another file's tag sends the whole file", async () => {
  let r = await fetch(base + url, { headers: { Range: "bytes=20000-" } });
  assert.equal(r.status, 416);
  assert.equal(r.headers.get("content-range"), `bytes */${body.length}`);
  r = await fetch(base + url, { headers: { Range: "bytes=0-9", "If-Range": staticEtag } });
  assert.equal(r.status, 206);
  r = await fetch(base + url, { headers: { Range: "bytes=0-9", "If-Range": 'W/"1-1"' } });
  assert.equal(r.status, 200);
  assert.equal(Number(r.headers.get("content-length")), body.length);
});

test("HEAD has headers only and a matching If-None-Match is 304", async () => {
  let r = await fetch(base + url, { method: "HEAD" });
  assert.equal(r.status, 200);
  assert.equal(Number(r.headers.get("content-length")), body.length);
  // plain http: fetch adds "Cache-Control: no-cache" to a conditional request, which always reads as stale
  const status = await new Promise((resolve, reject) => {
    http.get(base + url, { headers: { "If-None-Match": staticEtag } }, (res) => { res.resume(); resolve(res.statusCode); }).on("error", reject);
  });
  assert.equal(status, 304);
});

test("hidden files, other files and paths that leave the folder are left to express.static", async () => {
  assert.equal((await fetch(base + "/.hidden.nsp")).status, 404);
  assert.equal(await (await fetch(base + "/notes.txt")).text(), "plain");
  assert.equal((await fetch(base + "/..%2F..%2Fetc%2Fpasswd.nsp")).status, 404);
});

test("parseRange reads one byte range and refuses the rest", () => {
  assert.deepEqual(parseRange("bytes=0-9", 100), { start: 0, end: 9 });
  assert.deepEqual(parseRange("bytes=90-200", 100), { start: 90, end: 99 });
  assert.equal(parseRange("bytes=0-1,5-6", 100), null);
  assert.equal(parseRange("items=0-1", 100), null);
  assert.deepEqual(parseRange("bytes=-0", 100), { unsatisfiable: true });
});
