import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Resumable uploads on the public site's routes (inbox, upload tray, picture editor): each keeps its own sign-in
// and CSRF rules, an upload is its sender's alone, and the limits are checked when an upload starts.
const data = fs.mkdtempSync(path.join(os.tmpdir(), "cook-chunk-public-"));
process.env.COOK_DATA_DIR = data;
process.env.COOK_GAMES_DIR = path.join(data, "games");
process.env.COOK_INBOX_MAX_BYTES = "1000";
process.env.COOK_INBOX_QUOTA_BYTES = "2500";
process.env.COOK_UPLOADS_ENABLED = "true";
process.env.COOK_UPLOAD_MAX_BYTES = "1000";
const express = (await import("express")).default;
const { default: inboxRouter } = await import("../../src/routes/inbox.js");
const { default: uploadsRouter } = await import("../../src/routes/uploads.js");
const { default: artRouter } = await import("../../src/routes/art.js");

const sent = [];
const app = express();
// Who is asking is the x-test-user header; the routers read it where they read the real session.
app.use((req, _res, next) => {
  if (req.get("x-test-user")) req.webUser = { kind: "password", name: req.get("x-test-user") };
  next();
});
app.use("/api/inbox", inboxRouter({
  whoOf: (req) => (req.get("x-test-user") ? { name: req.get("x-test-user"), label: req.get("x-test-user"), slug: req.get("x-test-user") } : null),
  notify: (_text, id) => sent.push(id),
}));
app.use("/api/uploads", uploadsRouter());
app.use("/api/art", artRouter());
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const BASE = `http://127.0.0.1:${server.address().port}`;
after(() => {
  server.close();
  fs.rmSync(data, { recursive: true, force: true });
});

