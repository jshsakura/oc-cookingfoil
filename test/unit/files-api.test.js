import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import yauzl from "yauzl";

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
const { createFileShares } = await import("../../src/library/file-shares.js");
const { default: fileShareRouter } = await import("../../src/routes/file-share.js");
let clock = 1_000_000;
const kept = new Map();
const shares = createFileShares({ store: { load: () => [...kept], sync: (m) => { kept.clear(); for (const [k, v] of m) kept.set(k, v); } }, now: () => clock });
const roots = createFileRoots({ roots: () => [games], refresh: () => {} });
mountFilesApi(app, () => true, roots, { dropDir: () => dropDir, warmSizes: false, shares });
app.use(fileShareRouter({ shares, files: roots }));
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
  assert.deepEqual(moved.moved.map(({ from, to }) => ({ from, to })), [{ from: "Folder/b.nsp", to: "New/b.nsp" }]);
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

test("a selection comes down as one zip with its folders, stored as is and with its length known", async () => {
  fs.mkdirSync(path.join(games.dir, "Zip", "Set", "Inner"), { recursive: true });
  fs.mkdirSync(path.join(games.dir, "Zip", "Set", ".hidden"), { recursive: true });
  fs.writeFileSync(path.join(games.dir, "Zip", "Set", "Inner", "b.nsp"), "bb");
  fs.writeFileSync(path.join(games.dir, "Zip", "Set", ".hidden", "no.txt"), "x");
  fs.writeFileSync(path.join(games.dir, "Zip", "c.nsp"), "ccc");
  fs.symlinkSync(base, path.join(games.dir, "Zip", "Set", "away"));
  const ask = await post("/api/files/zip", { root: "games", paths: ["Zip/Set", "Zip/c.nsp"] });
  assert.equal(ask.status, 200);
  const r = await fetch(url((await ask.json()).url.replace("/admin", "")));
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-disposition"), /filename="Zip\.zip"/);
  const body = Buffer.from(await r.arrayBuffer());
  assert.equal(Number(r.headers.get("content-length")), body.length);
  const names = await new Promise((ok, no) => yauzl.fromBuffer(body, { lazyEntries: true }, (err, zip) => {
    if (err) return no(err);
    const out = [];
    zip.on("entry", (e) => { out.push([e.fileName, e.compressionMethod]); zip.readEntry(); });
    zip.on("end", () => ok(out));
    zip.readEntry();
  }));
  assert.deepEqual(names, [["Set/", 0], ["Set/Inner/", 0], ["Set/Inner/b.nsp", 0], ["c.nsp", 0]]);
});

test("a zip of one item is named after it; a path that climbs out or an old link is refused", async () => {
  const one = await (await post("/api/files/zip", { root: "games", paths: ["Folder"] })).json();
  const r = await fetch(url(one.url.replace("/admin", "")));
  assert.match(r.headers.get("content-disposition"), /filename="Folder\.zip"/);
  await r.arrayBuffer();
  assert.equal((await post("/api/files/zip", { root: "games", paths: ["../x"] })).status, 400);
  assert.equal((await fetch(url("/api/files/zip/0123"))).status, 404);
});

test("automation tokens may not zip the file browser's folders", () => {
  assert.equal(tokenBlocked("POST", "/api/files/zip"), true);
  assert.equal(tokenBlocked("GET", "/api/files/zip/abc"), true);
  assert.equal(tokenBlocked("GET", "/api/files/list"), false);
});

