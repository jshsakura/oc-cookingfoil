import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Nothing in a trash folder is ever listed, queued or copied: every scanner
// over a library folder leaves <root>/.cookingfoil-trash out, and so a trash
// folder on another disk below the root (<root>/<folder>/.cookingfoil-trash).
const base = fs.mkdtempSync(path.join(os.tmpdir(), "trash-scanners-"));
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

const T = ".cookingfoil-trash/2026-10-22/game-0123456789";
const put = (root, rel, body = "x") => {
  const abs = path.join(dirs[root], rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
};
const TID = "0100000000010000";

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

test("the games list (shop scan) leaves the trash out, at the root and on a disk below it", async () => {
  put("games", `Kept [${TID}][v0].nsp`);
  put("games", `${T}/Gone [0100000000020000][v0].nsp`);
  put("games", `Mounted/.cookingfoil-trash/2026-10-22/game-0123456789/Mounted/Far [0100000000030000][v0].nsp`);
  const { scanLibrary } = await import("../../src/create-index-content.js");
  const { filesMap } = await scanLibrary();
  assert.deepEqual([...filesMap.keys()], [`Kept [${TID}][v0].nsp`]);
});

test("the other-files list and the drop box sweep leave the trash out", async () => {
  put("games", "notes.txt");
  put("games", `${T}/old-notes.txt`);
  const { createOtherScanner } = await import("../../src/meta/library-browse.js");
  assert.deepEqual((await createOtherScanner({ root: dirs.games }).list()).map((f) => f.rel), ["notes.txt"]);
  put("incoming", "new.nsp");
  put("incoming", `${T}/back.nsp`);
  const { listFiles } = await import("../../src/meta/library-organize.js");
  assert.deepEqual((await listFiles(dirs.incoming)).map((f) => f.rel), ["new.nsp"]);
});

test("the NSZ queue never queues a file from the trash", async () => {
  const { createNszQueue } = await import("../../src/meta/nsz-queue.js");
  const q = createNszQueue({
    gamesDir: dirs.games, stateFile: path.join(base, "nsz.json"), lowPriority: false, freeBytes: async () => 1e15,
    settings: () => ({ enabled: false, autoQueue: false, level: 18, threads: 1, workers: 1, minSizeMb: 0, diskFloorGb: 0, keepHours: 0, keepGb: 0, block: false, xci: false }),
  });
  await q.init();
  await q.scan();
  assert.deepEqual(q.view({ limit: 100 }).items.map((i) => i.rel), [`Kept [${TID}][v0].nsp`]);
  await q.shutdown();
});

test("the retro catalog leaves the trash out", async () => {
  put("retro", "roms/ps1/Kept.chd");
  put("retro", `${T}/roms/ps1/Gone.chd`);
  put("retro", "roms/ps1/.cookingfoil-trash/2026-10-22/retro-game-0123456789/roms/ps1/Far.chd");
  const catalog = await import("../../src/retro/catalog.js");
  assert.deepEqual((await catalog.scanDir(dirs.retro)).games.map((g) => g.name), ["Kept"]);
});

test("patches and saves leave the trash out, as a game's folder and inside a patch", async () => {
  put("patches", `${TID}/한글패치/atmosphere/contents/${TID}/romfs/a.bin`);
  put("patches", `${TID}/한글패치/.cookingfoil-trash/2026-10-22/patch-0123456789/${TID}/한글패치/old.bin`);
  put("patches", `${TID}/.cookingfoil-trash/2026-10-22/patch-0123456789/${TID}/옛패치/atmosphere/contents/${TID}/romfs/b.bin`);
  put("patches", `${T}/${TID}/지운패치/atmosphere/contents/${TID}/romfs/c.bin`);
  const patches = await import("../../src/meta/user-patches.js");
  const found = await patches.scanDir(dirs.patches, { wait: false });
  assert.deepEqual(found.map((p) => p.folder), ["한글패치"]);
  assert.equal(found[0].files, 1, "only the patch's own file");

  put("saves", `${TID}/세이브/save.dat`);
  put("saves", `${TID}/.cookingfoil-trash/2026-10-22/save-0123456789/${TID}/옛세이브/save.dat`);
  put("saves", `${T}/${TID}/지운세이브/save.dat`);
  const saves = await import("../../src/meta/shop-saves.js");
  assert.deepEqual((await saves.scanDir(dirs.saves, { hash: async (f) => `${f.path}:${f.size}`, save() {} })).map((s) => s.folder ?? s.name), ["세이브"]);
});

test("the homebrew list leaves the trash out, and a trash inside an app folder does not change the app", async () => {
  put("homebrew", "app/app.nro", fakeNro("App"));
  put("homebrew", "app/data.bin", "one");
  put("homebrew", "app/.cookingfoil.json", JSON.stringify({ nro: "app.nro", mode: "folder", reason: "x", rules: [], excluded: [] }));
  put("homebrew", `${T}/gone/gone.nro`, fakeNro("Gone"));
  const { scanManual } = await import("../../src/meta/homebrew.js");
  const [before, ...rest] = await scanManual(dirs.homebrew);
  assert.deepEqual([before.name, rest.length], ["App", 0]);
  put("homebrew", "app/.cookingfoil-trash/2026-10-22/homebrew-0123456789/app/old.bin", "old");
  const [after] = await scanManual(dirs.homebrew);
  assert.equal(after.hash, before.hash, "the trash below the app is not part of it");
});

test("a backup copies only the data folder's own files, never a trash folder", async () => {
  put("data", "metadata/games/0100000000010000/.cookingfoil-trash/x.webp");
  put("data", "metadata/games/0100000000010000/info.json", "{}");
  const backup = await import("../../src/db/backup.js");
  backup.backupNow();
  const all = fs.readdirSync(path.join(dirs.data, backup.BACKUP_DIR), { recursive: true }).map(String);
  assert.ok(all.some((p) => p.endsWith(path.join("0100000000010000", "info.json"))), "the backup ran");
  assert.ok(!all.some((p) => p.includes(".cookingfoil-trash")));
});

test("a move's work folder, or one a stop left behind, is never listed as a patch or save", async () => {
  const OTHER = "0100000000020000";
  put("patches", `${OTHER}/.moving-0a1b2c3d/한글패치/atmosphere/contents/${OTHER}/romfs/a.bin`);
  put("saves", `${OTHER}/.moving-0a1b2c3d/세이브/save.dat`);
  const patches = await import("../../src/meta/user-patches.js");
  assert.ok(!(await patches.scanDir(dirs.patches, { wait: false })).some((p) => p.folder.startsWith(".")));
  const saves = await import("../../src/meta/shop-saves.js");
  assert.ok(!(await saves.scanDir(dirs.saves, { hash: async (f) => `${f.path}:${f.size}`, save() {} })).some((s) => String(s.folder ?? s.name).startsWith(".")));
});

test("the games list leaves out the NSZ keep folder and a copy a stop cut short", async () => {
  put("games", `.cookingfoil-nsz-keep/lost-id/Lost [0100000000040000][v0].nsp`);
  put("games", `Dir/.cookingfoil-partial-0123456789-Half [0100000000050000][v0].nsp`);
  const { scanLibrary } = await import("../../src/create-index-content.js");
  const keys = [...(await scanLibrary()).filesMap.keys()];
  assert.ok(!keys.some((k) => k.includes("Lost") || k.includes("Half")), keys.join(", "));
});

test("the folder watcher ignores the trash, a trash on a disk below the root, and partial copies", async () => {
  const { ignoredUnder } = await import("../../src/meta/shop-cache.js");
  const r = dirs.games;
  for (const rel of [".cookingfoil-trash", ".cookingfoil-trash/2026-10-22/game-0123456789/x.nsp", "M/.cookingfoil-trash", "M/.cookingfoil-trash/2026-10-22/game-0123456789/M/a.nsp", "M/.cookingfoil-partial-0123456789-a.nsp", ".cookingfoil-nsz-keep/id/a.nsp"]) {
    assert.equal(ignoredUnder(r, path.join(r, rel)), true, rel);
  }
  assert.equal(ignoredUnder(r, path.join(r, "M/a.nsp")), false);
  assert.equal(ignoredUnder(r, r), false, "the root itself is watched");
  assert.equal(ignoredUnder(r, path.join(base, "data", "custom_entries.json")), false, "a watched file outside the root is judged by its own name");
});

test("a real watcher sees nothing of a move into the trash below a folder or a write inside it", async () => {
  const chokidar = (await import("chokidar")).default;
  const { ignoredUnder } = await import("../../src/meta/shop-cache.js");
  const root = fs.mkdtempSync(path.join(base, "watch-"));
  fs.mkdirSync(path.join(root, "M"));
  fs.writeFileSync(path.join(root, "M/a.nsp"), "x");
  const w = chokidar.watch(root, { ignoreInitial: true, ignored: (p) => ignoredUnder(root, p) });
  const events = [];
  w.on("all", (e, p) => events.push(`${e} ${path.relative(root, p)}`));
  await new Promise((r) => w.once("ready", r));
  const t = path.join(root, "M/.cookingfoil-trash/2026-10-22/game-0123456789/M");
  fs.mkdirSync(t, { recursive: true });
  fs.renameSync(path.join(root, "M/a.nsp"), path.join(t, "a.nsp"));
  await new Promise((r) => setTimeout(r, 300));
  fs.writeFileSync(path.join(t, "b.nsp"), "y");
  await new Promise((r) => setTimeout(r, 800));
  await w.close();
  assert.deepEqual(events.filter((e) => e.includes(".cookingfoil")), [], events.join(", "));
  assert.ok(events.includes(`unlink ${path.join("M", "a.nsp")}`), "the file leaving the folder is seen");
});

test("a title's extras leave out the trash and partial copies in its folder", async () => {
  const TID2 = "0100000000060000";
  put("games", `Extra/Extra [${TID2}][v0].nsp`);
  put("games", "Extra/readme.txt", "hi");
  put("games", "Extra/.cookingfoil-trash/2026-10-22/file-0123456789/Extra/old.zip");
  put("games", "Extra/.cookingfoil-partial-0123456789-mod.zip");
  const shopCache = await import("../../src/meta/shop-cache.js");
  shopCache.invalidate({ rescan: true });
  const { default: extrasRoute } = await import("../../src/routes/extras.js");
  let body = null;
  const res = { status() { return this; }, type() { return this; }, set() { return this; }, json(v) { body = v; return this; }, send(t) { body = JSON.parse(t); return this; } };
  await extrasRoute({ params: { baseTitleId: TID2 }, query: {}, headers: {}, get: () => undefined, protocol: "http" }, res);
  assert.deepEqual(body.extras.map((x) => x.name), ["readme.txt"], JSON.stringify(body));
});