const CSRF = "c".repeat(40);
const headers = (user = "alice", extra = {}) => ({ ...(user ? { "x-test-user": user } : {}), Cookie: `cf_csrf=${CSRF}`, "X-CSRF-Token": CSRF, ...extra });
const json = (method, url, body, h = headers()) => fetch(`${BASE}${url}`, { method, headers: { ...h, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const decl = (name, size) => ({ name, size, lastModified: 1_700_000_000_000 });
const put = (base, id, offset, bytes, h = headers()) => fetch(`${BASE}${base}/chunks/${id}?offset=${offset}`, { method: "PUT", headers: { ...h, "Content-Type": "application/octet-stream" }, body: bytes });
/** One file in two pieces; the id. */
async function upload(base, name, text, h = headers()) {
  const r = await json("POST", `${base}/chunks`, decl(name, text.length), h);
  assert.equal(r.status, 200, await r.clone().text());
  const { id } = await r.json();
  const cut = Math.ceil(text.length / 2);
  assert.equal((await put(base, id, 0, text.slice(0, cut), h)).status, 200);
  assert.equal((await put(base, id, cut, text.slice(cut), h)).status, 200);
  return id;
}
const entries = () => fs.readdirSync(path.join(data, "inbox")).filter((n) => !n.startsWith("."));

test("inbox: a file in pieces becomes a note, once, and nobody else can touch the pieces", async () => {
  const id = await upload("/api/inbox", "a.txt", "hello world");
  // Bob names Alice's upload: it is not his, so it is nothing.
  const bob = headers("bob");
  assert.equal((await put("/api/inbox", id, 0, "x", bob)).status, 404);
  assert.equal((await json("POST", "/api/inbox/finish", { ids: [id], memo: "mine now" }, bob)).status, 404);
  assert.equal((await put("/api/inbox", id, 0, "x")).status, 409, "Alice's is untouched: her offset is still the whole file");

  const r = await json("POST", "/api/inbox/finish", { ids: [id], memo: "note" });
  assert.equal(r.status, 201, await r.clone().text());
  const body = await r.json();
  assert.deepEqual([body.ok, body.files, body.bytes], [true, 1, 11]);
  assert.deepEqual(body.items, [{ name: "a.txt", size: 11 }]);
  assert.equal(fs.readFileSync(path.join(data, "inbox", body.id, "files", "a.txt"), "utf8"), "hello world");
  assert.equal((await json("POST", "/api/inbox/finish", { ids: [id], memo: "note" })).status, 404, "taken: a second finish finds nothing");
  assert.equal(entries().length, 1, "left once");
  assert.equal(sent.length, 1);
});

test("inbox: sign-in, CSRF token and origin are the inbox's own, on every chunk route", async () => {
  assert.equal((await json("POST", "/api/inbox/chunks", decl("a", 1), headers(null))).status, 401);
  assert.equal((await json("POST", "/api/inbox/finish", { ids: [] }, headers(null))).status, 401);
  const noCsrf = { "x-test-user": "alice", Cookie: `cf_csrf=${CSRF}` };
  assert.equal((await json("POST", "/api/inbox/chunks", decl("a", 1), noCsrf)).status, 403);
  assert.equal((await put("/api/inbox", "0".repeat(32), 0, "x", noCsrf)).status, 403);
  assert.equal((await json("POST", "/api/inbox/finish", { ids: [], memo: "x" }, noCsrf)).status, 403);
  assert.equal((await json("POST", "/api/inbox/chunks", decl("a", 1), headers("alice", { Origin: "https://evil.example.com" }))).status, 403);
});

test("inbox: names that climb out, bad ids and oversized pieces are refused", async () => {
  assert.equal((await json("POST", "/api/inbox/chunks", decl("../../etc/passwd", 5))).status, 400);
  assert.equal((await json("POST", "/api/inbox/chunks", decl("a/b.txt", 5))).status, 400);
  assert.equal((await put("/api/inbox", "..%2F..%2Fx", 0, "x")).status, 404);
  assert.equal((await json("POST", "/api/inbox/finish", { ids: ["../x"] })).status, 400);
  const id = await upload("/api/inbox", "small.txt", "abc");
  assert.equal((await put("/api/inbox", id, 3, "more")).status, 400, "past the announced size");
});

test("inbox: the size and the quota are held when the upload starts, and a refused finish keeps the pieces", async () => {
  assert.equal((await json("POST", "/api/inbox/chunks", decl("big.bin", 1001))).status, 413, "over one upload's size");

  // Two files that fit alone but not together: the finish is refused and both stay.
  const x = await upload("/api/inbox", "x.bin", "x".repeat(600));
  const y = await upload("/api/inbox", "y.bin", "y".repeat(600));
  const r = await json("POST", "/api/inbox/finish", { ids: [x, y] });
  assert.equal(r.status, 413);
  assert.equal((await put("/api/inbox", x, 0, "x")).status, 409, "kept: its offset is still the whole file");
  assert.equal((await json("POST", "/api/inbox/finish", { ids: [x] })).status, 201, "one of them goes alone without sending it again");

  // Quota 2500: the inbox holds 611 (x and the first note), y's announced 600 is held; 700 more fits, 700 more again does not.
  assert.equal((await json("POST", "/api/inbox/chunks", decl("q1", 700))).status, 200);
  const full = await json("POST", "/api/inbox/chunks", decl("q2", 700), headers("bob"));
  assert.equal(full.status, 507);
  assert.equal((await full.json()).code, "full");
  // Starting the same file again does not count it twice.
  assert.equal((await json("POST", "/api/inbox/chunks", decl("q1", 700))).status, 200);
});

test("tray: the tray's own limits are checked when an upload starts; pieces are the sender's alone", async () => {
  const NAME = "Tray Game [0100000000010000][v0].nsp";
  let r = await json("POST", "/api/uploads/chunks", decl("notes.txt", 5));
  assert.equal(r.status, 400);
  assert.equal((await r.json()).code, "bad-name");
  assert.equal((await json("POST", "/api/uploads/chunks", decl(NAME, 1001))).status, 413, "over the size limit");
  const id = await upload("/api/uploads", NAME, "0123456789");
  assert.equal((await put("/api/uploads", id, 0, "x", headers("bob"))).status, 404);
  assert.equal((await json("POST", "/api/uploads/finish", { ids: [id] }, headers("bob"))).status, 404);
  r = await json("POST", "/api/uploads/finish", { ids: [id] });
  assert.equal(r.status, 201, await r.clone().text());
  const desc = await r.json();
  assert.equal(desc.name, NAME);
  assert.equal(desc.size, 10);
  assert.equal((await json("POST", "/api/uploads/finish", { ids: [id] })).status, 404, "placed once");
  const listed = (await (await fetch(`${BASE}/api/uploads`, { headers: headers() })).json()).uploads;
  assert.equal(listed.length, 1);
  // 10 bytes are pending: a file that would take the pending total past the limit is refused at the start.
  assert.equal((await json("POST", "/api/uploads/chunks", decl("Big [0100000000020000][v0].nsp", 995))).status, 413);
});

test("art: a picture's pieces are the sender's alone and its size is checked at the start", async () => {
  assert.equal((await json("POST", "/api/art/chunks", decl("huge.png", 17 * 1024 * 1024))).status, 413);
  const id = await upload("/api/art", "cover.png", "not really an image");
  assert.equal((await put("/api/art", id, 0, "x", headers("bob"))).status, 404);
  // Bob cannot use Alice's upload in a request either.
  const stolen = await fetch(`${BASE}/api/art/retro/nope/boxart`, { method: "POST", headers: headers("bob", { "X-Chunk-Id": id }) });
  assert.equal(stolen.status, 404);
  assert.equal((await stolen.json()).code, "upload.unknownChunk");
  // Alice's request takes it; a game that does not exist is refused, and the picture is used up.
  const refused = await fetch(`${BASE}/api/art/retro/nope/boxart`, { method: "POST", headers: headers("alice", { "X-Chunk-Id": id }) });
  assert.equal(refused.status, 404);
  assert.equal((await put("/api/art", id, 0, "x")).status, 404, "taken by the request that named it");
});
