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
const itemVotes = await import("../../src/meta/item-votes.js");
const itemVerified = await import("../../src/meta/item-verified.js");
const hbDescriptions = await import("../../src/meta/homebrew-descriptions.js");
const hbKinds = await import("../../src/meta/homebrew-kinds.js");
const hbCores = await import("../../src/meta/homebrew-cores.js");
const hbVerified = await import("../../src/meta/homebrew-verified.js");
const hbDisabled = await import("../../src/meta/homebrew-disabled.js");
const hbMedia = await import("../../src/meta/homebrew-media.js");
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
  assert.equal((await post("/trash/empty", { all: true, confirm: "empty" })).status, 400, "everything needs the list's version");
  const seen = await list();
  const all = await post("/trash/empty", { all: true, version: seen.version, confirm: "empty" });
  assert.equal(all.body.removed, 1);
  assert.equal((await list()).total.count, 0);
  assert.equal((await post("/trash/restore", { ids: [a] })).body.failed.length, 1, "gone for good");
});

test("emptying everything empties only what the person saw: an entry that came in since refuses it", async () => {
  put("games", "seen.txt", "S");
  await post("/library/other/remove", { rel: "seen.txt" });
  const seen = await list();
  // The NSZ queue (or anyone) adds an entry while the confirmation is open.
  put("games", "late.txt", "L");
  const late = (await post("/library/other/remove", { rel: "late.txt" })).body.trash;
  const r = await post("/trash/empty", { all: true, version: seen.version, confirm: "empty" });
  assert.equal(r.status, 409);
  assert.ok((await list()).items.some((i) => i.id === late), "nothing was deleted");
  const now = await list();
  assert.equal((await post("/trash/empty", { all: true, version: now.version, confirm: "empty" })).body.removed, now.total.count);
});

test("emptying chosen entries checks every id first: one unknown id deletes nothing", async () => {
  put("games", "keep1.txt", "K");
  const a = (await post("/library/other/remove", { rel: "keep1.txt" })).body.trash;
  const r = await post("/trash/empty", { ids: [a, "games|.cookingfoil-trash|2020-01-01/game-0123456789"], confirm: "empty" });
  assert.equal(r.status, 404);
  assert.ok((await list()).items.some((i) => i.id === a), "the good one is still there");
  await post("/trash/empty", { ids: [a], confirm: "empty" });
});

test("restore with exactName leaves a taken entry in the trash", async () => {
  put("games", "exact.txt", "OLD");
  const a = (await post("/library/other/remove", { rel: "exact.txt" })).body.trash;
  put("games", "exact.txt", "NEW");
  const r = await post("/trash/restore", { ids: [a], exactName: true });
  assert.deepEqual([r.body.restored.length, r.body.failed.length], [0, 1]);
  assert.equal(read("games", "exact.txt"), "NEW");
  assert.ok((await list()).items.some((i) => i.id === a));
  assert.equal((await post("/trash/restore", { ids: [a], exactName: "yes" })).status, 400);
  await post("/trash/empty", { ids: [a], confirm: "empty" });
});

test("a removed patch keeps its 검수됨 mark and votes in the trash and gets them back on restore", async () => {
  put("patches", `${TID}/표시패치/atmosphere/contents/${TID}/romfs/c.bin`, "C");
  await userPatches.scan();
  const id = userPatches.patchId(TID, "표시패치");
  itemVerified.set("patch", id, true, 1234);
  itemVotes.vote("patch", id, "acct:alice", "up", 10);
  const r = await post("/content/patch/remove", { id });
  assert.equal(itemVerified.verifiedAt("patch", id), null, "forgotten while it is in the trash");
  assert.deepEqual(itemVotes.tally("patch", id), { up: 0, down: 0 });
  await post("/trash/restore", { ids: [r.body.trash] });
  assert.equal(itemVerified.verifiedAt("patch", id), 1234);
  assert.equal(itemVotes.mine("patch", id, "acct:alice"), "up");
});

