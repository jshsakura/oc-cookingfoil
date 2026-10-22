import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { applyFill, REAL_IO, REAL_PACK } from "../../src/retro/pack-fill.js";
import { placeCore, removeCore, CoreError } from "../../src/retro/core-files.js";
import { check } from "../../src/retro/pack-watch.js";
import * as downloads from "../../src/retro/pack-downloads.js";
import { autoAddCores, autoUpdate } from "../../src/retro/pack-auto.js";
import { createStaleStore } from "../../src/retro/shortcut-stale.js";
import { bin, opts, nro, makeBundle, files, serve, GAMES, world, snapshot, tmp } from "../support/retro-pack-fixture.js";

const NES = [{ core: "fceumm", system: "nes" }];
const ON = { auto: true, download: false };
const read = (w, rel) => fs.readFileSync(path.join(w.packDir, rel));

/** A pack filled for `games` from bundle `b`, plus the server that hands the bundle out. */
async function filled(b, games = NES) {
  const srv = await serve(b.archive);
  const w = world();
  await applyFill({ ...w, games, url: srv.url, pack: b.pack, bin });
  return { srv, w };
}

test("a console that gets ROMs gets its core from the cached bundle, as the server's own file, and nothing else changes", opts, async () => {
  const b = makeBundle("1.0.0", files("a"));
  const { srv, w } = await filled(b);
  try {
    const before = snapshot(w.packDir);
    const out = await autoAddCores({ ...w, games: [...NES, { core: "mgba", system: "gba" }], settings: ON, url: srv.url, pack: b.pack, bin });
    assert.equal(out.state, "installed");
    assert.deepEqual(out.cores, ["mgba"]);
    assert.equal(srv.hits.length, 1, "the cached bundle is used, nothing is downloaded");
    const after = snapshot(w.packDir);
    assert.deepEqual(Object.keys(after).filter((k) => !(k in before)), ["cores/mgba_libretro_libnx.nro"]);
    for (const k of Object.keys(before)) assert.equal(after[k], before[k], `${k} is untouched`);
    assert.equal(w.ledger.all().get("cores/mgba_libretro_libnx.nro").source, "bundle");
  } finally { srv.close(); }
});

test("without the bundle on disk it does not download on its own and reports that a fill is needed", opts, async () => {
  const b = makeBundle("1.0.0", files("a"));
  const { srv, w } = await filled(b);
  try {
    fs.rmSync(path.join(w.dataDir, "retro-pack-cache"), { recursive: true });
    const before = snapshot(w.packDir);
    const games = [...NES, { core: "mgba", system: "gba" }];
    const out = await autoAddCores({ ...w, games, settings: ON, url: srv.url, pack: b.pack, bin });
    assert.equal(out.state, "fill-needed");
    assert.deepEqual(out.cores, ["mgba"]);
    assert.equal(srv.hits.length, 1);
    assert.deepEqual(snapshot(w.packDir), before);
    // The admin allows the download: now it fetches.
    const again = await autoAddCores({ ...w, games, settings: { auto: true, download: true }, url: srv.url, pack: b.pack, bin });
    assert.equal(again.state, "installed");
    assert.equal(srv.hits.length, 2);
    assert.ok(fs.existsSync(path.join(w.packDir, "cores/mgba_libretro_libnx.nro")));
  } finally { srv.close(); }
});

test("with the setting off nothing is added, even when the core is missing and the bundle is on disk", opts, async () => {
  const b = makeBundle("1.0.0", files("a"));
  const { srv, w } = await filled(b);
  try {
    const before = snapshot(w.packDir);
    const out = await autoAddCores({ ...w, games: GAMES, settings: { auto: false, download: true }, url: srv.url, pack: b.pack, bin });
    assert.equal(out.state, "off");
    assert.deepEqual(snapshot(w.packDir), before);
  } finally { srv.close(); }
});

