import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// A titledb mirror answers 200 with whatever it has. Only a real region file
// replaces the cache, and a mirror that hangs or floods is cut off.
const dir = mkdtempSync(path.join(tmpdir(), "cook-tdl-"));
process.env.COOK_DATA_DIR = dir;
// The test mirror is on loopback, which outbound URLs may only reach when listed.
process.env.COOK_OUTBOUND_PRIVATE_HOSTS = "127.0.0.1";
const { downloadToFile } = await import("../../src/meta/titledb-download.js");
const { fetchRegion, rejectReason } = await import("../../src/meta/titledb-fetcher.js");
const versions = await import("../../src/meta/titledb-versions.js");

const regionWith = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => {
  const id = (0x0100000000010000 + i * 0x2000).toString(16).toUpperCase().padStart(16, "0");
  return [String(70010000000000 + i), { id, name: `Game ${i}` }];
}));

let handler = (req, res) => res.end("{}");
const server = createServer((req, res) => handler(req, res));
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

async function withMirrorFetch(body, run) {
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200 });
  try { return await run(); } finally { globalThis.fetch = real; }
}

test("an unlisted private mirror is refused before it is asked", async () => {
  const guard = await import("../../src/security/outbound-guard.js");
  await assert.rejects(downloadToFile("http://10.0.0.9/KR.ko.json", path.join(dir, "private.json")), guard.OutboundError);
});

test("a mirror that stops sending is cut off and leaves no partial file", async () => {
  handler = (req, res) => { res.writeHead(200); res.write("{\"a\":"); };
  const dest = path.join(dir, "stall.json");
  await assert.rejects(downloadToFile(`${base}/x`, dest, { stallMs: 200 }), /no data/);
  assert.equal(existsSync(dest), false);
});

test("a body over the size limit is refused", async () => {
  handler = (req, res) => { res.writeHead(200); res.end("x".repeat(5000)); };
  const dest = path.join(dir, "big.json");
  await assert.rejects(downloadToFile(`${base}/x`, dest, { maxBytes: 1000 }), /limit/);
  assert.equal(existsSync(dest), false);
});

test("a file that cannot be written fails the download instead of the process", async () => {
  handler = (req, res) => { res.writeHead(200); res.end("x".repeat(256 * 1024)); };
  const dest = path.join(dir, "a-directory");
  mkdirSync(dest);
  await assert.rejects(downloadToFile(`${base}/x`, dest), /EISDIR/);
});

test("a non-2xx answer writes nothing", async () => {
  handler = (req, res) => { res.writeHead(503); res.end("busy"); };
  const dest = path.join(dir, "busy.json");
  assert.deepEqual(await downloadToFile(`${base}/x`, dest), { status: 503 });
  assert.equal(existsSync(dest), false);
});

test("a region file replaces the cache and writes its slim sibling", async () => {
  const dest = path.join(dir, "ok");
  const result = await withMirrorFetch(regionWith(40), () => fetchRegion("KR.ko", dest));
  assert.equal(result.ok, true);
  const slim = JSON.parse(readFileSync(path.join(dest, "KR.ko.slim.json"), "utf8"));
  assert.equal(Object.keys(slim).length - 1, 40);
});

test("the wrong JSON from a mirror leaves the cached region untouched", async () => {
  const dest = path.join(dir, "wrong");
  await withMirrorFetch(regionWith(40), () => fetchRegion("KR.ko", dest));
  const before = readFileSync(path.join(dest, "KR.ko.json"), "utf8");
  for (const body of [{}, { "0100000000010000": { "65536": "2020-01-01" } }, "[]", "<html>captcha</html>"]) {
    const result = await withMirrorFetch(body, () => fetchRegion("KR.ko", dest));
    assert.equal(result.ok, false, JSON.stringify(body));
    assert.equal(readFileSync(path.join(dest, "KR.ko.json"), "utf8"), before);
    assert.deepEqual(readdirSync(dest).filter((f) => f.endsWith(".tmp")), [], "no download left behind");
  }
  const slim = JSON.parse(readFileSync(path.join(dest, "KR.ko.slim.json"), "utf8"));
  assert.equal(Object.keys(slim).length - 1, 40, "the slim index keeps every game");
});

test("a region that shrinks to under half is refused, a smaller one is kept", async () => {
  const dest = path.join(dir, "shrink");
  await withMirrorFetch(regionWith(40), () => fetchRegion("US.en", dest));
  assert.equal((await withMirrorFetch(regionWith(19), () => fetchRegion("US.en", dest))).ok, false);
  assert.equal((await withMirrorFetch(regionWith(30), () => fetchRegion("US.en", dest))).ok, true);
  assert.equal(rejectReason(5, 0), "only 5 games");
  assert.equal(rejectReason(50, 0), null, "a first download only needs games in it");
});

const versionsWith = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [
  (0x0100000000010000 + i * 0x2000).toString(16).padStart(16, "0"), { "65536": "2024-01-01" },
]));
const cnmtsWith = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [
  (0x0100000000010000 + i * 0x2000).toString(16).padStart(16, "0"), { "0": { titleType: 128, requiredSystemVersion: 16 << 26 } },
]));

test("the update index is kept when a mirror sends the wrong files", async () => {
  const real = globalThis.fetch;
  const serve = (v, c) => { globalThis.fetch = async (url) => new Response(JSON.stringify(String(url).endsWith("versions.json") ? v : c)); };
  try {
    serve(versionsWith(40), cnmtsWith(40));
    assert.equal(await versions.refresh(), true);
    assert.equal(versions.latestVersion("0100000000010000"), 65536);
    for (const [v, c] of [[{}, cnmtsWith(40)], [versionsWith(40), {}], [versionsWith(15), cnmtsWith(40)], [regionWith(40), regionWith(40)]]) {
      serve(v, c);
      assert.equal(await versions.refresh(), false);
      assert.equal(versions.latestVersion("0100000000010000"), 65536);
    }
    const onDisk = JSON.parse(readFileSync(path.join(dir, "titledb", "versions-index.json"), "utf8"));
    assert.equal(Object.keys(onDisk.updates).length, 40);
    assert.deepEqual(readdirSync(path.join(dir, "titledb")).filter((f) => f.endsWith(".tmp")), []);
  } finally {
    globalThis.fetch = real;
  }
});

test("an empty update index is refused even when nothing is cached yet", () => {
  assert.match(versions.rejectReason({ updates: {}, firmware: {} }, { updates: {}, firmware: {} }), /only 0/);
});
