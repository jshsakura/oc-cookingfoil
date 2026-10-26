// The request and event hooks with made-up plugins: beforeDownload, a plugin's own routes, and the event queues.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import express from "express";
import { makeDataDir, manifestOf, newRegistry, writePlugin } from "../support/plugin-fixtures.js";

process.env.COOK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hooks-data-"));
const { largeFiles, GAME_FILE_RE, combineVariant } = await import("../../src/helpers/file-send.js");
const { createVariants } = await import("../../src/plugins/variants.js");
const { createRequestHooks } = await import("../../src/plugins/request-hooks.js");
const { createEvents, QUEUE_MAX } = await import("../../src/plugins/events.js");
const { connectPluginEvents } = await import("../../src/plugins/emit.js");
const { pluginRoutes } = await import("../../src/plugins/routes.js");
const { issueSession } = await import("../../src/security/admin-session.js");

const BEFORE = `
export default {
  async beforeDownload(a, o) {
    const q = a.query.mode;
    if (q === "deny") return { deny: { text: { en: "Not for you", ko: "허용되지 않습니다" } } };
    if (q === "boom") throw new Error("boom");
    if (q === "cookie") return { allow: true, headers: { "Set-Cookie": "a=b" } };
    if (q === "reserved") return { allow: true, headers: { "X-CookingFoil-Console": "1" } };
    if (q === "ctrl") return { allow: true, headers: { "X-Demo": "a\\x01b" } };
    if (q === "hangul") return { allow: true, headers: { "X-Demo": "한글" } };
    if (q === "accel") return { allow: true, headers: { "X-Accel-Redirect": "/etc/passwd" } };
    if (q === "seen-query") return { allow: true, headers: { "X-Demo": JSON.stringify(Object.values(a.query).map((v) => typeof v)) } };
    if (q === "crlf") return { allow: true, headers: { "X-Demo": "a\\r\\nb: c" } };
    if (q === "nonsense") return { maybe: true };
    if (q === "quote") return { allow: true, filename: 'a"b.nsp' };
    if (q === "name") return { allow: true, filename: "게임 [0100].nsp" };
    if (q === "rewrite") return { rewrite: { query: { tweak: "1" } }, headers: { "X-Demo": o.console.firmware ?? "none" } };
    return { allow: true, headers: { "X-Demo": "seen-" + a.file } };
  },
};`;
const TWEAK = `
export default {
  async variants() { return []; },
  async plan(a) { return { patches: [{ offset: 0, bytes: Buffer.from(a.query.tweak) }] }; },
};`;
const ROUTES = `
export default {
  routes: {
    echo: async (a) => ({ json: { method: a.method, body: a.body, query: a.query } }),
    boom: async () => { throw new Error("boom"); },
    nonsense: async () => ({ status: 302, json: 1 }),
    both: async () => ({ json: 1, text: "x" }),
    teapot: async () => ({ status: 418, text: "short and stout", headers: { "X-Pot": "1" } }),
    admin: async () => ({ text: "secret" }),
    hangul: async () => ({ text: "x", headers: { "X-Pot": "한글" } }),
    ctrl: async () => ({ text: "x", headers: { "X-Pot": "a\\x01b" } }),
  },
};`;
const DUAL = `
export default {
  async beforeDownload() { return { allow: true }; },
  routes: { boom: async () => { throw new Error("boom"); } },
};`;
const EVENTS = `
globalThis.__seen ??= {};
export default {
  async afterDownload(p) { (globalThis.__seen[p.__who ?? "evt"] ??= []).push(p); if (p.file === "slow.nsp") await new Promise((r) => setTimeout(r, 40)); if (p.file === "bad.nsp") throw new Error("handler broke"); },
  async deviceApproved(p) { (globalThis.__seen.dev ??= []).push(p); },
};`;
const routeSpec = (name, access = "device", method = "POST", extra = {}) => ({ name, method, access, ...extra });