test("a copy lands beside a taken name with a number and leaves the original", async () => {
  fs.mkdirSync(path.join(games.dir, "Copy", "Pack"), { recursive: true });
  fs.writeFileSync(path.join(games.dir, "Copy", "Pack", "p.nsp"), "pp");
  fs.writeFileSync(path.join(games.dir, "Copy", "x.nsp"), "xx");
  const r = await post("/api/files/copy", { root: "games", paths: ["Copy/x.nsp", "Copy/Pack"], toPath: "Copy" });
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).copied, [{ from: "Copy/x.nsp", to: "Copy/x (2).nsp" }, { from: "Copy/Pack", to: "Copy/Pack (2)" }]);
  assert.equal(fs.readFileSync(path.join(games.dir, "Copy", "x (2).nsp"), "utf8"), "xx");
  assert.equal(fs.readFileSync(path.join(games.dir, "Copy", "Pack (2)", "p.nsp"), "utf8"), "pp");
  assert.equal(fs.readFileSync(path.join(games.dir, "Copy", "x.nsp"), "utf8"), "xx");
  const into = await (await post("/api/files/copy", { root: "games", paths: ["Copy/Pack"], toPath: "Copy/Pack" })).json();
  assert.deepEqual(into, { copied: [], skipped: [{ rel: "Copy/Pack", code: "into-itself" }] });
});

test("a search with deep finds names in every folder below, and info counts through folders", async () => {
  fs.mkdirSync(path.join(games.dir, "Deep", "a", "b"), { recursive: true });
  fs.writeFileSync(path.join(games.dir, "Deep", "a", "b", "needle.nsp"), "12345");
  fs.writeFileSync(path.join(games.dir, "Deep", "needle-top.txt"), "1");
  const flat = await (await fetch(url("/api/files/list?root=games&path=Deep&q=needle"))).json();
  assert.deepEqual(flat.items.map((i) => i.rel), ["Deep/needle-top.txt"]);
  const deep = await (await fetch(url("/api/files/list?root=games&path=Deep&q=needle&deep=1"))).json();
  assert.deepEqual(deep.items.map((i) => i.rel).sort(), ["Deep/a/b/needle.nsp", "Deep/needle-top.txt"]);
  assert.equal(deep.deep, true);
  assert.equal(deep.cut, false);
  const info = await (await post("/api/files/info", { root: "games", paths: ["Deep"] })).json();
  assert.deepEqual({ files: info.files, dirs: info.dirs, bytes: info.bytes }, { files: 2, dirs: 3, bytes: 6 });
});

test("a move and a rename answer the journal line that undoes them, a trash the ids that restore it", async () => {
  fs.mkdirSync(path.join(games.dir, "Undo", "To"), { recursive: true });
  fs.writeFileSync(path.join(games.dir, "Undo", "m.nsp"), "m");
  const moved = await (await post("/api/files/move", { root: "games", paths: ["Undo/m.nsp"], toPath: "Undo/To" })).json();
  assert.match(moved.moved[0].undo, /^[0-9a-f]{12}$/);
  const renamed = await (await post("/api/files/rename", { root: "games", path: "Undo/To/m.nsp", name: "n.nsp" })).json();
  assert.match(renamed.undo, /^[0-9a-f]{12}$/);
  const trashed = await (await post("/api/files/trash", { root: "games", paths: ["Undo/To/n.nsp"] })).json();
  assert.equal(trashed.restore.length, 1);
  assert.equal(trashed.restore[0], trashed.trash);
});

test("automation tokens may not copy or measure in the file browser", () => {
  assert.equal(tokenBlocked("POST", "/api/files/copy"), true);
  assert.equal(tokenBlocked("POST", "/api/files/info"), true);
});

test("a folder that holds a fenced one is neither copied nor moved, and a path picked twice zips once", async () => {
  const fenced = path.join(games.dir, "Outer", "fence");
  fs.mkdirSync(fenced, { recursive: true });
  fs.writeFileSync(path.join(fenced, "secret.keys"), "k");
  const files = createFileRoots({ roots: () => [games], refresh: () => {}, fences: () => [fenced] });
  assert.deepEqual((await files.copy("games", ["Outer"], "games", "")).skipped, [{ rel: "Outer", code: "bad-path" }]);
  assert.deepEqual((await files.move("games", ["Outer"], "games", "Folder")).skipped, [{ rel: "Outer", code: "bad-path" }]);
  const twice = await files.collect("games", ["Folder", "Folder"]);
  assert.equal(twice.filter((e) => e.name === "Folder").length, 1);
  const cut = await files.collect("games", ["Folder"], { max: 1 });
  assert.equal(cut.cut, true);
});

