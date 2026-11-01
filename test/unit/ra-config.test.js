import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CfgError, badPair, cfgDiff, editCfg, readCfg } from "../../src/retro/ra-config.js";
import { cfgPath, createRaConfig } from "../../src/retro/ra-config-store.js";

const SAMPLE = '# made by hand\nvideo_threaded = "true"\nuser_language = 10\n\nvideo_threaded = "true"\ncheevos_password = "hunter2"\n';

test("a config reads as RetroArch reads it, the last line of a key winning, account keys never read out", () => {
  const v = readCfg('a = "1"\nb = 2 # note\na = "3"\ncheevos_username = "me"\nnetplay_password = "x"\n');
  assert.deepEqual(Object.fromEntries(v), { a: "3", b: "2" });
});

test("an edit keeps comments and other lines, drops repeats of a set key, adds new keys at the end and removes null ones", () => {
  const out = editCfg(SAMPLE, { video_threaded: "false", fps_show: "true", user_language: null });
  assert.equal(out, '# made by hand\nvideo_threaded = "false"\n\ncheevos_password = "hunter2"\nfps_show = "true"\n');
  assert.equal(editCfg("", { a: "1" }), 'a = "1"\n');
  assert.equal(editCfg('a = "1"\n', { a: null }), "");
});

test("an edit refuses account keys, odd names and values that would break the file, and changes nothing", () => {
  assert.throws(() => editCfg(SAMPLE, { cheevos_password: "x" }), (e) => e instanceof CfgError && e.code === "secretKey");
  assert.throws(() => editCfg(SAMPLE, { "a b": "x" }), (e) => e.code === "badKey");
  assert.throws(() => editCfg(SAMPLE, { a: 'x"\nb = "y' }), (e) => e.code === "badValue");
  assert.equal(badPair("video_threaded", "false"), null);
  assert.equal(badPair("x", 3), "badValue");
});

test("a diff names each readable key that changed", () => {
  assert.deepEqual(cfgDiff('a = "1"\nb = "2"\n', 'a = "1"\nb = "3"\nc = "4"\n'), [{ key: "b", from: "2", to: "3" }, { key: "c", from: null, to: "4" }]);
});

test("only retroarch.cfg and a core folder's .cfg and .opt files can be edited", () => {
  assert.deepEqual(cfgPath("retroarch.cfg"), { core: null, game: null, kind: "cfg" });
  assert.deepEqual(cfgPath("config/ScummVM/ScummVM.cfg"), { core: "ScummVM", game: null, kind: "cfg" });
  assert.deepEqual(cfgPath("config/Mupen64Plus-Next/Zelda (J).opt"), { core: "Mupen64Plus-Next", game: "Zelda (J)", kind: "opt" });
  for (const bad of ["config/../retroarch.cfg", "config/.x/x.cfg", "config/A/.A.cfg", "cores/a.cfg", "config/A/A.nro", "config/A/B/C.cfg", "../retroarch.cfg", "config/A\\B/A.cfg"]) assert.equal(cfgPath(bad), null, bad);
});

function store() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ra-config-"));
  let t = 1000;
  const s = createRaConfig({ packDir: () => path.join(root, "pack"), historyDir: () => path.join(root, "history"), now: () => t++ });
  return { s, root, file: (rel) => path.join(root, "pack", ...rel.split("/")) };
}

test("a write lands in the pack, is kept in the history, and comes back with a restore", async () => {
  const { s, file } = store();
  const first = await s.write("config/ScummVM/ScummVM.cfg", { video_threaded: "false" }, { by: "admin" });
  assert.equal(fs.readFileSync(file("config/ScummVM/ScummVM.cfg"), "utf8"), 'video_threaded = "false"\n');
  assert.deepEqual(first.change.changes, [{ key: "video_threaded", from: null, to: "false" }]);
  assert.equal(first.change.by, "admin");
  assert.equal((await s.write("config/ScummVM/ScummVM.cfg", { video_threaded: "false" })).change, null, "the same value is no change");
  const back = await s.restore(first.change.id);
  assert.equal(back.restored.length, 1);
  assert.equal(fs.existsSync(file("config/ScummVM/ScummVM.cfg")), false, "the file it started from was not there, so it goes");
  assert.equal(fs.existsSync(path.dirname(file("config/ScummVM/ScummVM.cfg"))), false, "and the emptied core folder with it");
  const hist = await s.history({ rel: "config/ScummVM/ScummVM.cfg" });
  assert.equal(hist.length, 2);
  assert.equal(hist[0].restoreOf, first.change.id, "newest first");
});

test("a restore brings back the whole text, comments and account lines included, though the page never sees them", async () => {
  const { s, file } = store();
  fs.mkdirSync(path.dirname(file("retroarch.cfg")), { recursive: true });
  fs.writeFileSync(file("retroarch.cfg"), SAMPLE);
  assert.deepEqual((await s.read("retroarch.cfg")).values, { video_threaded: "true", user_language: "10" });
  const w = await s.write("retroarch.cfg", { video_threaded: "false" });
  assert.match(fs.readFileSync(file("retroarch.cfg"), "utf8"), /cheevos_password = "hunter2"/, "a line the page can't see stays");
  await s.restore(w.change.id);
  assert.equal(fs.readFileSync(file("retroarch.cfg"), "utf8"), SAMPLE);
  const all = JSON.stringify(await s.history());
  assert.ok(!all.includes("hunter2"), "the history the page reads never carries an account value");
});

test("a batch of writes is undone in one restore", async () => {
  const { s, file } = store();
  await s.write("config/A/A.cfg", { fps_show: "true" });
  const batch = s.newBatch();
  for (const c of ["A", "B", "C"]) await s.write(`config/${c}/${c}.cfg`, { video_threaded: "false" }, { batch });
  const out = await s.restore(batch);
  assert.equal(out.restored.length, 3);
  assert.equal(fs.readFileSync(file("config/A/A.cfg"), "utf8"), 'fps_show = "true"\n', "the earlier change outside the batch stays");
  assert.equal(fs.existsSync(file("config/B/B.cfg")), false);
  await assert.rejects(() => s.restore("nope"), (e) => e.code === "noChange");
});

test("the list shows each core's own files first, then its games, with their values", async () => {
  const { s } = store();
  await s.write("config/Mupen64Plus-Next/Zelda.opt", { "mupen64plus-cpucore": "pure_interpreter" });
  await s.write("config/Mupen64Plus-Next/Mupen64Plus-Next.cfg", { video_threaded: "false" });
  const { cores, global } = await s.list();
  assert.equal(global.exists, false);
  assert.deepEqual(cores[0].files.map((f) => [f.rel, f.game]), [["config/Mupen64Plus-Next/Mupen64Plus-Next.cfg", null], ["config/Mupen64Plus-Next/Zelda.opt", "Zelda"]]);
  assert.deepEqual(cores[0].files[1].values, { "mupen64plus-cpucore": "pure_interpreter" });
});

test("a path outside the editable files is refused before anything is read", async () => {
  const { s } = store();
  await assert.rejects(() => s.read("../secret.cfg"), (e) => e.code === "badPath");
  await assert.rejects(() => s.write("cores/x.cfg", { a: "1" }), (e) => e.code === "badPath");
});
