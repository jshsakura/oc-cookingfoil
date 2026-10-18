import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The admin page's 임시 공유 tab: the entries newest first, their files to
// download, 정리함 to set aside and delete, never anything outside the inbox.
const data = fs.mkdtempSync(path.join(os.tmpdir(), "cook-inbox-admin-"));
process.env.COOK_DATA_DIR = data;
const express = (await import("express")).default;
const inbox = await import("../../src/meta/inbox.js");
const { mountInboxApi } = await import("../../src/routes/admin/inbox-api.js");

const app = express();
app.use(express.json());
const router = express.Router();
mountInboxApi(router, (req, res) => (req.get("x-admin") ? true : (res.status(401).json({ error: "2fa required" }), false)));
app.use("/admin", router);
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const BASE = `http://127.0.0.1:${server.address().port}/admin/api/inbox`;
after(() => server.close());
const ADMIN = { "x-admin": "1" };

async function entry(user, at, files, extra = {}) {
  const work = await inbox.newStaging();
  const list = Object.entries(files).map(([name, text], i) => {
    const p = path.join(work, "in", `f${i}`);
    fs.writeFileSync(p, text);
    return { path: p, name };
  });
  return inbox.create({ user, slug: user, work, files: list, memo: extra.memo ?? "", links: extra.links ?? [], now: at });
}
const older = await entry("alice", new Date(2026, 9, 14, 9, 0, 0), { "save.zip": "zip" }, { memo: "세이브", links: ["https://a.example/"] });
const newer = await entry("bob", new Date(2026, 9, 14, 10, 0, 0), { "dir/a.txt": "hello" });
fs.writeFileSync(path.join(data, "secret.txt"), "not for download");

test("only an admin session sees the inbox", async () => {
  assert.equal((await fetch(BASE)).status, 401);
  assert.equal((await fetch(BASE, { method: "DELETE" })).status, 404);
});

test("entries come newest first with their memo, links, files and size, plus how full the inbox is", async () => {
  const d = await (await fetch(BASE, { headers: ADMIN })).json();
  assert.deepEqual(d.entries.map((e) => e.user), ["bob", "alice"]);
  const a = d.entries[1];
  assert.deepEqual([a.memo, a.links, a.bytes, a.done], ["세이브", ["https://a.example/"], 3, false]);
  assert.equal(a.files[0].url, `/admin/api/inbox/${older.id}/file?path=save.zip`);
  assert.ok(d.usage > 0);
  assert.equal(typeof d.quota, "number");
  assert.equal(typeof d.enabled, "boolean");
});

test("a file downloads under its own name; a path outside the entry does not", async () => {
  const r = await fetch(`${BASE}/${newer.id}/file?path=${encodeURIComponent("dir/a.txt")}`, { headers: ADMIN });
  assert.equal(r.status, 200);
  assert.equal(await r.text(), "hello");
  assert.match(r.headers.get("content-disposition"), /attachment; filename="a\.txt"/);
  for (const bad of ["../note.json", "../../../secret.txt", "/etc/passwd"]) {
    assert.equal((await fetch(`${BASE}/${newer.id}/file?path=${encodeURIComponent(bad)}`, { headers: ADMIN })).status, 404, bad);
  }
  assert.equal((await fetch(`${BASE}/..%2F..%2Fsecurity/file?path=x`, { headers: ADMIN })).status, 404);
});

test("정리함 sets an entry aside without deleting it, and the filter finds it", async () => {
  const r = await fetch(`${BASE}/${older.id}/done`, { method: "POST", headers: { ...ADMIN, "Content-Type": "application/json" }, body: JSON.stringify({ done: true }) });
  assert.equal(r.status, 200);
  assert.deepEqual((await (await fetch(`${BASE}?show=open`, { headers: ADMIN })).json()).entries.map((e) => e.user), ["bob"]);
  assert.deepEqual((await (await fetch(`${BASE}?show=done`, { headers: ADMIN })).json()).entries.map((e) => e.user), ["alice"]);
  assert.equal((await (await fetch(`${BASE}?show=all`, { headers: ADMIN })).json()).entries.length, 2);
  assert.ok(fs.existsSync(path.join(data, "inbox", older.id, "files", "save.zip")));
});

test("writes from another site are refused", async () => {
  const r = await fetch(`${BASE}/${newer.id}`, { method: "DELETE", headers: { ...ADMIN, Origin: "https://evil.example" } });
  assert.equal(r.status, 403);
  assert.ok(fs.existsSync(path.join(data, "inbox", newer.id)));
});

test("deleting removes that one entry; an unknown or crafted id removes nothing", async () => {
  assert.equal((await fetch(`${BASE}/${newer.id}`, { method: "DELETE", headers: ADMIN })).status, 200);
  assert.equal(fs.existsSync(path.join(data, "inbox", newer.id)), false);
  assert.equal((await fetch(`${BASE}/${newer.id}`, { method: "DELETE", headers: ADMIN })).status, 404);
  assert.equal((await fetch(`${BASE}/..%2F..`, { method: "DELETE", headers: ADMIN })).status, 404);
  assert.ok(fs.existsSync(path.join(data, "secret.txt")));
  assert.ok(fs.existsSync(path.join(data, "inbox", older.id)));
});
