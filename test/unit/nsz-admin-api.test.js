import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The 변환 tab's API: only an admin session, a list with totals and settings,
// start refused while the queue is off, and the row actions.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "cook-nsz-api-"));
process.env.COOK_DATA_DIR = path.join(root, "data");
process.env.COOK_GAMES_DIR = path.join(root, "games");
fs.mkdirSync(process.env.COOK_GAMES_DIR, { recursive: true });
const express = (await import("express")).default;
const { createNszQueue } = await import("../../src/meta/nsz-queue.js");
const { mountNszApi } = await import("../../src/routes/admin/nsz-api.js");

const S = { enabled: false, autoQueue: true, level: 18, threads: 4, workers: 1, minSizeMb: 1, diskFloorGb: 0, block: false, xci: false };
const queue = createNszQueue({ gamesDir: process.env.COOK_GAMES_DIR, stateFile: path.join(root, "q.json"), settings: () => S, bin: () => null, recentWriteMs: 0 });
fs.writeFileSync(path.join(process.env.COOK_GAMES_DIR, "A.nsp"), Buffer.alloc(2 * 1024 ** 2));
const app = express();
app.use(express.json());
const router = express.Router();
mountNszApi(router, (req, res) => (req.get("x-admin") ? true : (res.status(401).json({ error: "2fa required" }), false)), queue);
app.use("/admin", router);
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const BASE = `http://127.0.0.1:${server.address().port}/admin/api/nsz`;
after(async () => { server.close(); await queue.shutdown(); fs.rmSync(root, { recursive: true, force: true }); });
const call = (p, method = "GET", body = {}) => fetch(BASE + p, { method, headers: { "x-admin": "1", "Content-Type": "application/json" }, body: method === "GET" || method === "DELETE" ? undefined : JSON.stringify(body) });

test("only an admin session reads the queue", async () => {
  assert.equal((await fetch(BASE)).status, 401);
  assert.equal((await fetch(`${BASE}/start`, { method: "POST" })).status, 401);
});

test("the list has the state, totals and the queue's settings; off by default", async () => {
  const d = await (await call("")).json();
  assert.equal(d.status, "off");
  assert.equal(d.tool, false);
  assert.deepEqual(d.items, []);
  assert.equal(d.settings.nszEnabled.value, false);
  assert.equal(d.settings.nszBlock.value, false);
  assert.equal(d.settings.nszXci.value, false);
  assert.equal(d.settings.nszLevel.value, 18);
  assert.equal(d.settings.nszWorkers.value, 1);
  assert.equal(d.settings.nszKeepHours.value, 0);
  assert.equal(d.settings.nszKeepGb.value, 0);
  assert.deepEqual([d.kept.count, d.kept.bytes], [0, 0]);
});

test("선택한 것만 변환 needs a list of rows and the queue on; restore is gone, purge and the log answer", async () => {
  assert.equal((await call("/run-selected", "POST", { ids: [] })).status, 400);
  assert.equal((await call("/run-filter", "POST", { filter: "done" })).status, 400);
  assert.equal((await call("/run-filter", "POST", { filter: "waiting" })).status, 409, "off first");
  assert.equal((await call("/run-selected", "POST", { ids: ["nothere"] })).status, 400);
  assert.equal((await call("/run-selected", "POST", { ids: ["0123456789ab"] })).status, 409, "off first");
  assert.equal((await call("/items/0123456789ab/restore", "POST")).status, 404, "no restore route");
  assert.deepEqual(await (await call("/purge-kept", "POST")).json(), { ok: true, removed: 0, bytes: 0 });
  assert.deepEqual((await (await call("/log?q=x")).json()).items, []);
});

test("start and 전체 변환 are refused while the queue is off; a scan still queues", async () => {
  assert.equal((await call("/start", "POST")).status, 409);
  assert.equal((await call("/convert-all", "POST")).status, 409);
  assert.deepEqual(await (await call("/preview")).json(), { files: 1, bytes: 2 * 1024 ** 2 });
  const r = await (await call("/scan", "POST")).json();
  assert.equal(r.added, 1);
});

test("row actions answer 404 for an unknown item and work on a known one", async () => {
  assert.equal((await call("/items/nothere/top", "POST")).status, 404);
  assert.equal((await call("/items/0123456789ab", "DELETE")).status, 404);
  const id = (await (await call("")).json()).items[0].id;
  assert.equal((await call(`/items/${id}/top`, "POST")).status, 200);
  assert.equal((await call(`/items/${id}`, "DELETE")).status, 200);
  assert.equal((await (await call("")).json()).total, 0);
  assert.equal((await call("/clear-finished", "POST")).status, 200);
});

test("turned on, 전체 변환 queues and starts; nsz missing fails the file with a reason", async () => {
  S.enabled = true;
  const r = await (await call("/convert-all", "POST")).json();
  assert.equal(r.added, 1);
  await queue.pump();
  await queue.idle();
  const d = await (await call("?filter=failed")).json();
  assert.equal(d.total, 1);
  assert.match(d.items[0].reason, /nsz 를 찾지 못했습니다/);
  assert.equal((await call("/run-selected", "POST", { ids: ["0123456789ab"] })).status, 400, "unknown rows");
  const log = await (await call("/log")).json();
  assert.deepEqual([log.total, log.items[0].event], [1, "failed"]);
});
