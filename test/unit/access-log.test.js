import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

// The access log: the requests worth a line when a console says "timed out", so
// a request that reached the server can be told from one that never did.
const data = fs.mkdtempSync(path.join(os.tmpdir(), "cook-access-"));
process.env.COOK_DATA_DIR = data;
const express = (await import("express")).default;
const { createAccessLog, accessLog, shouldLog, entryOf } = await import("../../src/helpers/access-log.js");

const DEVICE = "AB12CD34" + "0".repeat(55) + "1";
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const servers = [];
after(() => {
  for (const s of servers) { s.closeAllConnections?.(); s.close(); }
  fs.rmSync(data, { recursive: true, force: true });
});

const logFile = () => path.join(fs.mkdtempSync(path.join(data, "case-")), "access-log.jsonl");
const lines = (file) => fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

test("edge correlation records the proven direct requester, never an unverified device header", () => {
  const req = { method: "GET", originalUrl: "/file.nsp?secret=hidden", headers: { "x-device-key": DEVICE }, socket: { remoteAddress: "127.0.0.1" } };
  const res = { headersSent: true, statusCode: 206, writableFinished: true };
  const unknown = entryOf(req, res, 1);
  assert.equal(unknown.dev, null);
  assert.equal(unknown.client, undefined);
  const proven = entryOf({ ...req, cookingfoilLane: "direct", directSub: { dev: DEVICE }, directClient: "198.51.100.9" }, res, 1);
  assert.equal(proven.client, "198.51.100.9");
  assert.equal(proven.who.id, "ab12cd34");
  assert.equal(proven.who.kind, "device");
  assert.ok(!JSON.stringify(proven).includes(DEVICE));
  assert.ok(!JSON.stringify(proven).includes("hidden"));
});

async function harness(log, { slowMs } = {}) {
  const app = express();
  app.use((req, _res, next) => {
    req.pairedDevice = req.get("x-device-key") || undefined; // a console that proved its key
    if (req.path.startsWith("/direct")) req.cookingfoilLane = "direct";
    next();
  });
  app.use(accessLog({ log, slowMs }));
  app.get("/direct/file", (_req, res) => res.end("ok"));
  app.get("/plain", (_req, res) => res.end("ok"));
  app.get("/missing", (_req, res) => res.status(404).end());
  app.get("/slow", (_req, res) => setTimeout(() => res.end("late"), 80));
  app.get("/hang", () => {}); // never answers
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise((r) => server.once("listening", r));
  return `http://127.0.0.1:${server.address().port}`;
}

test("a request on the direct lane is logged with the console's first eight key characters, the path without its query, the status and the time", async () => {
  const file = logFile();
  const log = createAccessLog({ file });
  const base = await harness(log);
  const r = await fetch(`${base}/direct/file?token=SECRETVALUE`, { headers: { "x-device-key": DEVICE } });
  await r.text();
  await tick(30);
  await log.flush();
  const [e] = lines(file);
  assert.equal(e.route, "direct");
  assert.equal(e.dev, "ab12cd34");
  assert.equal(e.path, "/direct/file");
  assert.equal(e.status, 200);
  assert.equal(e.aborted, false);
  assert.ok(Number.isFinite(e.ms) && e.ms >= 0);
  const raw = fs.readFileSync(file, "utf8");
  assert.ok(!raw.includes("SECRETVALUE"), "no query string on disk");
  assert.ok(!raw.includes(DEVICE.slice(8)), "never more of the key than its first eight characters");
});

test("a quick, successful request off the direct lane is not logged; an error and a slow one are", async () => {
  const file = logFile();
  const log = createAccessLog({ file });
  const base = await harness(log, { slowMs: 50 });
  for (const p of ["/plain", "/missing", "/slow"]) await (await fetch(base + p)).text();
  await tick(30);
  await log.flush();
  assert.deepEqual(lines(file).map((e) => [e.path, e.status]), [["/missing", 404], ["/slow", 200]]);
});

test("a request cut off before any answer is logged as aborted with status 0", async () => {
  const file = logFile();
  const log = createAccessLog({ file });
  const base = await harness(log);
  const ctl = new AbortController();
  const pending = fetch(`${base}/hang`, { signal: ctl.signal }).catch(() => {});
  await tick(60);
  ctl.abort();
  await pending;
  await tick(60);
  await log.flush();
  const [e] = lines(file);
  assert.equal(e.path, "/hang");
  assert.equal(e.aborted, true);
  assert.equal(e.status, 0);
});

test("shouldLog keeps the direct lane, errors, aborts and slow requests", () => {
  const base = { route: "lan", status: 200, ms: 10, aborted: false };
  assert.equal(shouldLog(base, 5000), false);
  assert.equal(shouldLog({ ...base, route: "direct" }, 5000), true);
  assert.equal(shouldLog({ ...base, status: 500 }, 5000), true);
  assert.equal(shouldLog({ ...base, aborted: true, status: 0 }, 5000), true);
  assert.equal(shouldLog({ ...base, ms: 5000 }, 5000), true);
});

test("the file stays under its size cap: the full file becomes the one older file, never more", async () => {
  const file = logFile();
  const log = createAccessLog({ file, maxBytes: 600 });
  for (let i = 0; i < 40; i++) log.record({ t: new Date().toISOString(), route: "direct", dev: "ab12cd34", m: "GET", path: `/direct/file-${i}`, status: 200, ms: 5, aborted: false });
  await log.flush();
  assert.ok(fs.statSync(file).size <= 600);
  assert.ok(fs.existsSync(file + ".1"));
  assert.ok(fs.statSync(file + ".1").size <= 600);
  assert.ok(!fs.existsSync(file + ".2"));
});

test("lines older than the keep time are dropped, and so is an older file that old", async () => {
  const file = logFile();
  const DAY = 24 * 60 * 60 * 1000;
  const old = JSON.stringify({ t: new Date(Date.now() - 40 * DAY).toISOString(), path: "/old" });
  const fresh = JSON.stringify({ t: new Date().toISOString(), path: "/fresh" });
  fs.writeFileSync(file, `${old}\n${fresh}\n`);
  fs.writeFileSync(file + ".1", `${old}\n`);
  fs.utimesSync(file + ".1", new Date(Date.now() - 40 * DAY), new Date(Date.now() - 40 * DAY));
  const log = createAccessLog({ file, keepMs: () => 30 * DAY });
  log.record({ t: new Date().toISOString(), route: "direct", dev: null, m: "GET", path: "/new", status: 200, ms: 1, aborted: false });
  await log.flush();
  assert.deepEqual(lines(file).map((e) => e.path), ["/fresh", "/new"]);
  assert.ok(!fs.existsSync(file + ".1"));
});