test("titleLabel names a title id's game in the asked language, an update or DLC by its base game", async () => {
  const { titleLabel } = await import("../../src/library/file-facts.js");
  const db = { "0100AAAA00000000": { ko: "알파", en: "Alpha" } };
  const label = titleLabel("ko", (id) => db[id] ?? null);
  assert.equal(label("0100AAAA00000000"), "알파");
  assert.equal(label("0100AAAA00000800"), "알파");
  assert.equal(label("0100AAAA00001003 [DLC].nsp"), "알파");
  assert.equal(label("0100CCCC00000000"), null);
  assert.equal(label("Alpha Quest"), null);
  assert.equal(titleLabel("ja", (id) => db[id] ?? null)("0100AAAA00000000"), "Alpha");
});

test("a copy in the background answers a job at once, then its bytes and what it did", async () => {
  fs.mkdirSync(path.join(games.dir, "Bg/Pack"), { recursive: true });
  fs.writeFileSync(path.join(games.dir, "Bg/Pack/a.nsp"), "12345");
  fs.writeFileSync(path.join(games.dir, "Bg/b.nsp"), "678");
  const start = await (await post("/api/files/copy", { root: "games", paths: ["Bg/Pack", "Bg/b.nsp"], toPath: "Bg", background: true })).json();
  assert.equal(start.total, 8);
  assert.match(start.job, /^[0-9a-f]{24}$/);
  let job;
  for (let i = 0; i < 200; i++) {
    job = await (await fetch(url(`/api/files/copy/${start.job}`))).json();
    if (job.state !== "running") break;
    await new Promise((ok) => setTimeout(ok, 10));
  }
  assert.equal(job.state, "done");
  assert.equal(job.done, 8);
  assert.deepEqual(job.copied, [{ from: "Bg/Pack", to: "Bg/Pack (2)" }, { from: "Bg/b.nsp", to: "Bg/b (2).nsp" }]);
  assert.equal(fs.readFileSync(path.join(games.dir, "Bg/Pack (2)/a.nsp"), "utf8"), "12345");
  assert.equal((await fetch(url("/api/files/copy/" + "0".repeat(24)))).status, 404);
  assert.equal((await post("/api/files/copy", { root: "games", paths: ["Bg/none"], toPath: "Bg", background: true })).status, 404);
  assert.equal(tokenBlocked("GET", "/api/files/copy/abc"), true);
});

test("only=dirs lists the folders alone", async () => {
  fs.mkdirSync(path.join(games.dir, "Dirs/Sub"), { recursive: true });
  fs.writeFileSync(path.join(games.dir, "Dirs/f.nsp"), "x");
  const d = await (await fetch(url("/api/files/list?root=games&path=Dirs&only=dirs"))).json();
  assert.deepEqual(d.items.map((i) => i.name), ["Sub"]);
});

test("the library's facts ride on a listing: a game file's kind, version and check, a folder's game", async () => {
  const { createFileFacts } = await import("../../src/library/file-facts.js");
  const facts = createFileFacts({
    files: () => [
      { rel: "Alpha/Alpha [0100AAAA00000000][v0].nsp", kind: "base", titleId: "0100AAAA00000000", baseTitleId: "0100AAAA00000000", version: 0 },
      { rel: "Alpha/Alpha [0100AAAA00000800][v65536].nsp", kind: "update", titleId: "0100AAAA00000800", baseTitleId: "0100AAAA00000000", version: 65536 },
    ],
    integrity: (rel) => (rel.includes("v65536") ? "damaged" : "passed"),
    latest: () => 131072,
  });
  const at = (rel, type = "file") => ({ name: rel.split("/").pop(), rel, type });
  const [dir, base, upd, save, other] = facts("games", [at("Alpha", "dir"), at("Alpha/Alpha [0100AAAA00000000][v0].nsp"), at("Alpha/Alpha [0100AAAA00000800][v65536].nsp"), at("0100BBBB00000800", "dir"), at("notes.txt")]);
  assert.equal(dir.titleId, "0100AAAA00000000");
  assert.deepEqual([base.kind, base.version, base.latest, base.check], ["base", 0, null, null]);
  assert.deepEqual([upd.kind, upd.titleId, upd.latest, upd.check], ["update", "0100AAAA00000000", false, "damaged"]);
  assert.equal(save.titleId, "0100BBBB00000000");
  assert.equal(other.titleId, undefined);
  assert.equal(facts("saves", [at("Alpha/Alpha [0100AAAA00000000][v0].nsp")])[0].kind, undefined);
});

