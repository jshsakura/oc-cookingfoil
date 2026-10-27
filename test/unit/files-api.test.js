import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";

// The admin file browser's HTTP side: it answers in the page's language with a
// code the script can branch on, sends files, and keeps every write away from
// automation tokens.
const { mountFilesApi } = await import("../../src/routes/admin/files-api.js");
const { createFileRoots } = await import("../../src/library/file-roots.js");
const { tokenBlocked } = await import("../../src/routes/admin-page.js");

const base = fs.mkdtempSync(path.join(os.tmpdir(), "files-api-"));
const games = { key: "games", dir: path.join(base, "games") };
fs.mkdirSync(path.join(games.dir, "Folder"), { recursive: true });
fs.writeFileSync(path.join(games.dir, "Folder", "a.nsp"), "abc");

const app = express();
app.use(express.json());
mountFilesApi(app, () => true, createFileRoots({ roots: () => [games], refresh: () => {} }));
const server = app.listen(0);
after(() => server.close());
const url = (p) => `http://127.0.0.1:${server.address().port}${p}`;
const post = (p, body, lang = "en") => fetch(url(p), { method: "POST", headers: { "content-type": "application/json", "accept-language": lang }, body: JSON.stringify(body) });

test("a folder lists over HTTP", async () => {
  const r = await fetch(url("/api/files/list?root=games&path=Folder"));
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual(j.items.map((i) => [i.name, i.size]), [["a.nsp", 3]]);
  assert.equal(r.headers.get("cache-control"), "no-store");
});

test("a refused path answers with a code and words in the page's language", async () => {
  const r = await fetch(url("/api/files/list?root=games&path=../x"), { headers: { "accept-language": "ko" } });
  assert.equal(r.status, 400);
  const j = await r.json();
  assert.equal(j.code, "bad-path");
  assert.equal(j.error, "그 경로는 쓸 수 없습니다");
  const missing = await fetch(url("/api/files/list?root=data"));
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).code, "no-root");
});

test("a file downloads with its name", async () => {
  const r = await fetch(url("/api/files/download?root=games&path=Folder/a.nsp"));
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-disposition"), /a\.nsp/);
  assert.equal(await r.text(), "abc");
});

test("make, rename, move and trash run in turn, and a taken name is a 409", async () => {
  assert.deepEqual(await (await post("/api/files/mkdir", { root: "games", path: "", name: "New" })).json(), { root: "games", rel: "New" });
  assert.equal((await post("/api/files/mkdir", { root: "games", path: "", name: "New" })).status, 409);
  assert.equal((await (await post("/api/files/rename", { root: "games", path: "Folder/a.nsp", name: "b.nsp" })).json()).rel, "Folder/b.nsp");
  const moved = await (await post("/api/files/move", { root: "games", paths: ["Folder/b.nsp"], toPath: "New" })).json();
  assert.deepEqual(moved.moved, [{ from: "Folder/b.nsp", to: "New/b.nsp" }]);
  const trashed = await (await post("/api/files/trash", { root: "games", paths: ["New/b.nsp"] })).json();
  assert.deepEqual(trashed.files, ["New/b.nsp"]);
  assert.ok(!fs.existsSync(path.join(games.dir, "New", "b.nsp")));
});

test("a move or trash with no paths, or paths that are not strings, is refused", async () => {
  for (const paths of [undefined, [], [1], "a.nsp"]) {
    const r = await post("/api/files/trash", { root: "games", paths });
    assert.equal(r.status, 400, JSON.stringify(paths));
    assert.equal((await r.json()).code, "nothing");
  }
});

test("automation tokens may list but not write or download", () => {
  assert.equal(tokenBlocked("GET", "/api/files/list"), false);
  assert.equal(tokenBlocked("GET", "/api/files/roots"), false);
  assert.equal(tokenBlocked("GET", "/api/files/download"), true);
  for (const op of ["mkdir", "rename", "move", "trash"]) assert.equal(tokenBlocked("POST", `/api/files/${op}`), true, op);
});
