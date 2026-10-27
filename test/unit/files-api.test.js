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

const chunks = await import("../../src/meta/upload-chunks.js");
const dropDir = path.join(base, "drop-chunks");

const app = express();
app.use(express.json());
mountFilesApi(app, () => true, createFileRoots({ roots: () => [games], refresh: () => {} }), { dropDir: () => dropDir });
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

test("a file downloads even when the root's own path has a dot folder in it", async () => {
  const dotted = { key: "games", dir: path.join(base, ".hidden-parent", "games") };
  fs.mkdirSync(dotted.dir, { recursive: true });
  fs.writeFileSync(path.join(dotted.dir, "x.nsp"), "xyz");
  const app2 = express();
  mountFilesApi(app2, () => true, createFileRoots({ roots: () => [dotted], refresh: () => {}, fences: () => [] }));
  const s2 = app2.listen(0);
  try {
    const r = await fetch(`http://127.0.0.1:${s2.address().port}/api/files/download?root=games&path=x.nsp`);
    assert.equal(r.status, 200);
    assert.equal(await r.text(), "xyz");
  } finally {
    s2.close();
  }
});

test("a HEAD of a download is blocked for tokens like its GET", () => {
  assert.equal(tokenBlocked("HEAD", "/api/files/download"), true);
});

// Upload into the open folder: the file goes up in pieces (meta/upload-chunks.js), then one call places it.
const ME = "admin:admin";
async function sendFile(rel, body, at = "") {
  const r = await post("/api/files/upload/chunks", { root: "games", path: at, rel, size: body.length, lastModified: 1 });
  if (r.status !== 200) return r;
  const { id, kind } = await r.json();
  assert.equal(kind, "drop-games");
  await chunks.append(dropDir, id, ME, 0, Buffer.from(body));
  return post("/api/files/upload", { root: "games", path: at, items: [{ id, rel }] });
}

test("a dropped file lands in the open folder, a dropped folder keeps its shape", async () => {
  fs.mkdirSync(path.join(games.dir, "Drop"), { recursive: true });
  let r = await sendFile("one.nsp", "1111", "Drop");
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual(await r.json(), { placed: ["Drop/one.nsp"], skipped: [] });
  assert.equal(fs.readFileSync(path.join(games.dir, "Drop", "one.nsp"), "utf8"), "1111");
  r = await sendFile("Pack/sub/two.nsp", "22", "Drop");
  assert.deepEqual((await r.json()).placed, ["Drop/Pack/sub/two.nsp"]);
  assert.equal(fs.readFileSync(path.join(games.dir, "Drop", "Pack", "sub", "two.nsp"), "utf8"), "22");
  assert.deepEqual(fs.readdirSync(dropDir), [], "no partial is left");
});

test("a name already in the folder is refused before a byte goes up, and never overwritten after", async () => {
  fs.mkdirSync(path.join(games.dir, "Taken"), { recursive: true });
  fs.writeFileSync(path.join(games.dir, "Taken", "x.nsp"), "old");
  const r = await post("/api/files/upload/chunks", { root: "games", path: "Taken", rel: "x.nsp", size: 3, lastModified: 1 });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).code, "exists");
  // Taken while the bytes were going up: skipped, the old file stays, the partial waits for the sweep.
  const begun = await (await post("/api/files/upload/chunks", { root: "games", path: "Taken", rel: "y.nsp", size: 3, lastModified: 1 })).json();
  await chunks.append(dropDir, begun.id, ME, 0, Buffer.from("new"));
  fs.writeFileSync(path.join(games.dir, "Taken", "y.nsp"), "old");
  const done = await (await post("/api/files/upload", { root: "games", path: "Taken", items: [{ id: begun.id, rel: "y.nsp" }] })).json();
  assert.deepEqual(done, { placed: [], skipped: [{ rel: "y.nsp", code: "exists" }] });
  assert.equal(fs.readFileSync(path.join(games.dir, "Taken", "y.nsp"), "utf8"), "old");
});

test("an upload path that climbs out, hides in a dot folder or has a bad name is refused", async () => {
  for (const rel of ["../out.nsp", ".hidden/x.nsp", "a/../../x.nsp", "bad\\name.nsp", ""]) {
    const r = await post("/api/files/upload/chunks", { root: "games", path: "", rel, size: 1, lastModified: 1 });
    assert.ok([400, 404].includes(r.status), `${rel}: ${r.status}`);
  }
  const r = await post("/api/files/upload/chunks", { root: "games", path: "../", rel: "x.nsp", size: 1, lastModified: 1 });
  assert.equal(r.status, 400);
});

test("automation tokens may not upload into the file browser", () => {
  assert.equal(tokenBlocked("POST", "/api/files/upload/chunks"), true);
  assert.equal(tokenBlocked("POST", "/api/files/upload"), true);
});
