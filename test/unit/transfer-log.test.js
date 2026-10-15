import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

// Download records: which way each download came in, how many bytes really
// went out, and how fast. Parallel Range requests for one file are one transfer.
const data = fs.mkdtempSync(path.join(os.tmpdir(), "cook-transfers-"));
process.env.COOK_DATA_DIR = data;
const express = (await import("express")).default;
const { createTransferLog, addSpan, summarize, logLine, mbpsOf, sizeText } = await import("../../src/helpers/transfer-log.js");
const { routeOf, isLanPeer, trackTransfers, dispositionName, extentOf, requesterOf } = await import("../../src/helpers/transfer-track.js");

const DEVICE = "AB12CD34" + "0".repeat(55) + "1";
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const servers = [];
after(() => { for (const s of servers) { s.closeAllConnections?.(); s.close(); } });

/** A server that records with `log` and answers /file/<size> slowly, honouring one Range. */
async function harness(log) {
  const app = express();
  app.use(trackTransfers({ log }));
  app.get("/file/:size", (req, res) => {
    const size = Number(req.params.size);
    let start = 0, end = size - 1;
    const m = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? "");
    if (m) {
      start = Number(m[1]);
      end = Math.min(size - 1, Number(m[2]));
      res.status(206).set("Content-Range", `bytes ${start}-${end}/${size}`);
    }
    const len = end - start + 1;
    res.set("Content-Length", String(len));
    if (req.query.hang) {
      res.write(Buffer.alloc(Math.min(len, 2 * 1024 * 1024)));
      return; // never ends: the client cuts it off
    }
    const half = Math.floor(len / 2);
    res.write(Buffer.alloc(half));
    setTimeout(() => res.end(Buffer.alloc(len - half)), 120);
  });
  app.get("/missing", (_req, res) => res.status(404).end());
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise((r) => server.once("listening", r));
  return `http://127.0.0.1:${server.address().port}`;
}

/** GET that reads the whole body (as a byte count). */
function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get(url, { headers, agent: false }, (res) => {
      let n = 0;
      res.on("data", (c) => { n += c.length; });
      res.on("end", () => resolve({ status: res.statusCode, bytes: n }));
    }).on("error", reject);
  });
}

const memoryLog = (opts = {}) => {
  const lines = [];
  const log = createTransferLog({ file: null, quietMs: 50, log: (l) => lines.push(l), ...opts });
  return { log, lines };
};

test("route: the direct lane, Cloudflare's headers, a private socket peer, else other", () => {
  assert.equal(routeOf({ lane: "direct", headers: { "cf-ray": "x" }, peer: "127.0.0.1" }), "direct");
  assert.equal(routeOf({ headers: { "cf-ray": "8a-ICN" }, peer: "10.0.0.2" }), "tunnel");
  assert.equal(routeOf({ headers: { "cf-connecting-ip": "203.0.113.7" }, peer: "203.0.113.1" }), "tunnel");
  assert.equal(routeOf({ headers: {}, peer: "10.0.0.20" }), "lan");
  assert.equal(routeOf({ headers: {}, peer: "::ffff:127.0.0.1" }), "lan");
  assert.equal(routeOf({ headers: {}, peer: "172.20.0.1" }), "lan");
  assert.equal(routeOf({ headers: {}, peer: "169.254.3.4" }), "lan");
  assert.equal(routeOf({ headers: {}, peer: "fe80::1" }), "lan");
  assert.equal(routeOf({ headers: {}, peer: "fd12:3456::1" }), "lan");
  assert.equal(routeOf({ headers: {}, peer: "203.0.113.9" }), "other");
  // CGNAT (a VPN overlay) is not the home network; nor is a public peer that forwards a private address.
  assert.equal(routeOf({ headers: {}, peer: "100.64.0.1" }), "other");
  assert.equal(routeOf({ headers: { "x-forwarded-for": "10.0.0.5" }, peer: "203.0.113.9" }), "other");
  assert.equal(isLanPeer("172.32.0.1"), false);
});

