import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The library file browser: kinds, the stray "other" files, filters, sorting,
// paging, the counts, parameter checks and paths that never leave their folder.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "cook-lib-browse-"));
process.env.COOK_DATA_DIR = path.join(root, "data");
process.env.COOK_GAMES_DIR = path.join(root, "games");
fs.mkdirSync(process.env.COOK_GAMES_DIR, { recursive: true });
const express = (await import("express")).default;
const lb = await import("../../src/meta/library-browse.js");
const { mountLibraryBrowseApi } = await import("../../src/routes/admin/library-browse-api.js");
after(() => fs.rmSync(root, { recursive: true, force: true }));

const games = [
  { rel: "A/Alpha [0100000000010000][v0].nsp", name: "Alpha [0100000000010000][v0]", size: 300, kind: "base", titleId: "0100000000010000", mtime: 1000 },
  { rel: "A/Alpha [0100000000010800][v65536].nsp", name: "Alpha [0100000000010800][v65536]", size: 50, kind: "update", titleId: "0100000000010800", mtime: 3000 },
  { rel: "B/Beta [0100000000020000][v0].xci", name: "Beta [0100000000020000][v0]", size: 900, kind: "base", titleId: "0100000000020000", mtime: 2000 },
  { rel: "B/Beta [0100000000021001][v0].nsp", name: "Beta [0100000000021001][v0]", size: 10, kind: "dlc", titleId: "0100000000021001", mtime: 2500 },
  { rel: "tool.nro", name: "tool.nro", size: 5, kind: null, titleId: null, mtime: 100 },
];
const verdicts = { "B/Beta [0100000000020000][v0].xci": "damaged", "A/Alpha [0100000000010000][v0].nsp": "modified" };
const gameItems = () => games.map((g) => lb.gameItem(g, (rel) => verdicts[rel] ?? null));
const sample = () => [
  ...gameItems(),
  lb.item("patch", { name: "한글패치", rel: "0100000000010000/한글패치", size: 20, mtime: 4000, titleId: "0100000000010000" }),
  lb.item("save", { name: "All unlocked", rel: "0100000000010000/All unlocked", size: 1, mtime: 500, titleId: "0100000000010000" }),
  lb.item("other", { rel: "A/readme.txt", size: 2, mtime: 10 }),
];

test("game files keep their kind, drop the id tail from the name and carry version and the file check", () => {
  const [alpha, update, beta, , nro] = gameItems();
  assert.deepEqual(alpha, { name: "Alpha", kind: "base", rel: games[0].rel, size: 300, mtime: 1000, ext: ".nsp", titleId: "0100000000010000", version: 0, integrity: "modified", id: null, source: null, repo: null });
  assert.equal(update.version, 65536);
  assert.equal(update.integrity, "unchecked");
  assert.equal(beta.integrity, "damaged");
  assert.equal(nro.kind, "homebrew");
  assert.equal(nro.integrity, null);
});

test("defaults: base games by name, 50 a page, counts for every kind", () => {
  const r = lb.browse(sample(), lb.parseQuery({}));
  assert.deepEqual(r.items.map((i) => i.name), ["Alpha", "Beta"]);
  assert.deepEqual(r.counts, { base: 2, update: 1, dlc: 1, patch: 1, save: 1, homebrew: 1, other: 1 });
  assert.equal(r.total, 2);
  assert.equal(r.perPage, 50);
  assert.equal(r.pages, 1);
});

test("kinds combine with a comma and 'other' holds the stray files", () => {
  const r = lb.browse(sample(), lb.parseQuery({ kind: "other" }));
  assert.deepEqual(r.items.map((i) => i.rel), ["A/readme.txt"]);
  assert.equal(lb.browse(sample(), lb.parseQuery({ kind: "update,dlc" })).total, 2);
});

test("search looks at name, path and title id, and the counts follow the search", () => {
  const r = lb.browse(sample(), lb.parseQuery({ q: "alpha", kind: "base" }));
  assert.deepEqual(r.items.map((i) => i.name), ["Alpha"]);
  assert.equal(r.counts.update, 1);
  assert.equal(r.counts.dlc, 0);
  assert.equal(lb.browse(sample(), lb.parseQuery({ q: "0100000000020000" })).total, 1);
  assert.equal(lb.browse(sample(), lb.parseQuery({ q: "한글", kind: "patch" })).total, 1);
});

