import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";

// Every remove on the admin page sends the thing to the trash of its folder, the
// 휴지통 tab's API lists it with who and why, puts it back, and only emptying
// deletes. Moves of a patch or save are journaled and undone from there too.
const base = fs.mkdtempSync(path.join(os.tmpdir(), "trash-api-"));
const dirs = Object.fromEntries(["games", "incoming", "patches", "saves", "homebrew", "retro", "data"].map((k) => [k, path.join(base, k)]));
for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
process.env.COOK_GAMES_DIR = dirs.games;
process.env.COOK_INCOMING_DIR = dirs.incoming;
process.env.COOK_PATCHES_DIR = dirs.patches;
process.env.COOK_SAVES_DIR = dirs.saves;
process.env.COOK_HOMEBREW_DIR = dirs.homebrew;
process.env.COOK_RETRO_DIR = dirs.retro;
process.env.COOK_DATA_DIR = dirs.data;
process.env.COOK_RATING_SYNC = "false";
process.env.COOK_TITLEDB_AUTO_FETCH = "false";

const TID = "0100000000010000";
const OTHER = "0100000000020000";
const put = (root, rel, body = "x") => {
  const abs = path.join(dirs[root], rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
};
const read = (root, rel) => fs.readFileSync(path.join(dirs[root], rel), "utf8");
const has = (root, rel) => fs.existsSync(path.join(dirs[root], rel));

/** A minimal NRO whose NACP carries a name. */
function fakeNro(name) {
  const head = Buffer.alloc(0x100);
  head.write("NRO0", 0x10);
  head.writeUInt32LE(0x100, 0x18);
  const aset = Buffer.alloc(0x38);
  aset.write("ASET", 0);
  aset.writeBigUInt64LE(0x38n, 0x18);
  aset.writeBigUInt64LE(0x4000n, 0x20);
  const nacp = Buffer.alloc(0x4000);
  nacp.write(name, 0);
  nacp.write("1.0", 0x3060);
  return Buffer.concat([head, aset, nacp]);
}

const { mountTrashApi } = await import("../../src/routes/admin/trash-api.js");
const { mountLibraryFilesApi } = await import("../../src/routes/admin/library-files-api.js");
const { mountContentApi } = await import("../../src/routes/admin/content-api.js");
const { mountHomebrewAppsApi } = await import("../../src/routes/admin/homebrew-apps-api.js");
const userPatches = await import("../../src/meta/user-patches.js");
const patchInfo = await import("../../src/meta/patch-info.js");
const { savesCatalog } = await import("../../src/routes/saves.js");
const { saveId } = await import("../../src/meta/shop-saves.js");
const { refreshManual } = await import("../../src/routes/homebrew.js");
const { idFor } = await import("../../src/meta/homebrew.js");
const service = await import("../../src/library/trash-service.js");
service._setRefresh(async () => {});

const app = express();
app.use(express.json());
const router = express.Router();
// A person signed in to the admin page.
app.use((req, _res, next) => { req.webUser = { name: "boss" }; next(); });
mountTrashApi(router, () => true);
mountLibraryFilesApi(router, () => true, { view: () => ({}) });
mountContentApi(router, () => true);
mountHomebrewAppsApi(router, () => true);
app.use("/admin", router);
const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
const url = `http://127.0.0.1:${server.address().port}/admin/api`;
after(() => { server.close(); service._setRefresh(null); });

const post = async (p, body) => {
  const r = await fetch(url + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const list = async () => (await fetch(`${url}/trash`)).json();

test("a library game file: removed to the trash, listed with who and where, restored", async () => {
  put("games", `Zelda/Zelda [${TID}][v0].nsp`, "ZELDA");
  const r = await post("/library/files/remove", { rel: `Zelda/Zelda [${TID}][v0].nsp` });
  assert.equal(r.status, 200);
  assert.ok(!has("games", "Zelda"), "the file and the folder it left empty are gone from the library");
  const l = await list();
  const e = l.items.find((i) => i.id === r.body.trash);
  assert.deepEqual([e.root, e.kind, e.action, e.by, e.size, e.ageDays], ["games", "game", "library-file-remove", { type: "admin", name: "boss" }, 5, 0]);
  assert.deepEqual(e.items.map((i) => i.rel), [`Zelda/Zelda [${TID}][v0].nsp`]);
  assert.deepEqual(l.roots.games, { bytes: 5, count: 1 });
  assert.deepEqual(l.total, { bytes: 5, count: 1 });
  assert.equal(l.noticeDays, 30);
  const back = await post("/trash/restore", { ids: [e.id] });
  assert.deepEqual([back.body.restored.length, back.body.failed], [1, []]);
  assert.equal(read("games", `Zelda/Zelda [${TID}][v0].nsp`), "ZELDA");
  assert.equal((await list()).total.count, 0);
});

test("a patch: removed with its information, restored with it", async () => {
  put("patches", `${TID}/한글패치/atmosphere/contents/${TID}/romfs/a.bin`, "PATCH");
  await userPatches.scan();
  const key = patchInfo.keyOf(TID, "한글패치");
  patchInfo.set(key, { name: "한글패치", description: "번역" });
  const id = userPatches.patchId(TID, "한글패치");
  const r = await post("/content/patch/remove", { id });
  assert.equal(r.status, 200);
  assert.ok(!has("patches", `${TID}/한글패치`));
  assert.equal(patchInfo.get(key), null, "the store forgets it while it is in the trash");
  await post("/trash/restore", { ids: [r.body.trash] });
  assert.equal(read("patches", `${TID}/한글패치/atmosphere/contents/${TID}/romfs/a.bin`), "PATCH");
  assert.equal(patchInfo.get(key)?.description, "번역", "its information comes back with it");
});

test("a save: removed and restored; its move to another game is undone from the journal", async () => {
  put("saves", `${TID}/세이브/save.dat`, "SAVE");
  savesCatalog().invalidate();
  await savesCatalog().list();
  const r = await post("/content/save/remove", { id: saveId(TID, "세이브") });
  assert.equal(r.status, 200);
  assert.ok(!has("saves", `${TID}/세이브`));
  await post("/trash/restore", { ids: [r.body.trash] });
  assert.equal(read("saves", `${TID}/세이브/save.dat`), "SAVE");

  savesCatalog().invalidate();
  await savesCatalog().list();
  assert.equal((await post("/content/save/move", { id: saveId(TID, "세이브"), titleId: OTHER })).status, 200);
  assert.ok(has("saves", `${OTHER}/세이브/save.dat`));
  const { items } = await (await fetch(`${url}/trash/journal`)).json();
  const op = items.find((o) => o.action === "save-move");
  assert.deepEqual([op.from, op.to, op.undoable, op.by], [`${TID}/세이브`, `${OTHER}/세이브`, true, { type: "admin", name: "boss" }]);
  const undone = await post("/trash/undo", { id: op.id });
  assert.equal(undone.status, 200);
  assert.equal(read("saves", `${TID}/세이브/save.dat`), "SAVE");
  assert.ok(!has("saves", OTHER), "the folder the move made goes too");
  assert.equal((await post("/trash/undo", { id: op.id })).status, 409, "once only");
});

test("a patch moved to another game is undone with the paths that name the game", async () => {
  put("patches", `${TID}/이동패치/atmosphere/contents/${TID}/romfs/b.bin`, "B");
  await userPatches.scan();
  const id = userPatches.patchId(TID, "이동패치");
  assert.equal((await post("/content/patch/move", { id, titleId: OTHER })).status, 200);
  assert.ok(has("patches", `${OTHER}/이동패치/atmosphere/contents/${OTHER}/romfs/b.bin`));
  const { items } = await (await fetch(`${url}/trash/journal`)).json();
  const op = items.find((o) => o.action === "patch-move");
  assert.equal((await post("/trash/undo", { id: op.id })).status, 200);
  assert.equal(read("patches", `${TID}/이동패치/atmosphere/contents/${TID}/romfs/b.bin`), "B");
});

test("a hand-placed homebrew app: removed to the trash and restored", async () => {
  put("homebrew", "myapp/myapp.nro", fakeNro("My App"));
  await refreshManual();
  const r = await post("/homebrew/manual/remove", { id: idFor("manual", "myapp") });
  assert.equal(r.status, 200);
  assert.ok(!has("homebrew", "myapp"));
  const e = (await list()).items.find((i) => i.id === r.body.trash);
  assert.deepEqual([e.root, e.kind, e.action], ["homebrew", "homebrew", "homebrew-remove"]);
  await post("/trash/restore", { ids: [e.id] });
  assert.ok(has("homebrew", "myapp/myapp.nro"));
});

test("emptying needs the word, takes chosen entries or all, and is the only thing that deletes", async () => {
  put("games", "a.txt", "AAAA");
  put("games", "b.txt", "BB");
  const a = (await post("/library/other/remove", { rel: "a.txt" })).body.trash;
  const b = (await post("/library/other/remove", { rel: "b.txt" })).body.trash;
  assert.equal((await post("/trash/empty", { ids: [a] })).status, 400, "not without the confirmation");
  assert.equal((await post("/trash/restore", {})).status, 400);
  const one = await post("/trash/empty", { ids: [a], confirm: "empty" });
  assert.deepEqual([one.status, one.body.removed, one.body.bytes >= 4], [200, 1, true]);
  assert.deepEqual((await list()).items.map((i) => i.id), [b]);
  const all = await post("/trash/empty", { all: true, confirm: "empty" });
  assert.equal(all.body.removed, 1);
  assert.equal((await list()).total.count, 0);
  assert.equal((await post("/trash/restore", { ids: [a] })).body.failed.length, 1, "gone for good");
});
