import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import http from "node:http";
import path from "node:path";

// Safe restart: while the server drains, new requests are told to come back
// (503 + Retry-After) and the ones already running finish, up to a grace limit.
process.env.COOK_DATA_DIR = mkdtempSync(path.join(tmpdir(), "cook-drain-"));
const express = (await import("express")).default;
const { createDrainer, RESTART_HEADER, MESSAGE } = await import("../../src/security/drain.js");
const env = await import("../../src/helpers/envs.js");
const settings = await import("../../src/security/server-settings.js");
const { mountServerApi } = await import("../../src/routes/admin/server-api.js");

const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const servers = [];
after(() => { for (const s of servers) { s.closeAllConnections?.(); s.close(); } });

/** A server with the drain gate, a slow streaming route and a stuck one. */
async function harness(opts = {}) {
  const drainer = createDrainer({ retryAfter: () => 20, grace: () => 2, ...opts });
  const app = express();
  app.use(drainer.middleware());
  app.get("/healthz", (_req, res) => res.json({ ok: true, ...drainer.healthFields() }));
  app.get("/fast", (_req, res) => res.send("ok"));
  app.get("/stream", (req, res) => {
    res.set("Content-Length", "6");
    res.write("abc");
    setTimeout(() => res.end("def"), Number(req.query.ms || 300));
  });
  app.get("/stuck", (_req, res) => { res.write("partial"); });
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise((r) => server.once("listening", r));
  return { drainer, server, base: `http://127.0.0.1:${server.address().port}` };
}

/** A GET that reads the whole body, or reports how it broke. */
function get(url, headers = {}) {
  return new Promise((resolve) => {
    const req = http.get(url, { headers, agent: false }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { body += c; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body, complete: res.complete }));
      res.on("error", () => resolve({ status: res.statusCode, body, broken: true }));
      res.on("aborted", () => resolve({ status: res.statusCode, body, broken: true }));
    });
    req.on("error", (err) => resolve({ error: err.code }));
  });
}

test("a draining server tells new requests to come back, with an id and a notice in four languages", async () => {
  const { drainer, base } = await harness();
  assert.equal((await get(`${base}/fast`)).status, 200);
  const st = drainer.start();
  const r = await get(`${base}/fast`);
  assert.equal(r.status, 503);
  assert.equal(r.headers["retry-after"], "20");
  assert.equal(r.headers.connection, "close");
  assert.equal(r.headers["cache-control"], "no-store");
  assert.equal(r.headers[RESTART_HEADER.toLowerCase()], `20; id=${st.id}`);
  const body = JSON.parse(r.body);
  assert.equal(body.error, "restarting");
  assert.equal(body.retry_after, 20);
  assert.equal(body.restart_id, st.id);
  assert.ok(Date.parse(body.back_by) > Date.now(), "back_by is a time ahead");
  assert.deepEqual(Object.keys(body.message).sort(), ["en", "ja", "ko", "zh"]);
  assert.equal(body.message.ko, "서버를 다시 시작하고 있습니다. 잠시 뒤 이어서 받습니다.");
  assert.deepEqual(body.message, MESSAGE);
  for (const text of Object.values(MESSAGE)) assert.doesNotMatch(text, /[—–]/);
});

test("a browser gets a page that reloads itself after Retry-After", async () => {
  const { drainer, base } = await harness();
  drainer.start();
  const r = await get(`${base}/`, { accept: "text/html" });
  assert.equal(r.status, 503);
  assert.match(r.headers["content-type"], /html/);
  assert.match(r.body, /http-equiv="refresh" content="20"/);
});

test("each drain has its own id", () => {
  const a = createDrainer();
  const b = createDrainer();
  assert.notEqual(a.start().id, b.start().id);
  assert.equal(a.start().id, a.status().restartId, "starting twice keeps the first drain");
});