test("who: the device key (as an 8-character prefix), else the account, else the address", () => {
  const req = (extra) => ({ get: (h) => extra.headers?.[h.toLowerCase()], headers: {}, ...extra });
  const dev = requesterOf(req({ pairedDevice: DEVICE, auth: { user: "kim" } }), "10.0.0.3");
  assert.equal(dev.kind, "device");
  assert.equal(dev.id, "ab12cd34");
  assert.ok(!dev.label.includes(DEVICE));
  assert.equal(requesterOf(req({ auth: { user: "kim" } }), "10.0.0.3").label, "kim");
  assert.equal(requesterOf(req({ cookingfoilLane: "direct", directSub: { dev: null, acct: { kind: "google", id: "1234567890123" } } }), "203.0.113.4").label, "Google 12345678");
  const ip = requesterOf(req({}), "203.0.113.4");
  assert.deepEqual([ip.kind, ip.label], ["ip", "203.0.113.4"]);
});

test("parallel Range requests for one file are one transfer, with the whole file and the peak", async () => {
  const { log, lines } = memoryLog();
  const base = await harness(log);
  const size = 4 * 1024 * 1024;
  const q = size / 4;
  const parts = await Promise.all([0, 1, 2, 3].map((i) =>
    get(`${base}/file/${size}`, { Range: `bytes=${i * q}-${(i + 1) * q - 1}`, "X-Device-Key": DEVICE, "User-Agent": "CookingFoil/0.3.72" })));
  assert.deepEqual(parts.map((p) => p.status), [206, 206, 206, 206]);
  await tick(20);
  assert.equal(log.active().length, 1);
  log.sweep(Date.now() + 1000);
  const [rec] = log.snapshot().recent;
  assert.equal(log.snapshot().recent.length, 1);
  assert.equal(rec.requests, 4);
  assert.equal(rec.peakConnections, 4);
  assert.equal(rec.bytes, size);
  assert.equal(rec.fileSize, size);
  assert.equal(rec.complete, true);
  assert.equal(rec.route, "lan");
  assert.equal(rec.who.id, "ab12cd34");
  assert.equal(rec.client, "CookingFoil/0.3.72");
  assert.deepEqual(rec.remote, { scope: "private", country: null });
  assert.ok(rec.mbps > 0);
  assert.match(lines[0], /^transfer: 4194304 4\.2 MB in \d+ s = \d+\.\d MB\/s, route lan, 4 connections \(peak\), 4 requests, whole file, 기기 ab12cd34, client CookingFoil\/0\.3\.72$/);
});

test("a request cut off midway counts what really went out, and the file is not complete", async () => {
  const { log } = memoryLog();
  const base = await harness(log);
  const size = 8 * 1024 * 1024;
  const received = await new Promise((resolve, reject) => {
    const req = http.get(`${base}/file/${size}?hang=1`, { agent: false }, (res) => {
      let n = 0;
      res.on("data", (c) => {
        n += c.length;
        if (n >= 1024 * 1024) { req.destroy(); resolve(n); }
      });
    });
    req.on("error", (e) => (e.code === "ECONNRESET" ? null : reject(e)));
  });
  await tick(100);
  log.sweep(Date.now() + 1000);
  const [rec] = log.snapshot().recent;
  assert.ok(rec, "the cut request is recorded (it is over a megabyte)");
  assert.ok(rec.bytes >= received, `${rec.bytes} >= ${received}`);
  assert.ok(rec.bytes <= 2 * 1024 * 1024, "never more than was written");
  assert.ok(rec.bytes < size);
  assert.equal(rec.complete, false);
});

test("only downloads count: a Range request or a megabyte; small, failed and HEAD requests do not", async () => {
  const { log } = memoryLog();
  const base = await harness(log);
  await get(`${base}/file/1000`, { "X-Device-Key": DEVICE });
  await get(`${base}/missing`, { Range: "bytes=0-10" });
  await new Promise((r) => http.request(`${base}/file/2000000`, { method: "HEAD", agent: false }, (res) => { res.resume(); res.on("end", r); }).end());
  await tick(20);
  log.sweep(Date.now() + 1000);
  assert.equal(log.snapshot().recent.length, 0);
  assert.equal(log.openCount(), 0);

  await get(`${base}/file/1000`, { Range: "bytes=0-499" });
  await get(`${base}/file/${1024 * 1024}`);
  await tick(20);
  log.sweep(Date.now() + 1000);
  const recs = log.snapshot().recent;
  assert.equal(recs.length, 2);
  assert.deepEqual(recs.map((r) => r.bytes).sort((a, b) => a - b), [500, 1024 * 1024]);
});

