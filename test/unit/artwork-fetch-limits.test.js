import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Artwork comes from URLs in titledb (third-party JSON): a slow or endless
// upstream must end in a miss, never hold the request or its memory open.
process.env.COOK_DATA_DIR = fs.mkdtempSync(path.join(tmpdir(), "cook-art-fetch-"));
const { fetchArtwork } = await import("../../src/meta/image-cache.js");

const server = http.createServer((req, res) => {
  if (req.url === "/huge") {
    res.writeHead(200, { "Content-Type": "image/jpeg" });
    const chunk = Buffer.alloc(64 * 1024);
    const pump = () => { while (res.write(chunk)); };
    res.on("drain", pump);
    pump();
    return;
  }
  if (req.url === "/stall") { res.writeHead(200); res.write("x"); return; }
  res.writeHead(200, { "Content-Type": "image/jpeg" });
  res.end(Buffer.alloc(1000, 7));
});
server.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const url = (p) => `http://127.0.0.1:${server.address().port}${p}`;
after(() => { server.closeAllConnections(); server.close(); });

test("a body past the size cap is cut off", async () => {
  await assert.rejects(fetchArtwork(url("/huge"), { maxBytes: 256 * 1024, timeoutMs: 5000 }), /larger than/);
});

test("an upstream that stops sending times out", async () => {
  const started = Date.now();
  await assert.rejects(fetchArtwork(url("/stall"), { maxBytes: 1024, timeoutMs: 300 }));
  assert.ok(Date.now() - started < 3000, "gave up near the timeout");
});

test("a normal picture comes back whole", async () => {
  const { buf, contentType } = await fetchArtwork(url("/ok"), { maxBytes: 4096, timeoutMs: 5000 });
  assert.equal(buf.length, 1000);
  assert.equal(contentType, "image/jpeg");
});