test("a core the lock has not verified, or the lock does not list (stella), is never added", opts, async () => {
  const b = makeBundle("1.0.0", files("a"));
  const { srv, w } = await filled(b);
  try {
    const before = snapshot(w.packDir);
    const out = await autoAddCores({ ...w, games: [...NES, { core: "stella", system: "atari2600" }], settings: { auto: true, download: true }, url: srv.url, pack: b.pack, bin });
    assert.equal(out.state, "nothing", "stella is not in the lock");
    const unverified = { ...b.pack, lock: { ...b.pack.lock, paths: { ...b.pack.lock.paths, cores: { ...b.pack.lock.paths.cores, verified: false } } } };
    const out2 = await autoAddCores({ ...w, games: [...NES, { core: "mgba", system: "gba" }], settings: { auto: true, download: true }, url: srv.url, pack: unverified, bin });
    assert.equal(out2.state, "nothing");
    assert.deepEqual(snapshot(w.packDir), before);
    assert.equal(srv.hits.length, 1);
  } finally { srv.close(); }
});

test("a core the operator already put there is kept, and running it twice changes nothing", opts, async () => {
  const b = makeBundle("1.0.0", files("a"));
  const { srv, w } = await filled(b);
  try {
    const games = [...NES, { core: "mgba", system: "gba" }];
    fs.writeFileSync(path.join(w.packDir, "cores/mgba_libretro_libnx.nro"), nro("my mgba"));
    const first = await autoAddCores({ ...w, games, settings: ON, url: srv.url, pack: b.pack, bin });
    assert.equal(first.state, "nothing");
    assert.deepEqual(read(w, "cores/mgba_libretro_libnx.nro"), nro("my mgba"));
    assert.equal(w.ledger.all().has("cores/mgba_libretro_libnx.nro"), false);
    fs.rmSync(path.join(w.packDir, "cores/mgba_libretro_libnx.nro"));
    await autoAddCores({ ...w, games, settings: ON, url: srv.url, pack: b.pack, bin });
    const once = snapshot(w.packDir);
    const rows = JSON.stringify([...w.ledger.all()]);
    const twice = await autoAddCores({ ...w, games, settings: ON, url: srv.url, pack: b.pack, bin });
    assert.equal(twice.state, "nothing");
    assert.deepEqual(snapshot(w.packDir), once);
    assert.equal(JSON.stringify([...w.ledger.all()]), rows);
  } finally { srv.close(); }
});

test("a failure midway leaves the pack and the ledger as they were", opts, async () => {
  const b = makeBundle("1.0.0", files("a"));
  const { srv, w } = await filled(b);
  try {
    const before = snapshot(w.packDir);
    const rows = JSON.stringify([...w.ledger.all()]);
    const io = { ...REAL_IO, link: () => Promise.reject(Object.assign(new Error("disk full"), { code: "ENOSPC" })) };
    const out = await autoAddCores({ ...w, games: [...NES, { core: "mgba", system: "gba" }], settings: ON, url: srv.url, pack: b.pack, bin, io });
    assert.equal(out.state, "failed");
    assert.match(out.error, /disk full/);
    assert.deepEqual(snapshot(w.packDir), before);
    assert.equal(JSON.stringify([...w.ledger.all()]), rows);
  } finally { srv.close(); }
});

test("a new lock version updates only the server's own files that still match the ledger, and installs nothing new", opts, async () => {
  const v1 = makeBundle("1.0.0", files("a"));
  const v2 = makeBundle("2.0.0", files("b", { "retroarch/cores/newcore_libretro_libnx.nro": nro("new-b") }));
  const { srv: s1, w } = await filled(v1, [...NES, { core: "mgba", system: "gba" }]);
  const s2 = await serve(v2.archive);
  try {
    // The operator changed the mgba core and the info file, and the bundle has a core the pack never had.
    fs.writeFileSync(path.join(w.packDir, "cores/mgba_libretro_libnx.nro"), nro("my mgba"));
    fs.writeFileSync(path.join(w.packDir, "info/fceumm_libretro.info"), "display_name = \"mine\"\n");
    const base = { ...w, games: [...NES, { core: "mgba", system: "gba" }], url: s2.url, pack: v2.pack, bin };
    // No bundle for 2.0.0 and no permission to download: only reported.
    const held = await autoUpdate({ ...base, settings: ON });
    assert.equal(held.state, "update-needed");
    assert.equal(s2.hits.length, 0);
    assert.deepEqual(read(w, "retroarch.nro"), nro("body-a"));

    const out = await autoUpdate({ ...base, settings: { auto: true, download: true } });
    assert.equal(out.state, "updated");
    assert.deepEqual(read(w, "retroarch.nro"), nro("body-b"));
    assert.deepEqual(read(w, "cores/fceumm_libretro_libnx.nro"), nro("fceumm-b"));
    assert.deepEqual(read(w, "assets/ozone/a.txt"), Buffer.from("asset b\n"));
    assert.deepEqual(read(w, "cores/mgba_libretro_libnx.nro"), nro("my mgba"), "a file the operator changed stays");
    assert.match(read(w, "info/fceumm_libretro.info").toString(), /mine/);
    assert.ok(!fs.existsSync(path.join(w.packDir, "cores/newcore_libretro_libnx.nro")), "an update does not add files");
    assert.deepEqual(out.available.map((k) => k.rel).sort(), ["cores/mgba_libretro_libnx.nro", "info/fceumm_libretro.info"], "the kept ones are shown as update available");
    assert.deepEqual(fs.readFileSync(path.join(w.dataDir, "retro-pack-prev/1.0.0/retroarch.nro")), nro("body-a"));
    assert.equal(w.ledger.all().get("retroarch.nro").lockVersion, "2.0.0");

    const again = snapshot(w.packDir);
    const second = await autoUpdate({ ...base, settings: { auto: true, download: true } });
    assert.equal(second.state, "nothing");
    assert.deepEqual(snapshot(w.packDir), again);
  } finally { s1.close(); s2.close(); }
});

