import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The library tab's file check API: only an admin session, the view, the full
// hash pass and a recheck of one file.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "cook-verify-api-"));
process.env.COOK_DATA_DIR = path.join(root, "data");
process.env.COOK_GAMES_DIR = path.join(root, "games");
fs.mkdirSync(process.env.COOK_GAMES_DIR, { recursive: true });
const express = (await import("express")).default;
const { mountLibraryFilesApi } = await import("../../src/routes/admin/library-files-api.js");

const calls = [];
const fake = {
  view: () => ({ status: "idle", counts: { ok: 1, modified: 1, damaged: 0, unchecked: 0 }, flagged: [{ path: "a/Game.nsp", verdict: "modified", reason: "signature-fail" }] }),
  hashAll: () => { calls.push("hashAll"); return 3; },
  recheck: (rel) => { calls.push(`recheck ${rel}`); return rel === "a/Game.nsp"; },
};
const app = express();
app.use(express.json());
const router = express.Router();
mountLibraryFilesApi(router, (req, res) => (req.get("x-admin") ? true : (res.status(401).json({ error: "2fa required" }), false)), fake);
app.use("/admin", router);
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const BASE = `http://127.0.0.1:${server.address().port}/admin/api/library/verify`;
after(() => { server.close(); fs.rmSync(root, { recursive: true, force: true }); });
const call = (p, body) => fetch(BASE + p, { method: body ? "POST" : "GET", headers: { "x-admin": "1", "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

test("only an admin session reads or drives the file check", async () => {
  assert.equal((await fetch(BASE)).status, 401);
  assert.equal((await fetch(`${BASE}/hash-all`, { method: "POST" })).status, 401);
  assert.deepEqual(calls, []);
});

test("the view lists counts and the flagged files", async () => {
  const d = await (await call("")).json();
  assert.equal(d.counts.modified, 1);
  assert.equal(d.flagged[0].path, "a/Game.nsp");
});

test("the full hash pass says how many files it queued; a recheck needs a known file", async () => {
  assert.deepEqual(await (await call("/hash-all", {})).json(), { ok: true, queued: 3 });
  assert.equal((await call("/recheck", { rel: "a/Game.nsp" })).status, 200);
  assert.equal((await call("/recheck", { rel: "nope.nsp" })).status, 404);
  assert.equal((await call("/recheck", {})).status, 404);
});