test("folder sizes come from a cache that sees a change in any folder below", async () => {
  fs.mkdirSync(path.join(games.dir, "Sized/Deep/Deeper"), { recursive: true });
  fs.writeFileSync(path.join(games.dir, "Sized/a.nsp"), "1234");
  fs.writeFileSync(path.join(games.dir, "Sized/Deep/Deeper/b.nsp"), "56");
  fs.writeFileSync(path.join(games.dir, "Sized/.hidden"), "xxxxxxxx");
  const sizes = async (paths) => (await (await post("/api/files/sizes", { root: "games", paths })).json()).sizes;
  assert.deepEqual(await sizes(["Sized", "Sized/a.nsp", "../x"]), { Sized: { bytes: 6, files: 2, dirs: 2 } });
  fs.writeFileSync(path.join(games.dir, "Sized/Deep/Deeper/c.nsp"), "789");
  assert.deepEqual((await sizes(["Sized"])).Sized, { bytes: 9, files: 3, dirs: 2 });
  fs.rmSync(path.join(games.dir, "Sized/Deep"), { recursive: true });
  assert.deepEqual((await sizes(["Sized"])).Sized, { bytes: 4, files: 1, dirs: 0 });
  assert.equal(tokenBlocked("POST", "/api/files/sizes"), true);
});

test("a share link sends one file to anyone until it runs out or is ended, and only its hash is kept", async () => {
  fs.mkdirSync(path.join(games.dir, "Shared"), { recursive: true });
  fs.writeFileSync(path.join(games.dir, "Shared/s.nsp"), "abc");
  const made = await (await post("/api/files/share", { root: "games", path: "Shared/s.nsp", hours: 24 })).json();
  const token = made.url.split("/share/")[1];
  assert.match(token, /^[A-Za-z0-9_-]{32}$/);
  assert.ok(![...kept.keys()].includes(token) && !JSON.stringify([...kept]).includes(token), "the token itself is never stored");
  const got = await fetch(url(`/share/${token}`));
  assert.equal(got.status, 200);
  assert.equal(await got.text(), "abc");
  assert.match(got.headers.get("content-disposition"), /s\.nsp/);
  assert.equal((await fetch(url("/share/" + "A".repeat(32)))).status, 404);

  const live = await (await fetch(url("/api/files/shares?root=games&path=Shared%2Fs.nsp"))).json();
  assert.deepEqual(live.shares.map((x) => x.id), [made.id]);
  clock += 24 * 60 * 60 * 1000;
  assert.equal((await fetch(url(`/share/${token}`))).status, 404, "a day later the link has run out");
  assert.equal(kept.size, 0, "a link that ran out is dropped");

  const again = await (await post("/api/files/share", { root: "games", path: "Shared/s.nsp", hours: 1 })).json();
  assert.equal((await post("/api/files/share/end", { id: again.id })).status, 200);
  assert.equal((await fetch(url(`/share/${again.url.split("/share/")[1]}`))).status, 404, "an ended link opens nothing");

  assert.equal((await post("/api/files/share", { root: "games", path: "Shared/s.nsp", hours: 5 })).status, 400);
  assert.equal((await post("/api/files/share", { root: "games", path: "Shared", hours: 1 })).status, 400, "a folder is not shared");
  assert.equal((await post("/api/files/share", { root: "games", path: "../x", hours: 1 })).status, 400);
  for (const [m, p] of [["POST", "/api/files/share"], ["GET", "/api/files/shares"], ["POST", "/api/files/share/end"]]) assert.equal(tokenBlocked(m, p), true, `${m} ${p}`);
});