test("an update with the setting off, or a failure midway, changes nothing", opts, async () => {
  const v1 = makeBundle("1.0.0", files("a"));
  const v2 = makeBundle("2.0.0", files("b"));
  const { srv: s1, w } = await filled(v1);
  const s2 = await serve(v2.archive);
  try {
    const base = { ...w, games: NES, url: s2.url, pack: v2.pack, bin };
    const before = snapshot(w.packDir);
    const rows = JSON.stringify([...w.ledger.all()]);
    assert.equal((await autoUpdate({ ...base, settings: { auto: false, download: true } })).state, "off");
    let renames = 0;
    const io = { ...REAL_IO, rename: (a, c) => (++renames === 2 ? Promise.reject(new Error("disk full")) : fs.promises.rename(a, c)) };
    const out = await autoUpdate({ ...base, settings: { auto: true, download: true }, io });
    assert.equal(out.state, "failed");
    assert.deepEqual(snapshot(w.packDir), before);
    assert.equal(JSON.stringify([...w.ledger.all()]), rows);
  } finally { s1.close(); s2.close(); }
});

test("shortcuts are marked stale only when a console's core changes, and the mark clears on ack or on going back", () => {
  const file = path.join(tmp(), "stale.json");
  const store = createStaleStore(file);
  assert.deepEqual(store.observe({ nes: "fceumm", gba: "mgba" }, 100), {}, "the first look records and marks nothing");
  assert.deepEqual(store.observe({ nes: "fceumm", gba: "mgba" }, 200), {}, "no change, no mark");
  const changed = store.observe({ nes: "nestopia", gba: "mgba" }, 300);
  assert.deepEqual(changed, { nes: { from: "fceumm", to: "nestopia", at: 300 } });
  assert.deepEqual(createStaleStore(file).stale(), changed, "kept across restarts");
  assert.deepEqual(store.observe({ nes: "nestopia", gba: "mgba" }, 400), changed, "seeing it again keeps the first mark");
  assert.deepEqual(store.observe({ nes: "fceumm", gba: "mgba" }, 500), {}, "back to the core the consoles have shortcuts for");
  store.observe({ gba: "gpsp", nes: "fceumm" }, 600);
  store.ack("gba");
  assert.deepEqual(store.stale(), {});
  assert.deepEqual(store.observe({ nes: "fceumm", gba: "gpsp" }, 700), {}, "an acknowledged console is not marked again");
  assert.deepEqual(store.observe({ nes: "fceumm" }, 800), {}, "a console that has no ROMs any more is forgotten");
});

// ---- review of #102 ----

/** The watch's pass over a pack the test built: the real check(), pointed at the test's folders. */
const watch = (b, w, srv, over = {}) => check(over.games ?? NES, {}, {
  force: over.force, run: over.run, pack: b.pack,
  ledger: () => ({ forRoot: () => w.ledger }),
  ctx: { retroDir: path.dirname(w.packDir), dataDir: w.dataDir, settings: over.settings ?? ON, url: srv.url, bin },
});

