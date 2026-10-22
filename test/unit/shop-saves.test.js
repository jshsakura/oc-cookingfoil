import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { localize, readMeta, readSave, saveId } from "../../src/meta/shop-saves.js";
import { openDatabase } from "../../src/db/database.js";
import { CONSOLE, seedConsole } from "../support/console.js";

const MK = "0100152000022000";
const PORT = 15400 + (process.pid % 500);
const BASE = `http://127.0.0.1:${PORT}`;
// An approved console: the shop takes its keys, never a password.
const AUTH = CONSOLE;

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
  await seedConsole(data);
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
  assert.equal(readMeta({ saveType: "device" }).saveType, "device");
  assert.equal(readMeta({ saveType: "account" }).saveType, "account");
  assert.equal(readMeta({ saveType: "bcat" }).saveType, undefined, "only the two kinds a client knows");
});

test("a save reads in Korean for ko and in English for every other language", () => {
  const meta = readMeta({
    name: "All karts", description: "Every kart and track.",
    source: { name: "GameBanana", url: "https://gamebanana.com/mods/1" },
    ko: { description: "모든 카트와 트랙을 엽니다." },
  });
  const save = { id: "x", name: "All karts", description: meta.description, source: meta.source, ko: meta.ko };
  assert.deepEqual(localize(save, "ko"), {
    id: "x", name: "All karts", source: meta.source,
    description: "모든 카트와 트랙을 엽니다.\n출처: GameBanana https://gamebanana.com/mods/1",
  });
  assert.equal(localize(save, "ja").description, "Every kart and track.\n出典: GameBanana https://gamebanana.com/mods/1", "no Japanese text: English, credited in Japanese");
  assert.equal(localize(save, "de").description.split("\n")[1], "Quelle: GameBanana https://gamebanana.com/mods/1");
  assert.equal(localize(save, "zh-Hant").description.split("\n")[1], "來源: GameBanana https://gamebanana.com/mods/1");
  assert.equal(localize(save, "en").description.split("\n")[1], "Source: GameBanana https://gamebanana.com/mods/1");
  assert.equal(localize({ ...save, ko: null }, "ko").description.split("\n")[0], "Every kart and track.", "no Korean yet: English");
  assert.deepEqual(readMeta({ source: { name: "x", url: "javascript:alert(1)" } }).source, { name: "x" }, "only web links");
});