test("/healthz still answers during the drain and says so", async () => {
  const { drainer, base } = await harness();
  assert.equal(JSON.parse((await get(`${base}/healthz`)).body).draining, false);
  const st = drainer.start();
  const r = await get(`${base}/healthz`);
  assert.equal(r.status, 200);
  const body = JSON.parse(r.body);
  assert.equal(body.draining, true);
  assert.equal(body.restart_id, st.id);
});

test("a download already running finishes, closes its connection and is announced", async () => {
  const { drainer, base } = await harness();
  const pending = get(`${base}/stream?ms=300`);
  await tick(100);
  assert.equal(drainer.status().inflight, 1);
  const st = drainer.start();
  const idle = drainer.whenIdle();
  const r = await pending;
  assert.equal(r.status, 200);
  assert.equal(r.body, "abcdef");
  assert.ok(r.complete);
  assert.deepEqual(await idle, { cut: 0 });
  assert.equal(drainer.status().inflight, 0);
  assert.ok(st.id);
});

test("headers written during the drain carry the notice and Connection: close", async () => {
  const drainer = createDrainer({ retryAfter: () => 20, grace: () => 2 });
  const app = express();
  app.use(drainer.middleware());
  app.get("/late", (_req, res) => setTimeout(() => res.send("ok"), 200));
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise((r) => server.once("listening", r));
  const pending = get(`http://127.0.0.1:${server.address().port}/late`);
  await tick(50);
  const st = drainer.start();
  const r = await pending;
  assert.equal(r.status, 200);
  assert.equal(r.headers.connection, "close");
  assert.equal(r.headers[RESTART_HEADER.toLowerCase()], `20; id=${st.id}`);
});

test("the grace limit cuts a request that never ends", async () => {
  const { drainer, base } = await harness({ grace: () => 0.3 });
  const pending = get(`${base}/stuck`);
  await tick(100);
  drainer.start();
  const started = Date.now();
  assert.deepEqual(await drainer.whenIdle(), { cut: 1 });
  assert.ok(Date.now() - started >= 250, "waits out the grace first");
  const r = await pending;
  assert.ok(r.broken || r.error || !r.complete, "the stuck response is cut");
});

test("the status counts downloads in flight, never who is downloading", async () => {
  const { drainer, base } = await harness();
  const a = get(`${base}/stream?ms=300`, { range: "bytes=0-5" });
  const b = get(`${base}/stream?ms=300`);
  await tick(100);
  const st = drainer.status();
  assert.equal(st.inflight, 2);
  assert.equal(st.downloads, 1, "a Range request counts as a download");
  assert.deepEqual(Object.keys(st).sort(), ["backBy", "downloads", "draining", "graceSeconds", "inflight", "restartId", "retryAfter", "startedAt"]);
  await Promise.all([a, b]);
});

test("shutdown announces, waits for the last download, cleans up and exits once", async () => {
  const { drainer, server, base } = await harness();
  const events = [];
  const pending = get(`${base}/stream?ms=300`);
  await tick(100);
  const done = drainer.shutdown({
    server,
    announce: (notice) => events.push(["announce", notice.restart_id]),
    cleanup: async () => { events.push(["cleanup"]); },
    exit: (code) => events.push(["exit", code]),
  });
  drainer.shutdown({ exit: () => events.push(["second exit"]) });
  await tick(50);
  assert.deepEqual(events.map((e) => e[0]), ["announce"], "nothing exits while the download runs");
  assert.equal((await pending).body, "abcdef");
  await done;
  assert.deepEqual(events.map((e) => e[0]), ["announce", "cleanup", "exit"]);
  assert.equal(events[0][1], drainer.status().restartId);
  assert.equal(events[2][1], 0);
});

test("an idle server exits at once", async () => {
  const { drainer, server } = await harness();
  let exited = false;
  await drainer.shutdown({ server, exit: () => { exited = true; } });
  assert.ok(exited);
});