test("B1: a core the operator sent to the trash is not put back by the next scan, so restoring it still works", opts, async () => {
  const b = makeBundle("1.0.0", files("a"));
  const { srv, w } = await filled(b);
  try {
    const games = [...NES, { core: "mgba", system: "gba" }];
    const retroDir = path.dirname(w.packDir);
    fs.writeFileSync(path.join(w.packDir, "cores/mgba_libretro_libnx.nro"), nro("operator mgba"));
    await removeCore(retroDir, "mgba", games, { force: true });
    assert.ok(!fs.existsSync(path.join(w.packDir, "cores/mgba_libretro_libnx.nro")));
    const last = await watch(b, w, srv, { games });
    assert.equal(last.add.state, "nothing");
    assert.ok(!fs.existsSync(path.join(w.packDir, "cores/mgba_libretro_libnx.nro")), "the slot stays empty for the restore");
    assert.equal(w.ledger.all().has("cores/mgba_libretro_libnx.nro"), false);
    assert.deepEqual(last.add.held, ["mgba"], "it is reported as held back");
  } finally { srv.close(); }
});

const rchar = () => Number(/rchar: (\d+)/.exec(fs.readFileSync("/proc/self/io", "utf8"))[1]);

test("B2: a pass with no core missing reads (hashes) none of the pack's big files", opts, async () => {
  const b = makeBundle("1.0.0", files("a"));
  const { srv, w } = await filled(b, [...NES, { core: "mgba", system: "gba" }]);
  try {
    const big = Buffer.alloc(6 * 1024 * 1024, 7);
    for (const rel of ["retroarch.nro", "cores/fceumm_libretro_libnx.nro", "cores/mgba_libretro_libnx.nro"]) fs.writeFileSync(path.join(w.packDir, rel), big);
    const before = rchar();
    const out = await autoAddCores({ ...w, games: [...NES, { core: "mgba", system: "gba" }], settings: ON, url: srv.url, pack: b.pack, bin });
    const read = rchar() - before;
    assert.equal(out.state, "nothing");
    assert.ok(read < 1024 * 1024, `read ${read} bytes`);
  } finally { srv.close(); }
});

test("F3: a lock that is older than the files in the pack does not move them back", opts, async () => {
  const v1 = makeBundle("1.0.0", files("a"));
  const v2 = makeBundle("2.0.0", files("b"));
  const { srv: s2, w } = await filled(v2);
  const s1 = await serve(v1.archive);
  try {
    const out = await autoUpdate({ ...w, games: NES, settings: { auto: true, download: true }, url: s1.url, pack: v1.pack, bin });
    assert.equal(out.state, "nothing");
    assert.deepEqual(read(w, "retroarch.nro"), nro("body-b"));
    assert.equal(s1.hits.length, 0);
  } finally { s1.close(); s2.close(); }
});

test("F7: files the update had to leave are not looked at again by the next run, and nothing is unpacked", opts, async () => {
  const v1 = makeBundle("1.0.0", files("a"));
  const v2 = makeBundle("2.0.0", files("b"));
  const { srv: s1, w } = await filled(v1);
  const s2 = await serve(v2.archive);
  try {
    fs.writeFileSync(path.join(w.packDir, "assets/ozone/a.txt"), "operator\n");
    const base = { ...w, games: NES, url: s2.url, pack: v2.pack, settings: { auto: true, download: true } };
    assert.equal((await autoUpdate({ ...base, bin })).state, "updated");
    // The unpacker is gone: a run that unpacked anything would fail.
    const again = await autoUpdate({ ...base, bin: "/nonexistent/7z" });
    assert.equal(again.state, "nothing");
    assert.equal(s2.hits.length, 1);
  } finally { s1.close(); s2.close(); }
});

test("F7: the update-needed count is the files that could be replaced, not those the operator changed", opts, async () => {
  const v1 = makeBundle("1.0.0", files("a"));
  const v2 = makeBundle("2.0.0", files("b"));
  const { srv: s1, w } = await filled(v1);
  const s2 = await serve(v2.archive);
  try {
    const before = [...w.ledger.all()].length;
    fs.writeFileSync(path.join(w.packDir, "assets/ozone/a.txt"), "operator\n");
    const out = await autoUpdate({ ...w, games: NES, url: s2.url, pack: v2.pack, bin, settings: ON });
    assert.equal(out.state, "update-needed");
    assert.equal(out.files, before - 1);
  } finally { s1.close(); s2.close(); }
});