test("sorts by size and date either way, unknown values last", () => {
  const items = [...sample(), lb.item("base", { name: "Gamma", rel: "Gamma.nsp", size: null })];
  const by = (q) => lb.browse(items, lb.parseQuery({ kind: "base", ...q })).items.map((i) => i.name);
  assert.deepEqual(by({ sort: "size" }), ["Alpha", "Beta", "Gamma"]);
  assert.deepEqual(by({ sort: "size", order: "desc" }), ["Beta", "Alpha", "Gamma"]);
  assert.deepEqual(by({ sort: "mtime", order: "desc" }), ["Beta", "Alpha", "Gamma"]);
  assert.deepEqual(by({ order: "desc" }), ["Gamma", "Beta", "Alpha"]);
});

test("pages are cut on the server; a page past the end is the last page", () => {
  const many = Array.from({ length: 120 }, (_, i) => lb.item("other", { rel: `x/f${String(i).padStart(3, "0")}.txt`, size: i }));
  const p1 = lb.browse(many, lb.parseQuery({ kind: "other" }));
  assert.equal(p1.items.length, 50);
  assert.equal(p1.pages, 3);
  const p3 = lb.browse(many, lb.parseQuery({ kind: "other", page: "3" }));
  assert.equal(p3.items.length, 20);
  assert.equal(p3.items[0].name, "f100.txt");
  assert.equal(lb.browse(many, lb.parseQuery({ kind: "other", page: "99" })).page, 3);
  assert.equal(lb.browse(many, lb.parseQuery({ kind: "other", perPage: "500" })).items.length, 120);
  assert.equal(lb.browse([], lb.parseQuery({})).pages, 1);
});

test("filters for agents: ext, size range, modified since, integrity, fields and counts only", () => {
  const q = (o) => lb.browse(sample(), lb.parseQuery(o));
  assert.deepEqual(q({ kind: "base,update,dlc", ext: "xci" }).items.map((i) => i.name), ["Beta"]);
  assert.equal(q({ kind: "base,update,dlc", ext: ".NSP,xci" }).total, 4);
  assert.deepEqual(q({ kind: "base,update,dlc", minSize: "100" }).items.map((i) => i.size), [300, 900]);
  assert.deepEqual(q({ kind: "base,update,dlc", maxSize: "50" }).items.map((i) => i.size).sort((a, b) => a - b), [10, 50]);
  assert.equal(q({ kind: "base,update,dlc", modifiedSince: "2400" }).total, 2);
  assert.equal(q({ kind: "base", modifiedSince: new Date(1500 * 1000).toISOString() }).total, 1);
  assert.deepEqual(q({ kind: "base,update,dlc", integrity: "damaged" }).items.map((i) => i.name), ["Beta"]);
  assert.equal(q({ kind: "base,update,dlc", integrity: "unchecked" }).total, 2);
  assert.equal(q({ kind: "patch", integrity: "damaged" }).total, 0);
  assert.deepEqual(q({ fields: "rel,size" }).items[0], { rel: games[0].rel, size: 300 });
  const c = q({ counts_only: "1", integrity: "modified,damaged" });
  assert.deepEqual(Object.keys(c).sort(), ["counts", "total"]);
  assert.equal(c.counts.base, 2);
  assert.equal(c.counts.patch, 0);
});

test("a wrong parameter is refused with its name", () => {
  const bad = (o) => {
    try { lb.parseQuery(o); } catch (err) { return [err.code, err.param]; }
    return null;
  };
  assert.deepEqual(bad({ kind: "movies" }), ["bad-param", "kind"]);
  assert.deepEqual(bad({ sort: "random" }), ["bad-param", "sort"]);
  assert.deepEqual(bad({ order: "up" }), ["bad-param", "order"]);
  assert.deepEqual(bad({ page: "0" }), ["bad-param", "page"]);
  assert.deepEqual(bad({ page: "1.5" }), ["bad-param", "page"]);
  assert.deepEqual(bad({ perPage: "501" }), ["bad-param", "perPage"]);
  assert.deepEqual(bad({ perPage: "-1" }), ["bad-param", "perPage"]);
  assert.deepEqual(bad({ minSize: "abc" }), ["bad-param", "minSize"]);
  assert.deepEqual(bad({ minSize: "10", maxSize: "5" }), ["bad-param", "maxSize"]);
  assert.deepEqual(bad({ modifiedSince: "yesterday" }), ["bad-param", "modifiedSince"]);
  assert.deepEqual(bad({ integrity: "fine" }), ["bad-param", "integrity"]);
  assert.deepEqual(bad({ fields: "rel,secret" }), ["bad-param", "fields"]);
  assert.deepEqual(bad({ ext: "../x" }), ["bad-param", "ext"]);
  assert.deepEqual(bad({ counts_only: "maybe" }), ["bad-param", "counts_only"]);
  assert.deepEqual(bad({ q: "x".repeat(201) }), ["bad-param", "q"]);
  assert.equal(bad({ q: "", kind: "", page: "2", perPage: "100" }), null);
});