test("the shop lists save files and sends one as a tar rooted at the save folder", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "saves-"));
  put(dir, `${MK}/All Unlocked/meta.json`, JSON.stringify({ name: "All karts", description: "Every kart and track", gameVersion: "3.0.1", saveType: "device", ko: { name: "전 차종 언락", description: "모든 카트와 트랙" } }));
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
    const res = await get("/api/saves?lang=ko");
    const { saves } = await res.json();
    assert.equal(saves.length, 1, "empty, non-base and symlinked saves are left out");
    const [s] = saves;
    assert.equal(s.titleId, MK);
    assert.equal(s.name, "전 차종 언락");
    assert.equal(s.gameVersion, "3.0.1");
    assert.equal(s.saveType, "device", "the console's shared save");
    assert.equal(s.description, "모든 카트와 트랙");
    assert.equal((await (await get("/api/saves", { "Accept-Language": "en-US" })).json()).saves[0].name, "All karts");
    assert.equal(s.files, 2);
    assert.equal(s.size, 9);
    assert.match(s.hash, /^[0-9a-f]{64}$/);
    assert.equal(s.url, `/api/saves/${s.id}/download`);
    // By game: a summary row per game, then that game's saves alone.
    assert.ok((await (await get("/api/shop/info")).json()).features.includes("saves-by-game"));
    const { games } = await (await get("/api/saves?view=games")).json();
    assert.deepEqual(games.map((g) => [g.key, g.titleId, g.count, g.size]), [[MK, MK, 1, 9]]);
    assert.equal((await (await get(`/api/saves?game=${MK}&lang=ko`)).json()).saves[0].id, s.id);
    assert.deepEqual((await (await get("/api/saves?game=0100000000990000")).json()).saves, []);
    // fetch() adds Cache-Control: no-cache to conditional requests, so ask the way a console does.
    const status = await new Promise((resolve, reject) => {
      http.get(`${BASE}/api/saves?lang=ko`, { headers: { ...AUTH, "If-None-Match": res.headers.get("etag") } }, (r) => {
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

test("an empty saves folder is not offered to consoles", async () => {
  const server = await boot(fs.mkdtempSync(path.join(os.tmpdir(), "saves-empty-")));
  try {
    const { features } = await (await get("/api/shop/info")).json();
    assert.ok(!features.includes("shop-saves"));
    assert.ok(!features.includes("user-patches"), "no patch to hand out either");
    assert.deepEqual((await (await get("/api/saves")).json()).saves, [], "the API answers, with nothing in it");
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

test("a homebrew app's save with a name the card can't create is left out; a game's save is not an SD path", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "saves-ascii-"));
  put(root, "homebrew/portgame/bad/세이브.dat");
  put(root, "homebrew/portgame/good/save1.dat");
  const cache = { hash: async () => "h" };
  await assert.rejects(readSave(root, "homebrew/portgame", "bad", cache), /can't create/);
  await assert.doesNotReject(readSave(root, "homebrew/portgame", "good", cache));
});

test("a stale listing comes back at once and is refreshed behind it; a change made here is waited for", async () => {
  const { createCatalog } = await import("../../src/meta/shop-saves.js");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cook-saves-stale-"));
  const put = (folder) => {
    fs.mkdirSync(path.join(root, "0100000000010000", folder), { recursive: true });
    fs.writeFileSync(path.join(root, "0100000000010000", folder, "save.bin"), "x");
  };
  put("one");
  const realNow = Date.now;
  try {
    const cat = createCatalog({ root, db: openDatabase(":memory:") });
    assert.equal((await cat.list()).length, 1);
    put("two");
    Date.now = () => realNow() + 7 * 60 * 60_000;
    assert.equal((await cat.list()).length, 1, "the stale listing, not a wait");
    await new Promise((r) => setTimeout(r, 50));
    assert.equal((await cat.list()).length, 2, "refreshed behind it");
    put("three");
    cat.invalidate();
    assert.equal((await cat.list()).length, 3, "a change made here is read before answering");
  } finally {
    Date.now = realNow;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the last listing is kept on disk and served at once after a restart, then rescanned behind it", async () => {
  const { createCatalog } = await import("../../src/meta/shop-saves.js");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cook-saves-kept-"));
  const db = openDatabase(path.join(root, "index.db"));
  const put = (folder) => {
    fs.mkdirSync(path.join(root, "saves", "0100000000010000", folder), { recursive: true });
    fs.writeFileSync(path.join(root, "saves", "0100000000010000", folder, "save.bin"), "x");
  };
  put("one");
  const realNow = Date.now;
  try {
    const first = createCatalog({ root: path.join(root, "saves"), db });
    assert.equal((await first.list()).length, 1);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(db.prepare("SELECT count(*) AS n FROM catalog_items WHERE catalog = 'saves'").get().n, 1, "the listing is kept");
    put("two");
    const restarted = createCatalog({ root: path.join(root, "saves"), db: openDatabase(path.join(root, "index.db")) });
    assert.equal((await restarted.list()).length, 1, "the kept listing, no scan");
    Date.now = () => realNow() + 7 * 60 * 60_000;
    await restarted.warm();
    assert.equal((await restarted.list()).length, 2, "a stale kept listing is rescanned");
  } finally {
    Date.now = realNow;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a change made while a scan runs is in the listing that follows", async () => {
  const { createCatalog } = await import("../../src/meta/shop-saves.js");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cook-saves-race-"));
  const put = (folder) => {
    fs.mkdirSync(path.join(root, "0100000000010000", folder), { recursive: true });
    fs.writeFileSync(path.join(root, "0100000000010000", folder, "save.bin"), "x");
  };
  put("one");
  const cat = createCatalog({ root, db: openDatabase(":memory:") });
  const first = cat.list();
  put("two");
  cat.invalidate();
  await first;
  assert.equal((await cat.list()).length, 2);
  await new Promise((r) => setTimeout(r, 50));
  fs.rmSync(root, { recursive: true, force: true });
});

test("one save read again by itself: added, changed and removed without a full scan", async () => {
  const { createCatalog } = await import("../../src/meta/shop-saves.js");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cook-saves-item-"));
  const put = (folder, body = "x") => {
    fs.mkdirSync(path.join(root, "0100000000010000", folder), { recursive: true });
    fs.writeFileSync(path.join(root, "0100000000010000", folder, "save.bin"), body);
  };
  put("one");
  const cat = createCatalog({ root, db: openDatabase(":memory:") });
  assert.equal((await cat.list()).length, 1);
  put("two", "xyz");
  await cat.refreshItem("0100000000010000/two");
  assert.deepEqual((await cat.list()).map((s) => [s.name, s.size]), [["one", 1], ["two", 3]]);
  put("two", "abcdef");
  await cat.refreshItem("0100000000010000/two");
  assert.equal((await cat.list()).find((s) => s.name === "two").size, 6);
  fs.rmSync(path.join(root, "0100000000010000", "one"), { recursive: true });
  await cat.refreshItem("0100000000010000/one");
  assert.deepEqual((await cat.list()).map((s) => s.name), ["two"]);
  await cat.refreshItem("not-a-title/x");
  assert.equal((await cat.list()).length, 1);
  await new Promise((r) => setTimeout(r, 50));
  fs.rmSync(root, { recursive: true, force: true });
});

test("a README.md inside a save folder is the owner's note, never sent with the save", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "saves-readme-"));
  put(root, "0100000000010000/slot/save1.dat");
  put(root, "0100000000010000/slot/README.md", "notes");
  put(root, "0100000000010000/slot/sub/readme.MD", "notes");
  const { save, entries } = await readSave(root, "0100000000010000", "slot", { hash: async () => "h" });
  assert.equal(save.files, 1);
  assert.deepEqual(entries.map((e) => e.path), ["save1.dat"]);
});