test("Retry-After and the grace limit come from the admin settings, without a restart", async () => {
  assert.equal(env.restartRetryAfter, 20);
  assert.equal(env.restartGrace, 25);
  settings.save({ restartRetryAfter: "7", restartGrace: 12 });
  assert.equal(env.restartRetryAfter, 7);
  assert.equal(env.restartGrace, 12);
  const drainer = createDrainer();
  drainer.start();
  assert.equal(drainer.status().retryAfter, 7);
  assert.equal(drainer.status().graceSeconds, 12);
  for (const bad of [{ restartRetryAfter: 0 }, { restartRetryAfter: 301 }, { restartGrace: 1.5 }, { restartGrace: 601 }]) {
    assert.throws(() => settings.save(bad));
  }
  settings.save({ restartRetryAfter: null, restartGrace: null });
  assert.equal(env.restartRetryAfter, 20, "back to compose");
});

// ── admin API ────────────────────────────────────────────────────────────

async function adminHarness() {
  const drainer = createDrainer({ retryAfter: () => 20, grace: () => 2 });
  const restarts = [];
  drainer.onRestartRequest(() => restarts.push(Date.now()));
  const app = express();
  app.use(express.json());
  const router = express.Router();
  mountServerApi(router, (req, res) => (req.get("x-admin") ? true : (res.status(401).json({ error: "2fa required" }), false)), { drainer });
  app.use("/admin", router);
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise((r) => server.once("listening", r));
  return { drainer, restarts, base: `http://127.0.0.1:${server.address().port}/admin/api/server` };
}

test("restarting from the admin page needs a session and the page's own origin", async () => {
  const { restarts, base } = await adminHarness();
  assert.equal((await fetch(`${base}/restart`, { method: "POST" })).status, 401);
  assert.equal((await fetch(`${base}/status`)).status, 401);
  const foreign = await fetch(`${base}/restart`, { method: "POST", headers: { "x-admin": "1", origin: "https://evil.example" } });
  assert.equal(foreign.status, 403);
  await tick(20);
  assert.equal(restarts.length, 0);
});

test("the admin restart answers first, then starts the drain", async () => {
  const { drainer, restarts, base } = await adminHarness();
  const r = await fetch(`${base}/restart`, { method: "POST", headers: { "x-admin": "1", origin: base.replace(/\/admin.*$/, "") } });
  assert.equal(r.status, 202);
  const body = await r.json();
  assert.equal(body.ok, true);
  await tick(20);
  assert.equal(restarts.length, 1);
  const st = await (await fetch(`${base}/status`, { headers: { "x-admin": "1" } })).json();
  assert.equal(typeof st.inflight, "number");
  assert.equal(typeof st.downloads, "number");
  assert.equal(st.retryAfter, 20);
  assert.equal(drainer.status().draining, false, "the restart handler starts the drain, not the API");
});

test("without a restart handler the admin restart says it cannot", async () => {
  const drainer = createDrainer();
  const app = express();
  const router = express.Router();
  mountServerApi(router, () => true, { drainer });
  app.use("/admin", router);
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise((r) => server.once("listening", r));
  const r = await fetch(`http://127.0.0.1:${server.address().port}/admin/api/server/restart`, { method: "POST" });
  assert.equal(r.status, 503);
});

test("the dashboard shows the same notice once per restart, in its own language", async () => {
  const { readFileSync } = await import("node:fs");
  const html = readFileSync(path.join(import.meta.dirname, "../../src/views/landing.html"), "utf-8");
  assert.match(html, /msg\.type === "restarting"/);
  assert.match(html, /id === restartShown/);
  for (const [lang, text] of Object.entries(MESSAGE)) {
    const start = html.indexOf(`        ${lang}: {`);
    const bundle = html.slice(start, html.indexOf("\n        },\n", start));
    assert.ok(bundle.includes(`"restart.notice": "${text}"`), `${lang} notice matches the 503 body`);
  }
});
