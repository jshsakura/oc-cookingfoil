import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { applyFill, REAL_IO } from "../../src/retro/pack-fill.js";
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