test("a save moved to another game and undone gets its votes back", async () => {
  put("saves", `${TID}/표 세이브/save.dat`, "S");
  savesCatalog().invalidate();
  await savesCatalog().list();
  const id = saveId(TID, "표 세이브");
  itemVotes.vote("save", id, "acct:bob", "down", 10);
  assert.equal((await post("/content/save/move", { id, titleId: OTHER })).status, 200);
  const { items } = await (await fetch(`${url}/trash/journal`)).json();
  const op = items.find((o) => o.action === "save-move" && o.from === `${TID}/표 세이브`);
  assert.equal((await post("/trash/undo", { id: op.id })).status, 200);
  assert.equal(itemVotes.mine("save", id, "acct:bob"), "down");
});

test("a hand-placed homebrew app keeps its pictures, description, choices and marks through the trash", async () => {
  put("homebrew", "artapp/artapp.nro", fakeNro("Art App"));
  await refreshManual();
  const id = idFor("manual", "artapp");
  hbDescriptions.set(id, { en: "Mine", ko: "내 설명" });
  hbKinds.set(id, "port");
  hbCores.set(id, 4);
  hbVerified.set(id, true, 777);
  hbDisabled.setEnabled(id, false);
  itemVotes.vote("homebrew", id, "acct:carol", "up", 10);
  fs.mkdirSync(path.join(dirs.data, "homebrew"), { recursive: true });
  fs.writeFileSync(path.join(dirs.data, "homebrew", "media.json"), JSON.stringify({ [id]: { banner: { source: "upload", at: 5 } } }));
  hbMedia.resetForTests();
  fs.mkdirSync(hbMedia.ownDir(id), { recursive: true });
  fs.writeFileSync(path.join(hbMedia.ownDir(id), "banner.orig.webp"), "ORIGINAL");
  const r = await post("/homebrew/manual/remove", { id });
  assert.equal(r.status, 200);
  assert.equal(hbDescriptions.get(id), null, "forgotten while it is in the trash");
  assert.ok(!fs.existsSync(path.join(hbMedia.ownDir(id), "banner.orig.webp")));
  // Something else took its folder name meanwhile: it comes back as "artapp (2)" with its own id.
  put("homebrew", "artapp/artapp.nro", fakeNro("Other"));
  await post("/trash/restore", { ids: [r.body.trash] });
  const back = idFor("manual", "artapp (2)");
  assert.deepEqual(hbDescriptions.get(back), { en: "Mine", ko: "내 설명" });
  assert.deepEqual([hbKinds.kindOf(back), hbCores.coresOf(back), hbVerified.verifiedAt(back), hbDisabled.isDisabled(back)], ["port", 4, 777, true]);
  assert.equal(itemVotes.mine("homebrew", back, "acct:carol"), "up");
  assert.deepEqual(hbMedia.record(back).banner, { source: "upload", at: 5 });
  assert.equal(fs.readFileSync(path.join(hbMedia.ownDir(back), "banner.orig.webp"), "utf8"), "ORIGINAL");
  assert.equal(hbDescriptions.get(id), null, "the app now under the old name starts clean");
  assert.equal((await list()).items.some((i) => i.id === r.body.trash), false);
  fs.rmSync(path.join(dirs.homebrew, "artapp"), { recursive: true });
  fs.rmSync(path.join(dirs.homebrew, "artapp (2)"), { recursive: true });
});

test("the list says which trash folders are on a disk that is not there", async () => {
  fs.writeFileSync(path.join(dirs.games, ".cookingfoil-trash", "homes.json"), JSON.stringify(["usb/.cookingfoil-trash"]));
  const l = await list();
  assert.deepEqual(l.unavailable, [{ root: "games", home: "usb/.cookingfoil-trash" }]);
  fs.writeFileSync(path.join(dirs.games, ".cookingfoil-trash", "homes.json"), "[]");
});
