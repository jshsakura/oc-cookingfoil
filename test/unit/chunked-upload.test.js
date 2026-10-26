import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CONSOLE, seedConsole } from "../support/console.js";
import { adminSession } from "../support/web-session.js";

const PORT = 17000 + (process.pid % 500);
const BASE = `http://127.0.0.1:${PORT}`;
const API = `${BASE}/admin/api/upload`;
// A cap far below the file sizes used here: the chunked path must not apply it.
const OLD_CAP = 1024;

async function boot(dirs) {
  await seedConsole(dirs.data);
  const child = spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: {
      ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: dirs.data, COOK_GAMES_DIR: dirs.games,
      COOK_PATCHES_DIR: dirs.patches, COOK_SAVES_DIR: dirs.saves, COOK_RETRO_DIR: dirs.retro, COOK_UPLOAD_MAX_BYTES: String(OLD_CAP),
      COOK_AUTH_USERS: "alice:alice-password", COOK_ADMIN_PASSWORD: "admin-password-123", COOK_TITLEDB_AUTO_FETCH: "false",
    },
    stdio: "ignore",
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) return child;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill("SIGKILL");
  throw new Error("server did not start");
}

test("chunked uploads: pieces, resume, space, names, access, one place for every upload", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cf-chunk-"));
  const dirs = Object.fromEntries(["data", "games", "patches", "saves", "retro"].map((d) => [d, path.join(root, d)]));
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  const server = await boot(dirs);
  try {
    const admin = await adminSession(BASE, "alice", "alice-password", "admin-password-123");
    const json = (method, url, body, headers = admin) => fetch(url, { method, headers: { ...headers, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const create = (kind, file, headers) => json("POST", `${API}/${kind}/chunks`, file, headers);
    const put = (kind, id, offset, data) => fetch(`${API}/chunks/${id}?kind=${kind}&offset=${offset}`, { method: "PUT", headers: { ...admin, "Content-Type": "application/octet-stream" }, body: data });
    const finish = (kind, ids, extra = {}) => json("POST", `${API}/${kind}/finish`, { ids, ...extra });
    const file = (name, size) => ({ name, size, lastModified: 1_700_000_000_000 });

    // A file bigger than the old cap, in several pieces, ends identical and answers as the multipart route does.
    const NAME = "Chunked Game [0100000000010000][v0].nsp";
    const data = Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 251));
    let r = await create("game", file(NAME, data.length));
    assert.equal(r.status, 200);
    const { id, offset } = await r.json();
    assert.equal(offset, 0);
    assert.match(id, /^[0-9a-f]{32}$/);
    let off = 0;
    for (const size of [1500, 1500, 2000]) {
      r = await put("game", id, off, data.subarray(off, off + size));
      assert.equal(r.status, 200);
      off = (await r.json()).offset;
    }
    assert.equal(off, data.length);
    r = await finish("game", [id]);
    assert.equal(r.status, 201, await r.clone().text());
    assert.deepEqual(await r.json(), { ok: true, kind: "game", where: NAME, files: 1 });
    assert.ok(fs.readFileSync(path.join(dirs.games, NAME)).equals(data), "the same bytes as were sent");
    assert.deepEqual(fs.readdirSync(path.join(dirs.data, "uploads", "chunks")), [], "nothing left behind");

    // The same name again is refused with its reason, as by the multipart route.
    const again = (await (await create("game", file(NAME, 3))).json()).id;
    await put("game", again, 0, Buffer.from("abc"));
    r = await finish("game", [again]);
    assert.equal(r.status, 409);
    assert.equal((await r.json()).code, "upload.exists");

    // A wrong offset answers 409 with the real one, and the upload goes on from there.
    const N2 = "Resumed [0100000000010001][v0].nsp";
    const d2 = Buffer.from("0123456789".repeat(100));
    const id2 = (await (await create("game", file(N2, d2.length))).json()).id;
    assert.equal((await put("game", id2, 0, d2.subarray(0, 400))).status, 200);
    r = await put("game", id2, 0, d2.subarray(0, 400));
    assert.equal(r.status, 409);
    const wrong = await r.json();
    assert.equal(wrong.offset, 400);
    assert.equal(wrong.code, "upload.badOffset");
    // A new session for the same file (a page reload) finds the same id and the same offset.
    r = await (await create("game", file(N2, d2.length))).json();
    assert.deepEqual([r.id, r.offset], [id2, 400]);
    assert.equal((await fetch(`${API}/chunks/${id2}?kind=game`, { headers: admin })).status, 200);
    assert.equal((await finish("game", [id2])).status, 409, "short of its size: not placed");
    assert.equal((await put("game", id2, 400, d2.subarray(400))).status, 200);
    assert.equal((await finish("game", [id2])).status, 201);
    assert.ok(fs.readFileSync(path.join(dirs.games, N2)).equals(d2));
    assert.equal((await put("game", id2, 0, Buffer.from("x"))).status, 404, "consumed by the finish");

    // More than the size, or too long a piece, is refused; cancelling drops the partial.
    const id3 = (await (await create("game", file("Cancel [0100000000010002][v0].nsp", 10))).json()).id;
    assert.equal((await put("game", id3, 0, Buffer.alloc(11))).status, 400);
    assert.equal((await json("DELETE", `${API}/chunks/${id3}?kind=game`)).status, 200);
    assert.equal((await fetch(`${API}/chunks/${id3}?kind=game`, { headers: admin })).status, 404);

    // The disk must have room; there is no other size limit.
    r = await create("game", file("Huge [0100000000010003][v0].nsp", 2 ** 50));
    assert.equal(r.status, 507);
    assert.equal((await r.json()).code, "upload.noSpace");

    // Names that could leave the folder, and files that are not packages, are refused.
    for (const name of ["", "a/b.nsp", "..", "x\u0000.nsp"]) assert.equal((await create("game", file(name, 1))).status, 400, JSON.stringify(name));
    const evil = (await (await create("game", file("evil.exe", 1))).json()).id;
    await put("game", evil, 0, Buffer.from("x"));
    r = await finish("game", [evil]);
    assert.equal(r.status, 400);
    assert.equal((await create("nope", file("a", 1))).status, 404);
    assert.equal((await finish("game", ["../../etc/passwd"])).status, 404);

    // Several files and a folder path go in as one unit, as the multipart route takes them.
    const sa = (await (await create("save", file("a.dat", 1))).json()).id;
    const sb = (await (await create("save", file("b.dat", 1))).json()).id;
    await put("save", sa, 0, Buffer.from("A"));
    await put("save", sb, 0, Buffer.from("B"));
    r = await finish("save", [sa, sb], { paths: ["Folder/a.dat", "Folder/sub/b.dat"], fields: { titleId: "0100152000022000", name: "Chunked save" } });
    assert.equal(r.status, 201, await r.clone().text());
    const placed = path.join(dirs.saves, "0100152000022000", "Chunked save");
    assert.equal(fs.readFileSync(path.join(placed, "a.dat"), "utf8"), "A");
    assert.equal(fs.readFileSync(path.join(placed, "sub", "b.dat"), "utf8"), "B");

    // A route that reads one file as its body takes it from X-Chunk-Id: a keys file that is not one is refused for its content.
    const kid = (await (await create("file", file("prod.keys", 5))).json()).id;
    await fetch(`${API}/chunks/${kid}?kind=file&offset=0`, { method: "PUT", headers: { ...admin, "Content-Type": "application/octet-stream" }, body: "hello" });
    r = await fetch(`${BASE}/admin/api/keys`, { method: "PUT", headers: { ...admin, "X-Chunk-Id": kid } });
    assert.equal(r.status, 400);
    assert.equal((await r.json()).reason, "format");
    assert.equal((await fetch(`${BASE}/admin/api/keys`, { method: "PUT", headers: { ...admin, "X-Chunk-Id": kid } })).status, 404, "taken once: the id is gone");

    // Not an admin: a console, or nobody.
    r = await json("POST", `${API}/game/chunks`, file(NAME, 1), CONSOLE);
    assert.equal(r.status, 403);
    r = await fetch(`${API}/chunks/${id}?kind=game`, { headers: CONSOLE });
    assert.equal(r.status, 403);
    r = await fetch(`${API}/game/chunks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.ok([401, 403].includes(r.status));
    // Another site's page is refused before anything is written.
    r = await json("POST", `${API}/game/chunks`, file(NAME, 1), { ...admin, Origin: "https://evil.example" });
    assert.equal(r.status, 403);
  } finally {
    server.kill("SIGKILL");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("stale partials are swept after a day and fresh ones stay", async () => {
  const { begin, offsetOf, sweep } = await import("../../src/meta/upload-chunks.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cf-sweep-"));
  try {
    const mk = async (name) => begin(dir, { account: "admin:a", kind: "game", name, size: 1, lastModified: 1 });
    const old = await mk("old.nsp");
    const fresh = await mk("fresh.nsp");
    const past = new Date(Date.now() - 25 * 3600_000);
    for (const ext of ["part", "json"]) fs.utimesSync(path.join(dir, `${old.id}.${ext}`), past, past);
    await sweep(dir);
    assert.equal(await offsetOf(dir, old.id), null);
    assert.equal((await offsetOf(dir, fresh.id)).offset, 0);
    assert.deepEqual(fs.readdirSync(dir).sort(), [`${fresh.id}.json`, `${fresh.id}.part`]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