test("memory stays bounded: open transfers are capped and old records drop off", () => {
  const { log } = memoryLog({ maxOpen: 5, maxRecent: 10, quietMs: 60_000 });
  const meta = (i) => ({ key: `k${i}`, route: "lan", file: { path: `/g${i}.nsp`, name: `g${i}.nsp` }, who: { kind: "ip", id: "10.0.0.1", label: "10.0.0.1" }, remote: { scope: "private" } });
  for (let i = 0; i < 40; i++) {
    const h = log.begin(meta(i));
    log.end(h, { download: true, sent: 2_000_000, size: 2_000_000 });
    assert.ok(log.openCount() <= 5);
  }
  assert.ok(log.recentCount() <= 10);
  // Closed early to make room, so they are in the records, not lost.
  assert.equal(log.recentCount(), 10);
});

test("records are saved and read back on start", async () => {
  const file = path.join(data, "round-trip", "transfers.json");
  const a = createTransferLog({ file, quietMs: 10, log: () => {} });
  const h = a.begin({ key: "x", route: "tunnel", file: { path: "/Game [0100000000010000][v0].nsp", name: "Game [0100000000010000][v0].nsp" }, client: "CookingFoil/0.3.72", who: { kind: "device", id: "ab12cd34", label: "기기 ab12cd34" }, remote: { scope: "public", country: "KR" } });
  a.end(h, { download: true, sent: 3_000_000, size: 3_000_000 });
  a.sweep(Date.now() + 1000);
  await a.flush();
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(saved.transfers.length, 1);
  assert.ok(!JSON.stringify(saved).includes(DEVICE));

  const b = createTransferLog({ file, log: () => {} });
  assert.equal(await b.load(), 1);
  assert.deepEqual(b.snapshot().recent, a.snapshot().recent);
  assert.equal(b.snapshot().recent[0].complete, true);
  assert.equal(b.snapshot().summary.tunnel.count, 1);
  // A broken file is ignored, not fatal.
  fs.writeFileSync(file, "{not json");
  assert.equal(await createTransferLog({ file, log: () => {} }).load(), 0);
});

test("pure helpers: spans, extents, names, the summary and units", () => {
  const spans = [];
  addSpan(spans, 100, 200);
  addSpan(spans, 0, 100);
  addSpan(spans, 300, 400);
  assert.deepEqual(spans, [[0, 200], [300, 400]]);
  addSpan(spans, 150, 350);
  assert.deepEqual(spans, [[0, 400]]);
  assert.deepEqual(extentOf(206, "bytes 100-199/1000", "100"), { start: 100, size: 1000 });
  assert.deepEqual(extentOf(200, undefined, "5000"), { start: 0, size: 5000 });
  assert.equal(dispositionName(`attachment; filename="a.zip"; filename*=UTF-8''%ED%95%9C%EA%B8%80.zip`), "한글.zip");
  assert.equal(dispositionName(`attachment; filename="plain.nro"`), "plain.nro");
  assert.equal(dispositionName(undefined), null);
  const now = Date.now();
  const s = summarize([
    { route: "tunnel", endedAt: now, mbps: 3 }, { route: "tunnel", endedAt: now, mbps: 1 }, { route: "tunnel", endedAt: now, mbps: 2.5 },
    { route: "direct", endedAt: now, mbps: 40 }, { route: "direct", endedAt: now - 2 * 86400000, mbps: 1 },
  ], now - 86400000);
  assert.deepEqual(s.tunnel, { count: 3, medianMbps: 2.5, bestMbps: 3 });
  assert.deepEqual(s.direct, { count: 1, medianMbps: 40, bestMbps: 40 });
  assert.deepEqual(s.lan, { count: 0, medianMbps: null, bestMbps: null });
  assert.equal(mbpsOf(2_100_000_000, 300_000), 7);
  assert.equal(mbpsOf(10, 0), null);
  assert.equal(sizeText(2_100_000_000), "2.10 GB");
  assert.equal(logLine({ file: { name: "g.nsp" }, bytes: 2_100_000_000, activeMs: 300_000, mbps: 7, route: "tunnel", peakConnections: 4, requests: 120, complete: true, who: { label: "기기 ab12cd34" }, client: "CookingFoil/0.3.72" }),
    "transfer: g.nsp 2.10 GB in 300 s = 7.0 MB/s, route tunnel, 4 connections (peak), 120 requests, whole file, 기기 ab12cd34, client CookingFoil/0.3.72");
});
