import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { readMeta, saveId } from "../../src/meta/shop-saves.js";

const MK = "0100152000022000";
const PORT = 15400 + (process.pid % 500);
const BASE = `http://127.0.0.1:${PORT}`;
const AUTH = { Authorization: "Basic " + Buffer.from("alice:alice-password").toString("base64") };

function put(root, rel, body = "x") {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body);
}

function untar(buf) {
  const out = new Map();
  for (let off = 0; off + 512 <= buf.length; ) {
    const h = buf.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const str = (a, b) => h.subarray(a, b).toString("utf8").replace(/\0.*$/s, "");
    const name = (str(345, 500) ? str(345, 500) + "/" : "") + str(0, 100);
    const size = Number.parseInt(str(124, 136).trim() || "0", 8);
    out.set(name, buf.subarray(off + 512, off + 512 + size).toString("utf8"));
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

async function boot(savesDir) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "saves-data-"));
  fs.mkdirSync(path.join(data, "games"));
  const child = spawn(process.execPath, ["./src/index.js"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: { ...process.env, COOK_PORT: String(PORT), COOK_DATA_DIR: data, COOK_GAMES_DIR: path.join(data, "games"),
      COOK_SAVES_DIR: savesDir, COOK_AUTH_USERS: "alice:alice-password", COOK_TITLEDB_AUTO_FETCH: "false" },
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

const get = (url, headers = {}) => fetch(BASE + url, { headers: { ...AUTH, ...headers } });

test("meta.json keeps only known, capped text fields", () => {
  assert.deepEqual(readMeta({ name: " All karts ", gameVersion: 3.1, evil: "x", description: "" }), { name: "All karts", gameVersion: "3.1" });
  assert.match(saveId(MK, "All Unlocked"), /^0100152000022000-[0-9a-f]{12}$/);
});

test("the shop lists save files and sends one as a tar rooted at the save folder", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "saves-"));
  put(dir, `${MK}/All Unlocked/meta.json`, JSON.stringify({ name: "전 차종 언락", description: "모든 카트와 트랙", gameVersion: "3.0.1" }));
  put(dir, `${MK}/All Unlocked/save.dat`, "SAVE");
  put(dir, `${MK}/All Unlocked/sub/ghost.bin`, "GHOST");
  put(dir, `${MK}/Empty/.DS_Store`, "junk");
  put(dir, `0100152000022800/Not A Base/save.dat`, "x");
  fs.mkdirSync(path.join(dir, MK, "Linked"));
  fs.symlinkSync("/etc/passwd", path.join(dir, MK, "Linked", "save.dat"));
  const server = await boot(dir);
  try {
    assert.equal((await fetch(`${BASE}/api/saves`)).status, 401);
    assert.ok((await (await get("/api/shop/info")).json()).features.includes("shop-saves"));
    const res = await get("/api/saves");
    const { saves } = await res.json();
    assert.equal(saves.length, 1, "empty, non-base and symlinked saves are left out");
    const [s] = saves;
    assert.equal(s.titleId, MK);
    assert.equal(s.name, "전 차종 언락");
    assert.equal(s.gameVersion, "3.0.1");
    assert.equal(s.files, 2);
    assert.equal(s.size, 9);
    assert.match(s.hash, /^[0-9a-f]{64}$/);
    assert.equal(s.url, `/api/saves/${s.id}/download`);
    // fetch() adds Cache-Control: no-cache to conditional requests, so ask the way a console does.
    const status = await new Promise((resolve, reject) => {
      http.get(`${BASE}/api/saves`, { headers: { ...AUTH, "If-None-Match": res.headers.get("etag") } }, (r) => {
        r.resume();
        resolve(r.statusCode);
      }).on("error", reject);
    });
    assert.equal(status, 304);

    const dl = await get(s.url);
    assert.equal(dl.headers.get("etag"), `"${s.hash}"`);
    const files = untar(Buffer.from(await dl.arrayBuffer()));
    assert.equal(files.get("save.dat"), "SAVE");
    assert.equal(files.get("sub/ghost.bin"), "GHOST");
    assert.ok(files.has("sub/"));
    assert.ok(!files.has("meta.json"), "metadata never ships");
    assert.equal((await get("/api/saves/../../etc/download")).status, 404);
    assert.equal((await get(`/api/saves/${MK}-000000000000/download`)).status, 404);
  } finally {
    server.kill("SIGKILL");
  }
});

test("without a saves folder the API is off", async () => {
  const server = await boot(path.join(os.tmpdir(), "no-such-saves-" + process.pid));
  try {
    assert.equal((await get("/api/saves")).status, 404);
    assert.ok(!(await (await get("/api/shop/info")).json()).features.includes("shop-saves"));
  } finally {
    server.kill("SIGKILL");
  }
});
