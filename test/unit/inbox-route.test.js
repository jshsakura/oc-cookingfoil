import { render } from "../../src/helpers/alert-messages.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

// POST /api/inbox: signed-in web users only, with this browser's CSRF token,
// inside the size limits and the quota, a few times a minute at most.
const data = fs.mkdtempSync(path.join(os.tmpdir(), "cook-inbox-route-"));
process.env.COOK_DATA_DIR = data;
process.env.COOK_INBOX_MAX_BYTES = "1000";
process.env.COOK_INBOX_QUOTA_BYTES = "4000";
const express = (await import("express")).default;
const { default: inboxRouter } = await import("../../src/routes/inbox.js");
const settings = await import("../../src/security/server-settings.js");
const inbox = await import("../../src/meta/inbox.js");

const sent = [];
const app = express();
app.use("/api/inbox", inboxRouter({
  whoOf: (req) => (req.get("x-test-user") ? { name: req.get("x-test-user"), label: req.get("x-test-user"), slug: req.get("x-test-user") } : null),
  notify: (text, id) => sent.push({ text: render(text, "ko"), id }),
}));
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const BASE = `http://127.0.0.1:${server.address().port}/api/inbox`;
after(() => server.close());

const CSRF = "c".repeat(40);
const headers = (user = "alice", csrf = CSRF) => ({ ...(user ? { "x-test-user": user } : {}), Cookie: `cf_csrf=${CSRF}`, ...(csrf ? { "X-CSRF-Token": csrf } : {}) });
function form({ files = {}, memo, links, paths } = {}) {
  const f = new FormData();
  for (const [name, text] of Object.entries(files)) f.append("files", new Blob([text]), name);
  if (paths) f.append("paths", JSON.stringify(paths));
  if (memo !== undefined) f.append("memo", memo);
  if (links !== undefined) f.append("links", links);
  return f;
}
const post = (body, h = headers()) => fetch(BASE, { method: "POST", headers: h, body });

test("someone not signed in on the web is turned away, and so is a write without the CSRF token", async () => {
  assert.equal((await fetch(BASE, { headers: headers(null) })).status, 401);
  assert.equal((await post(form({ memo: "x" }), headers(null))).status, 401);
  const r = await post(form({ memo: "x" }), headers("alice", null));
  assert.equal(r.status, 403);
  assert.equal((await post(form({ memo: "x" }), { ...headers(), Origin: "https://evil.example" })).status, 403);
  assert.deepEqual(sent, []);
});

test("the signed-in page learns whether the inbox is on and how much fits", async () => {
  const d = await (await fetch(BASE, { headers: headers() })).json();
  assert.deepEqual({ enabled: d.enabled, maxBytes: d.maxBytes }, { enabled: true, maxBytes: 1000 });
  assert.ok(d.freeBytes <= 4000);
});

test("an upload with files, a memo and links lands in the inbox and tells the admin at once", async () => {
  const r = await post(form({ files: { "a.txt": "hello", "b.bin": "1234" }, memo: "피크민 세이브입니다\n둘째 줄", links: "https://a.example/x\nhttp://b.example" }));
  assert.equal(r.status, 201);
  const d = await r.json();
  assert.equal(d.ok, true);
  assert.deepEqual([d.files, d.bytes], [2, 9]);
  const note = JSON.parse(fs.readFileSync(path.join(data, "inbox", d.id, "note.json"), "utf8"));
  assert.equal(note.user, "alice");
  assert.deepEqual(note.links, ["https://a.example/x", "http://b.example/"]);
  assert.deepEqual(note.files.map((f) => f.name), ["a.txt", "b.bin"]);
  assert.deepEqual(sent.at(-1), { id: d.id, text: "alice 님이 파일 2개(9 B), 링크 2개를 올렸습니다.\n메모: 피크민 세이브입니다" });
});

test("a picked folder keeps its inner paths, cleaned", async () => {
  const r = await post(form({ files: { "x.bin": "1", "y.bin": "2" }, paths: ["mod/romfs/x.bin", "../../mod/y.bin"] }), headers("bob"));
  assert.equal(r.status, 201);
  const { id } = await r.json();
  assert.ok(fs.existsSync(path.join(data, "inbox", id, "files", "mod", "romfs", "x.bin")));
  assert.ok(fs.existsSync(path.join(data, "inbox", id, "files", "mod", "y.bin")));
});

test("nothing at all, a bad link or a memo that is too long is refused with a reason", async () => {
  const empty = await post(form({ memo: "   ", links: "" }), headers("carol"));
  assert.equal(empty.status, 400);
  assert.equal((await empty.json()).code, "empty");
  const bad = await post(form({ links: "javascript:alert(1)" }), headers("carol"));
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).code, "bad-link");
  assert.equal((await post(form({ memo: "x".repeat(10_001) }), headers("carol"))).status, 400);
  assert.equal(fs.readdirSync(path.join(data, "inbox", ".staging")).length, 0);
});