test("paths stay relative to their folder", () => {
  assert.equal(lb.safeRel("a/b.txt"), "a/b.txt");
  assert.equal(lb.safeRel("/etc/passwd"), null);
  assert.equal(lb.safeRel("../outside.txt"), null);
  assert.equal(lb.safeRel("a/../../outside.txt"), null);
  assert.equal(lb.safeRel("C:/x"), null);
  assert.equal(lb.item("other", { rel: "/abs/file.bin", size: 1 }).rel, null);
  assert.deepEqual(lb.nestedDirs("/g", ["/g/patches", "/elsewhere", "/g"]), ["patches"]);
});

test("the stray file scan skips game files, hidden files, symlinks and nested folders, and caches a while", async () => {
  const g = path.join(root, "scan-games");
  const outside = path.join(root, "outside");
  fs.mkdirSync(path.join(g, "sub"), { recursive: true });
  fs.mkdirSync(path.join(g, "patches", "x"), { recursive: true });
  fs.mkdirSync(path.join(g, ".hidden"), { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(g, "Game [0100000000010000][v0].nsp"), "x");
  fs.writeFileSync(path.join(g, "sub", "notes.txt"), "hello");
  fs.writeFileSync(path.join(g, "sub", "archive.rar"), "rar");
  fs.writeFileSync(path.join(g, ".DS_Store"), "x");
  fs.writeFileSync(path.join(g, ".hidden", "in.txt"), "x");
  fs.writeFileSync(path.join(g, "patches", "x", "data.bin"), "x");
  fs.writeFileSync(path.join(g, "custom_entries.jsonc"), "[]");
  fs.writeFileSync(path.join(outside, "secret.txt"), "x");
  fs.symlinkSync(outside, path.join(g, "linked-dir"));
  fs.symlinkSync(path.join(outside, "secret.txt"), path.join(g, "linked.txt"));
  let clock = 0;
  const scanner = lb.createOtherScanner({ root: g, ignore: ["patches"], ttlMs: 60_000, now: () => clock });
  const rels = async () => (await scanner.list()).map((f) => f.rel).sort();
  assert.deepEqual(await rels(), ["sub/archive.rar", "sub/notes.txt"]);
  assert.equal((await scanner.list()).find((f) => f.rel === "sub/notes.txt").size, 5);
  fs.writeFileSync(path.join(g, "late.log"), "x");
  clock = 30_000;
  assert.deepEqual(await rels(), ["sub/archive.rar", "sub/notes.txt"]);
  clock = 61_000;
  assert.ok((await rels()).includes("late.log"));
  fs.writeFileSync(path.join(g, "later.log"), "x");
  scanner.invalidate();
  assert.ok((await rels()).includes("later.log"));
});

test("peek answers at once: nothing during the first walk, then the last scan even when it is stale", async () => {
  const g = path.join(root, "peek-games");
  fs.mkdirSync(g, { recursive: true });
  fs.writeFileSync(path.join(g, "a.txt"), "x");
  let clock = 0;
  const scanner = lb.createOtherScanner({ root: g, ttlMs: 60_000, now: () => clock });
  assert.equal(scanner.peek(), null);
  const first = await scanner.list();
  assert.deepEqual(scanner.peek().map((f) => f.rel), ["a.txt"]);
  fs.writeFileSync(path.join(g, "b.txt"), "x");
  scanner.invalidate();
  assert.equal(scanner.peek(), first);
  await scanner.list();
  assert.deepEqual(scanner.peek().map((f) => f.rel).sort(), ["a.txt", "b.txt"]);
});

// The route: session, JSON errors with a machine code, and every listing in one answer.
let updated = null;
const app = express();
const router = express.Router();
mountLibraryBrowseApi(router, (req, res) => (req.get("x-admin") ? true : (res.status(401).json({ error: "2fa required" }), false)), {
  sources: {
    games: async () => gameItems(),
    patches: async () => [lb.item("patch", { name: "한글패치", rel: "0100000000010000/한글패치", size: 20 })],
    saves: async () => { throw new Error("saves folder is gone"); },
    homebrew: async () => [lb.item("homebrew", { name: "Hand App", rel: "switch/handapp/handapp.nro", size: 7 })],
  },
  other: { list: async () => [{ rel: "A/readme.txt", size: 2, mtime: 10 }], invalidate: () => { updated = "invalidated"; } },
  onLibraryUpdate: (fn) => { updated = fn; },
});
app.use("/admin", router);
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
after(() => server.close());
const BASE = `http://127.0.0.1:${server.address().port}/admin/api/library/browse`;
const get = (qs = "") => fetch(BASE + qs, { headers: { "x-admin": "1" } });

test("the route needs an admin session", async () => {
  assert.equal((await fetch(BASE)).status, 401);
});

test("the route answers every kind's count, and a failing listing only leaves its own kind empty", async () => {
  const r = await get("?kind=other");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  const d = await r.json();
  assert.deepEqual(d.counts, { base: 2, update: 1, dlc: 1, patch: 1, save: 0, homebrew: 2, other: 1 });
  assert.deepEqual(d.items.map((i) => i.rel), ["A/readme.txt"]);
  assert.deepEqual(Object.keys(d).sort(), ["counts", "items", "order", "page", "pages", "perPage", "sort", "total"]);
});

test("the route refuses a wrong parameter as JSON with a stable code", async () => {
  const r = await get("?perPage=1000");
  assert.equal(r.status, 400);
  const d = await r.json();
  assert.equal(d.code, "bad-param");
  assert.equal(d.param, "perPage");
  assert.ok(d.error);
});

test("a library rebuild drops the cached stray file list", () => {
  assert.equal(typeof updated, "function");
  updated();
  assert.equal(updated, "invalidated");
});

// Deleting a stray file: only a plain, visible, non-game file inside the games folder.
test("a stray file can be deleted, but not a game file, a hidden file, a linked folder's file or a path outside", async () => {
  const { mountLibraryFilesApi } = await import("../../src/routes/admin/library-files-api.js");
  const gamesDir = process.env.COOK_GAMES_DIR;
  const outside = path.join(root, "outside-dir");
  fs.mkdirSync(path.join(gamesDir, "notes"), { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(gamesDir, "notes", "a.txt"), "x");
  fs.writeFileSync(path.join(gamesDir, "Game [0100000000010000][v0].nsp"), "x");
  fs.writeFileSync(path.join(gamesDir, ".hidden.txt"), "x");
  fs.writeFileSync(path.join(outside, "secret.txt"), "x");
  fs.symlinkSync(outside, path.join(gamesDir, "linked"));
  const api = express();
  api.use(express.json());
  const r = express.Router();
  mountLibraryFilesApi(r, () => true, { view: () => ({}) });
  api.use("/admin", r);
  const srv = api.listen(0, "127.0.0.1");
  await new Promise((ok) => srv.once("listening", ok));
  try {
    const post = (rel) => fetch(`http://127.0.0.1:${srv.address().port}/admin/api/library/other/remove`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rel }),
    });
    for (const rel of ["Game [0100000000010000][v0].nsp", ".hidden.txt", "linked/secret.txt", "../outside-dir/secret.txt", "nothing.txt", ""]) {
      assert.equal((await post(rel)).status, 404, rel);
    }
    assert.ok(fs.existsSync(path.join(outside, "secret.txt")));
    assert.ok(fs.existsSync(path.join(gamesDir, "Game [0100000000010000][v0].nsp")));
    assert.equal((await post("notes/a.txt")).status, 200);
    assert.equal(fs.existsSync(path.join(gamesDir, "notes")), false, "the folder it left empty goes too");
  } finally {
    srv.close();
  }
});