test("F4: an update check that found the fill busy, or the setting off, is not counted as done", async () => {
  const calls = [];
  const states = ["busy", "off", "nothing"];
  const run = { autoAddCores: async () => ({ state: "nothing", cores: [] }), autoUpdate: async () => { calls.push(1); return { state: states[calls.length - 1], available: [] }; } };
  const ctx = { retroDir: tmp(), dataDir: tmp(), settings: ON };
  const opts2 = { run, ctx, ledger: () => ({ forRoot: () => ({ all: () => new Map() }) }) };
  await check([], {}, { ...opts2, fresh: true });
  await check([], {}, opts2);
  await check([], {}, opts2);
  await check([], {}, opts2);
  assert.equal(calls.length, 3, "tried again until it ran, then not again");
});

test("F1: an automatic update waits while a console is downloading the pack", async () => {
  let ran = 0;
  const run = { autoAddCores: async () => ({ state: "nothing", cores: [] }), autoUpdate: async () => { ran++; return { state: "nothing", available: [] }; } };
  const ctx = { retroDir: tmp(), dataDir: tmp(), settings: ON };
  const opts2 = { run, ctx, ledger: () => ({ forRoot: () => ({ all: () => new Map() }) }) };
  const end = downloads.begin();
  assert.equal(downloads.busy(), true);
  await check([], {}, { ...opts2, fresh: true });
  assert.equal(ran, 0);
  end();
  end();
  assert.equal(downloads.busy(), false, "ending twice does not go below zero");
  await check([], {}, opts2);
  assert.equal(ran, 1);
});

/** A fill that is stuck waiting for its download, so the module's lock is held until `release()`. */
function stuckFill() {
  const w = world();
  let release;
  let started;
  const fetching = new Promise((r) => { started = r; });
  const run = applyFill({ ...w, games: [{ core: "fceumm", system: "nes" }], pack: REAL_PACK, bin, url: "http://unused.invalid/x", fetchImpl: () => { started(); return new Promise((_, rej) => { release = () => rej(new Error("stopped by the test")); }); } });
  run.catch(() => {});
  return { fetching, release: () => release(), run };
}

test("placeCore and removeCore refuse while a fill is running", opts, async () => {
  const retroDir = tmp();
  fs.mkdirSync(path.join(retroDir, "retroarch/cores"), { recursive: true });
  fs.writeFileSync(path.join(retroDir, "retroarch/cores/mgba_libretro_libnx.nro"), nro("x"));
  const up = path.join(tmp(), "mgba_libretro_libnx.nro");
  fs.writeFileSync(up, nro("new"));
  const f = stuckFill();
  await f.fetching;
  try {
    await assert.rejects(placeCore(retroDir, { abs: up, name: "mgba_libretro_libnx.nro" }, { replace: true }), (e) => e instanceof CoreError && e.status === 409);
    await assert.rejects(removeCore(retroDir, "mgba", [], { force: true }), (e) => e instanceof CoreError && e.status === 409);
  } finally {
    f.release();
    await assert.rejects(f.run, /stopped by the test/);
  }
  assert.ok((await placeCore(retroDir, { abs: up, name: "mgba_libretro_libnx.nro" }, { replace: true })).core === "mgba", "and works again after");
});

test("a leftover .cfpart from a hard kill is removed by the next run, and nothing else is", opts, async () => {
  const b = makeBundle("1.0.0", files("a"));
  const srv = await serve(b.archive);
  const w = world();
  try {
    fs.mkdirSync(path.join(w.packDir, "cores"), { recursive: true });
    fs.mkdirSync(path.join(w.packDir, "assets"), { recursive: true });
    const mine = ["cores/mgba_libretro_libnx.nro.0123456789ab.cfpart", "assets/x.0123456789ab.cfpart"];
    const operator = ["cores/notes.cfpart", "cores/keep.txt"];
    for (const f of [...mine, ...operator]) fs.writeFileSync(path.join(w.packDir, f), "x");
    await applyFill({ ...w, games: NES, url: srv.url, pack: b.pack, bin });
    for (const f of mine) assert.ok(!fs.existsSync(path.join(w.packDir, f)), f);
    for (const f of operator) assert.ok(fs.existsSync(path.join(w.packDir, f)), f);
  } finally { srv.close(); }
});