test("an upload over the size limit is refused and leaves nothing behind", async () => {
  const r = await post(form({ files: { "big.bin": "x".repeat(700), "big2.bin": "y".repeat(700) } }), headers("dave"));
  assert.equal(r.status, 413);
  assert.match((await r.json()).error, /한 번에/);
  assert.equal(fs.readdirSync(path.join(data, "inbox", ".staging")).length, 0);
  assert.equal((await inbox.list()).some((e) => e.user === "dave"), false);
});

test("a full inbox refuses new uploads with a clear message", async () => {
  settings.save({ inboxQuotaBytes: 1000 });
  const r = await post(form({ files: { "c.bin": "z".repeat(900) } }), headers("erin"));
  assert.equal(r.status, 507);
  assert.match((await r.json()).error, /가득/);
  settings.save({ inboxQuotaBytes: null });
});

test("one person gets a few uploads a minute", async () => {
  const codes = [];
  for (let i = 0; i < 7; i++) codes.push((await post(form({ memo: `메모 ${i}` }), headers("frank"))).status);
  assert.deepEqual(codes, [201, 201, 201, 201, 201, 429, 429]);
  assert.equal((await post(form({ memo: "다른 사람" }), headers("grace"))).status, 201);
});

test("switched off on the admin page, the inbox says so and takes nothing", async () => {
  settings.save({ inboxEnabled: false });
  assert.equal((await (await fetch(BASE, { headers: headers() })).json()).enabled, false);
  assert.equal((await post(form({ memo: "x" }), headers("heidi"))).status, 404);
  settings.save({ inboxEnabled: null });
  assert.equal((await post(form({ memo: "x" }), headers("heidi"))).status, 201);
});

/** Streams a multipart body without Content-Length, a chunk at a time, until the server answers or cuts it off. */
function chunked(user, chunks, size) {
  return new Promise((resolve) => {
    const boundary = "----cook" + Date.now();
    const url = new URL(BASE);
    const req = http.request({ host: url.hostname, port: url.port, path: url.pathname, method: "POST", headers: {
      ...headers(user), "Content-Type": `multipart/form-data; boundary=${boundary}`, "Transfer-Encoding": "chunked",
    } });
    let written = 0, settled = false;
    const end = (result) => { if (!settled) { settled = true; clearInterval(timer); resolve({ ...result, written }); } };
    req.on("response", (res) => { let body = ""; res.on("data", (c) => { body += c; }); res.on("end", () => end({ status: res.statusCode, body })); });
    req.on("error", (err) => end({ error: err.code }));
    const parts = [];
    for (let i = 0; i < chunks; i++) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="f${i}.bin"\r\nContent-Type: application/octet-stream\r\n\r\n${"x".repeat(size)}\r\n`));
    parts.push(Buffer.from(`--${boundary}--\r\n`));
    const timer = setInterval(() => {
      if (settled) return;
      const next = parts.shift();
      if (!next) { clearInterval(timer); req.end(); return; }
      written += next.length;
      req.write(next);
    }, 5);
  });
}

test("a chunked upload with no announced size is cut off once it passes the limit, and nothing is kept", async () => {
  const before = (await inbox.list()).length;
  // 45 files of 900 bytes: each under the per-upload limit (1000), far over it together
  const r = await chunked("ivan", 45, 900);
  assert.ok(r.status === 413 || r.error, JSON.stringify(r));
  if (r.status) assert.match(JSON.parse(r.body).error, /한 번에/);
  assert.ok(r.written < 45 * 900, `the server read on until ${r.written} bytes`);
  await new Promise((done) => setTimeout(done, 100));
  assert.deepEqual(fs.readdirSync(path.join(data, "inbox", ".staging")), []);
  assert.equal((await inbox.list()).length, before);
});

test("uploads in flight count against the quota, so two can't both pass a stale check", async () => {
  settings.save({ inboxQuotaBytes: (await inbox.usage({ fresh: true })) + 1500, inboxMaxBytes: 1000 });
  const [a, b] = await Promise.all([chunked("judy", 1, 900), chunked("ken", 1, 900)]);
  const codes = [a.status ?? a.error, b.status ?? b.error].sort();
  assert.equal(codes.filter((c) => c === 201).length, 1, JSON.stringify([a, b]));
  assert.ok(codes.some((c) => c === 507 || typeof c === "string"));
  settings.save({ inboxQuotaBytes: null, inboxMaxBytes: null });
  assert.deepEqual(fs.readdirSync(path.join(data, "inbox", ".staging")), []);
});

test("more files than an upload may carry are refused", async () => {
  const f = new FormData();
  for (let i = 0; i < 501; i++) f.append("files", new Blob(["1"]), `f${i}.txt`);
  const r = await post(f, headers("leo"));
  assert.equal(r.status, 400);
  assert.equal(fs.readdirSync(path.join(data, "inbox", ".staging")).length, 0);
});