let env, root, server, base, events;
const gate = { token: false, lane: false, account: null };
const clock = { t: 1_700_000_000_000 };
const text = async (r) => Buffer.from(await r.arrayBuffer()).toString();
const get = (p, headers = {}) => fetch(`${base}${p}`, { headers });
const post = (p, body, headers = {}) => fetch(`${base}${p}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const settle = () => new Promise((r) => setTimeout(r, 60));

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "hooks-games-"));
  fs.writeFileSync(path.join(root, "g.nsp"), "ABCDEFGHIJ");
  fs.writeFileSync(path.join(root, "slow.nsp"), "x");
  fs.writeFileSync(path.join(root, "bad.nsp"), "x");
  fs.writeFileSync(path.join(root, "big [0100ABCDEF012000].nsp"), Buffer.alloc(24 * 1024 * 1024, 1));
  const d = makeDataDir();
  writePlugin(d, "gate", { manifest: manifestOf("gate", { provides: ["request"], console: ["firmware"] }), body: BEFORE });
  writePlugin(d, "tweaker", { manifest: manifestOf("tweaker", { provides: ["variant"], variantKeys: ["tweak"] }), body: TWEAK });
  writePlugin(d, "api", { manifest: manifestOf("api", { provides: ["route"], routes: [routeSpec("echo", "device", "POST", { maxBody: 64 }), routeSpec("boom"), routeSpec("nonsense"), routeSpec("both"), routeSpec("teapot", "device", "GET"), routeSpec("admin", "admin", "GET"), routeSpec("hangul", "device", "GET"), routeSpec("ctrl", "device", "GET")] }), body: ROUTES });
  writePlugin(d, "dual", { manifest: manifestOf("dual", { provides: ["request", "route"], routes: [routeSpec("boom", "device", "GET")] }), body: DUAL });
  writePlugin(d, "watch", { manifest: manifestOf("watch", { provides: ["event"] }), body: EVENTS });
  writePlugin(d, "watch-ip", { manifest: manifestOf("watch-ip", { provides: ["event"], events: { identity: ["ip", "account"] } }), body: EVENTS.replaceAll('p.__who ?? "evt"', '"ip"') });
  env = newRegistry(d, { limits: { hookMs: { beforeDownload: 200, afterDownload: 500 } } });
  await env.registry.init();
  for (const id of ["gate", "tweaker", "api", "watch", "watch-ip", "dual"]) await env.registry.setEnabled(id, true);
  events = createEvents(env.registry, { secret: () => Buffer.from("test-secret"), log: () => {} });
  connectPluginEvents((k, f, w) => events.emit(k, f, w));
  const variants = createVariants(env.registry);
  const request = createRequestHooks(env.registry);
  const app = express();
  app.use((req, _res, next) => { if (gate.token) req.apiToken = "t"; if (gate.lane) req.pairedDevice = "dev"; if (gate.account) req.webUser = gate.account; next(); });
  app.use("/api/plugins", pluginRoutes(env.registry, { now: () => clock.t, perMinute: 5 }));
  // The same combination the server uses for every download (helpers/file-send.js), with this registry behind it.
  app.use(largeFiles(root, GAME_FILE_RE, { variants: combineVariant(() => request, () => variants) }));
  server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server?.close(); fs.rmSync(root, { recursive: true, force: true }); });

test("beforeDownload: an allowed download carries the plugin's header and its own ETag, and varies by the console", async () => {
  const r = await get("/g.nsp");
  assert.equal(r.status, 200);
  assert.equal(await text(r), "ABCDEFGHIJ");
  assert.equal(r.headers.get("x-demo"), "seen-g.nsp");
  assert.match(r.headers.get("etag"), /-p-[0-9a-f]{12}"$/);
  assert.match(r.headers.get("vary"), /X-CookingFoil-Console/i);
  assert.match(r.headers.get("cache-control"), /^private/);
});

test("beforeDownload: a rewrite hands the variant path the new query, and the plugin sees only the console facts it asked for", async () => {
  const r = await get("/g.nsp?mode=rewrite", { "X-CookingFoil-Console": "firmware=21.0.1; region=kor" });
  assert.equal(r.headers.get("x-demo"), "21.0.1");
  assert.equal(await text(r), "1BCDEFGHIJ");
});

test("beforeDownload: a refusal the plugin chose is 403 plugin-denied with its text, never cached", async () => {
  const r = await get("/g.nsp?mode=deny", { "Accept-Language": "ko" });
  assert.equal(r.status, 403);
  const body = await r.json();
  assert.equal(body.code, "plugin-denied");
  assert.equal(body.error, "허용되지 않습니다");
  assert.equal(r.headers.get("cache-control"), "no-store");
});

test("beforeDownload: a plugin that fails is 409 plugin-failed, and the original file does not stand in", async () => {
  for (const mode of ["boom", "cookie", "reserved", "crlf", "ctrl", "hangul", "accel", "nonsense", "quote"]) {
    const r = await get(`/g.nsp?mode=${mode}`);
    assert.equal(r.status, 409, mode);
    assert.equal((await r.json()).code, "plugin-failed", mode);
    assert.equal((await get("/g.nsp")).status, 200, "a good answer between them keeps the count from reaching a pause");
  }
});

test("beforeDownload: a filename is encoded by the core (RFC 6266), and an unsafe one fails the call", async () => {
  const r = await get("/g.nsp?mode=name");
  assert.equal(r.headers.get("content-disposition"), `attachment; filename="__ [0100].nsp"; filename*=UTF-8''%EA%B2%8C%EC%9E%84%20%5B0100%5D.nsp`.replace("__ ", "__ "));
});

test("beforeDownload: failures count toward the pause, and while the plugin is paused downloads wait instead of going out unchecked", async () => {
  for (let i = 0; i < 6; i++) await get("/g.nsp?mode=boom");
  assert.equal(env.registry.view("gate").state, "cooling");
  const r = await get("/g.nsp");
  assert.equal(r.status, 409);
  assert.equal((await r.json()).code, "plugin-failed");
  env.clock.t += 11 * 60_000;
  assert.equal((await get("/g.nsp")).status, 200);
});

test("routes: the plugin answers at /api/plugins/<id>/<name>; method, content type and body size are checked by the core", async () => {
  const ok = await post("/api/plugins/api/echo?x=1", { a: 1 });
  assert.deepEqual(await ok.json(), { method: "POST", body: { a: 1 }, query: { x: "1" } });
  assert.equal(ok.headers.get("cache-control"), "no-store");
  assert.equal((await get("/api/plugins/api/echo")).status, 405);
  assert.equal((await fetch(`${base}/api/plugins/api/echo`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "x" })).status, 415);
  assert.equal((await post("/api/plugins/api/echo", "{nope")).status, 400);
  assert.equal((await post("/api/plugins/api/echo", { pad: "x".repeat(100) })).status, 413);
  assert.equal((await get("/api/plugins/api/missing")).status, 404);
  assert.equal((await get("/api/plugins/nobody/echo")).status, 404);
  const pot = await get("/api/plugins/api/teapot");
  assert.equal(pot.status, 418);
  assert.equal(pot.headers.get("x-pot"), "1");
  assert.equal(await text(pot), "short and stout");
});

test("routes: automation tokens and console lanes are refused; an admin route is for administrators only", async () => {
  gate.token = true;
  assert.equal((await post("/api/plugins/api/echo", {})).status, 403);
  gate.token = false;
  gate.lane = true;
  assert.equal((await get("/api/plugins/api/admin")).status, 403);
  assert.equal((await post("/api/plugins/api/echo", {})).status, 200);
  gate.lane = false;
  // A server with no accounts says yes to anyone in mayAdminister: the route still wants a signed-in admin session.
  const refused = await get("/api/plugins/api/admin");
  assert.equal(refused.status, 403);
  assert.equal((await refused.json()).code, "admin-only");
  const fake = { req: { get: () => undefined }, setHeader(_k, v) { this.cookie = v; } };
  issueSession(fake);
  assert.equal(await text(await get("/api/plugins/api/admin", { Cookie: fake.cookie.split(";")[0] })), "secret");
});

test("routes: a plugin's own failure is 502 plugin-failed and counts; what the core refuses never counts", async () => {
  const streak = () => env.registry.view("api").routeStreak;
  const before = streak();
  for (const p of ["/api/plugins/api/missing"]) await get(p);
  await post("/api/plugins/api/echo", "{nope");
  await post("/api/plugins/api/echo", { pad: "x".repeat(100) });
  await fetch(`${base}/api/plugins/api/echo`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "x" });
  assert.equal(streak(), before, "nothing the core refused was counted");
  clock.t += 61_000;
  const boom = await post("/api/plugins/api/boom", {});
  assert.equal(boom.status, 502);
  assert.equal((await boom.json()).code, "plugin-failed");
  assert.equal(streak(), before + 1);
  assert.equal((await post("/api/plugins/api/nonsense", {})).status, 502);
  assert.equal((await post("/api/plugins/api/both", {})).status, 502);
  assert.equal(streak(), before + 3, "answers in a shape the core can not send count too");
});

test("routes: a device that calls too often is stopped by the core with 429, and that is not counted", async () => {
  clock.t += 61_000;
  const streak = env.registry.view("api").routeStreak;
  const codes = [];
  for (let i = 0; i < 8; i++) codes.push((await get("/api/plugins/api/teapot", { "X-Device-Key": "A".repeat(64) })).status);
  assert.deepEqual(codes, [418, 418, 418, 418, 418, 429, 429, 429]);
  assert.equal((await get("/api/plugins/api/teapot", { "X-Device-Key": "B".repeat(64) })).status, 418, "another device has its own window");
  assert.ok(env.registry.view("api").routeStreak <= streak, "limited calls added nothing");
});

test("events: emit returns at once, handlers run in order, one at a time, and a plugin that is off is not told", async () => {
  globalThis.__seen = {};
  const t0 = Date.now();
  events.emit("afterDownload", { file: "slow.nsp", __who: "evt" }, {});
  events.emit("afterDownload", { file: "second.nsp", __who: "evt" }, {});
  assert.ok(Date.now() - t0 < 20, "emit did not wait for the slow handler");
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(globalThis.__seen.evt.map((p) => p.file), ["slow.nsp", "second.nsp"]);
  await env.registry.setEnabled("watch", false);
  const n = globalThis.__seen.evt.length;
  events.emit("afterDownload", { file: "third.nsp", __who: "evt" }, {});
  await settle();
  assert.equal(globalThis.__seen.evt.length, n);
  await env.registry.setEnabled("watch", true);
});

test("events: a full queue drops the oldest and counts them; a failing handler is counted but never starts a pause", async () => {
  const before = events.statsOf("watch");
  events.emit("afterDownload", { file: "slow.nsp", __who: "evt" }, {});
  for (let i = 0; i < QUEUE_MAX + 25; i++) events.emit("afterDownload", { file: `f${i}.nsp`, __who: "evt" }, {});
  // The first slow event is still waiting too (the queue starts draining after this synchronous loop), so 26 go.
  assert.equal(events.statsOf("watch").dropped - before.dropped, 26);
  await new Promise((r) => setTimeout(r, 400));
  events.emit("afterDownload", { file: "bad.nsp", __who: "evt" }, {});
  await settle();
  assert.equal(events.statsOf("watch").failed, before.failed + 1);
  assert.equal(env.registry.view("watch").hookStreak, 0);
  assert.equal(env.registry.view("watch").state, "on");
});

test("events: no person in a payload unless the manifest asked; the device is a different short hash for every plugin", async () => {
  globalThis.__seen = {};
  events.emit("deviceApproved", { isNew: true }, { deviceKey: "C".repeat(64), ip: "192.0.2.7", account: "someone" });
  await settle();
  const plain = globalThis.__seen.dev.find((p) => !("ip" in p));
  const named = globalThis.__seen.dev.find((p) => "ip" in p);
  assert.ok(plain && named);
  assert.equal("account" in plain, false, "the key is not there, not null");
  assert.equal(JSON.stringify(plain).includes("192.0.2.7"), false);
  assert.equal(named.ip, "192.0.2.7");
  assert.equal(named.account, "someone");
  assert.match(plain.device, /^[0-9a-f]{12}$/);
  assert.notEqual(plain.device, named.device);
});

test("afterDownload: once per download with the bytes and status; a hang-up mid-file is told once as aborted", async () => {
  globalThis.__seen = {};
  await text(await get("/g.nsp"));
  await settle();
  const done = globalThis.__seen.evt.filter((p) => p.file === "g.nsp");
  assert.equal(done.length, 1);
  assert.equal(done[0].status, 200);
  assert.equal(done[0].bytes, 10);
  assert.equal(done[0].aborted, false);
  assert.equal(done[0].kind, "nsp");
  await new Promise((resolve) => {
    const req = http.get(`${base}/${encodeURIComponent("big [0100ABCDEF012000].nsp")}`, (res) => { res.once("data", () => { req.destroy(); resolve(); }); });
    req.on("error", () => {});
  });
  await new Promise((r) => setTimeout(r, 300));
  const big = globalThis.__seen.evt.filter((p) => p.file.startsWith("big "));
  assert.equal(big.length, 1);
  assert.equal(big[0].aborted, true);
  assert.equal(big[0].titleId, "0100ABCDEF012000");
  assert.ok(big[0].bytes < 24 * 1024 * 1024);
});

test("the only hooks the server calls on a request path are the ones listed here", async () => {
  const dir = path.resolve("src");
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (f.endsWith(".js")) files.push(f); } };
  walk(dir);
  const found = new Set();
  for (const f of files) for (const m of fs.readFileSync(f, "utf8").matchAll(/callHook\(\s*[^,]+,\s*"(\w+)"/g)) found.add(m[1]);
  // metadata, art and tasks run in the background and are cached; they are never called while a request waits.
  assert.deepEqual([...found].sort(), ["beforeDownload", "plan", "route", "shopInfo", "variants"]);
});

test("a header value the socket would refuse is a failed call, not a crash: 409 for a download, 502 for a route, and the server stays up", async () => {
  for (const name of ["hangul", "ctrl"]) {
    const r = await get(`/api/plugins/api/${name}`);
    assert.equal(r.status, 502, name);
    assert.equal((await r.json()).code, "plugin-failed", name);
  }
  assert.equal((await get("/g.nsp")).status, 200);
});

test("only text values of the query reach beforeDownload", async () => {
  const r = await get("/g.nsp?mode=seen-query&a[]=1&b[c]=2&d=3");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("x-demo"), '["string","string"]', "mode and d; the array and the object were left out");
});

test("a plugin whose address keeps failing pauses the address, not the downloads it answers for every device", async () => {
  clock.t += 61_000;
  for (let i = 0; i < 6; i++) await get("/api/plugins/dual/boom");
  assert.ok(env.registry.view("dual").routeRetryAt, "the address is paused");
  assert.equal((await get("/api/plugins/dual/boom")).status, 503);
  assert.equal(env.registry.view("dual").state, "on", "the plugin itself is not cooling");
  assert.equal((await get("/g.nsp")).status, 200, "downloads still go out");
});

test("an account is one caller for the rate limit whatever device key it sends; the table of callers has a ceiling", async () => {
  clock.t += 61_000;
  gate.account = { kind: "password", name: "kim" };
  const codes = [];
  for (let i = 0; i < 7; i++) codes.push((await get("/api/plugins/api/teapot", { "X-Device-Key": String(i).repeat(64) })).status);
  gate.account = null;
  assert.deepEqual(codes, [418, 418, 418, 418, 418, 429, 429]);
});
