import { mock, test } from "node:test";
import fsp from "fs/promises";
import assert from "node:assert/strict";
import crypto from "crypto";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import zlib from "zlib";
import { spawn, spawnSync } from "child_process";
import { Readable } from "stream";
import { openDatabase, SECURITY_MIGRATIONS } from "../../src/db/database.js";
import { hashStore } from "../../src/db/stores.js";
import { packLedger } from "../../src/db/security-stores.js";
import { HashCache } from "../../src/helpers/hash-cache.js";
import { sevenZipBin, sha256File } from "../../src/retro/pack-bundle.js";
import { claimFill, fillBusy } from "../../src/retro/pack-fill.js";
import { coreStates, createAutoCores, restoreCore, STATE_FILE } from "../../src/retro/auto-cores.js";
import { forgetIndex, parseIndex } from "../../src/retro/nightly-cores.js";
import { coreFiles, listPack, manifestView } from "../../src/retro/base-pack.js";
import { forwarderSpec } from "../../src/retro/forwarder.js";
import { listTrash, restoreEntry } from "../../src/retro/trash.js";
import { toTrash } from "../../src/retro/core-files.js";

const bin = sevenZipBin();
const opts = { skip: bin ? false : "7-Zip is not installed (COOK_7Z_BIN, 7z, 7zz or 7za)" };
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const crc = (buf) => (zlib.crc32(buf) >>> 0).toString(16).padStart(8, "0");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "retro-auto-cores-"));
/** An NRO-looking file: "NRO0" at 0x10, then `tag` so each build differs. */
const nro = (tag) => Buffer.concat([Buffer.alloc(0x10), Buffer.from("NRO0"), Buffer.from(tag)]);
const GIB = 1024 ** 3;

/**
 * A nightly buildbot on 127.0.0.1: `builds` maps core → bytes, served as <core>_libretro_libnx.nro.zip with
 * an .index-extended. `crcOf(core)` may lie about a CRC. `hits` lists the paths asked for.
 */
async function buildbot(builds, { crcOf = (core, data) => crc(data), date = "2026-10-21" } = {}) {
  const dir = tmp();
  const state = { builds: { ...builds }, date, crcOf };
  const zipOf = (core) => {
    const src = path.join(dir, `src-${core}-${sha(state.builds[core]).slice(0, 8)}`);
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, `${core}_libretro_libnx.nro`), state.builds[core]);
    const zip = path.join(src, "x.zip");
    if (!fs.existsSync(zip)) assert.equal(spawnSync(bin, ["a", "-tzip", "-bd", "-y", zip, `${core}_libretro_libnx.nro`], { cwd: src, stdio: "ignore" }).status, 0);
    return fs.readFileSync(zip);
  };
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    if (req.url === "/latest/.index-extended") {
      res.end(Object.entries(state.builds).map(([core, data]) => `${state.date} ${state.crcOf(core, data)} ${core}_libretro_libnx.nro.zip`).join("\n") + "\n");
      return;
    }
    if (req.url === "/elsewhere") {
      res.writeHead(302, { Location: "http://example.invalid/x.zip" });
      res.end();
      return;
    }
    const m = req.url.match(/^\/latest\/([a-z0-9_]+)_libretro_libnx\.nro\.zip$/);
    if (!m || !state.builds[m[1]]) {
      res.writeHead(404);
      res.end();
      return;
    }
    const data = zipOf(m[1]);
    res.writeHead(200, { "Content-Length": data.length });
    res.end(data);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${server.address().port}/latest/`, hits, state, zips: () => hits.filter((h) => h.endsWith(".zip")), close: () => server.close() };
}

function world({ free = 100 * GIB, enabled = true, hashCache = null } = {}) {
  const retroDir = tmp();
  const dataDir = tmp();
  const packDir = path.join(retroDir, "retroarch");
  fs.mkdirSync(path.join(packDir, "cores"), { recursive: true });
  const store = packLedger({ db: openDatabase(":memory:", { migrations: SECURITY_MIGRATIONS }) });
  let clock = Date.parse("2026-10-22T00:00:00Z");
  const w = {
    retroDir, dataDir, packDir, store, ledger: () => store.forRoot(fs.realpathSync(packDir)),
    free, enabled, clock: () => clock, advance: (ms) => { clock += ms; },
    core: (core) => path.join(packDir, "cores", `${core}_libretro_libnx.nro`),
    make(base, extra = {}) {
      forgetIndex();
      return createAutoCores({ packDir: () => packDir, retroDir, dataDir, ledger: () => store, enabled: () => w.enabled, base: () => base, freeBytes: async () => w.free, hashCache, bin, now: () => clock, ...extra });
    },
  };
  return w;
}

/** What is left in the data dir's staging folder (gone entirely is nothing left). */
const stagingLeft = (w) => {
  const dir = path.join(w.dataDir, "retro-core-staging");
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
};

const SYSTEMS = { nes: { core: "fceumm" }, gba: { core: "mgba" }, snes: { core: "snes9x" } };
const catalogOf = (...systems) => ({ systems: SYSTEMS, games: systems.map((system, i) => ({ id: `g${i}`, system, core: SYSTEMS[system].core })) });
const BUILDS = { fceumm: nro("fceumm-a"), mgba: nro("mgba-a"), snes9x: nro("snes9x-a") };

test("the nightly index is read line by line: date, CRC-32, file", () => {
  const index = parseIndex("2026-10-21 350811DC snes9x_libretro_libnx.nro.zip\nnoise\n2021-01-02 0000000a mesens_libretro_libnx.nro.zip\n");
  assert.deepEqual([...index.keys()], ["snes9x", "mesens"]);
  assert.deepEqual(index.get("snes9x"), { date: "2026-10-21", crc32: "350811dc", file: "snes9x_libretro_libnx.nro.zip" });
});

test("a console that gets games gets its core, in one job, and only the cores of consoles with games", opts, async () => {
  const bot = await buildbot(BUILDS);
  try {
    const w = world();
    const auto = w.make(bot.base);
    const r = await auto.check(catalogOf("nes", "nes", "snes"));
    assert.equal(r.started, true);
    assert.deepEqual(r.cores, ["fceumm", "snes9x"]);
    const out = await r.done;
    assert.deepEqual(out.installed, ["fceumm", "snes9x"]);
    assert.deepEqual(fs.readFileSync(w.core("fceumm")), BUILDS.fceumm);
    assert.equal(fs.existsSync(w.core("mgba")), false, "gba has no games: its core is not fetched");
    assert.deepEqual(bot.zips().sort(), ["/latest/fceumm_libretro_libnx.nro.zip", "/latest/snes9x_libretro_libnx.nro.zip"]);
    assert.equal(bot.hits.filter((h) => h.endsWith(".index-extended")).length, 1, "one index for the job");
    const row = w.ledger().all().get("cores/fceumm_libretro_libnx.nro");
    assert.deepEqual(row, { sha256: sha(BUILDS.fceumm), source: "nightly", lockVersion: "nightly", crc32: crc(BUILDS.fceumm), built: "2026-10-21" });
    assert.deepEqual(stagingLeft(w), [], "no staging left");
  } finally { bot.close(); }
});

test("scans while a job runs make one more check, and a scan after it changes nothing", opts, async () => {
  const bot = await buildbot(BUILDS);
  try {
    const w = world();
    const auto = w.make(bot.base);
    const first = await auto.check(catalogOf("nes"));
    const during = await auto.check(catalogOf("nes", "gba"));
    assert.equal(during.reason, "busy");
    await first.done;
    // The follow-up check runs once the job ends and fetches mgba in its own single job.
    for (let i = 0; i < 200 && (!fs.existsSync(w.core("mgba")) || auto.status().job); i++) await new Promise((r) => setTimeout(r, 10));
    assert.ok(fs.existsSync(w.core("mgba")));
    assert.equal(auto.status().job, null);
    const zips = bot.zips().length;
    const again = await auto.check(catalogOf("nes", "gba"));
    assert.equal(again.reason, "nothing");
    assert.equal(bot.zips().length, zips, "idempotent: nothing downloaded again");
  } finally { bot.close(); }
});

test("a CRC-32 that is not the index's is refused: nothing placed, failed with backoff, retried after it or by force", opts, async () => {
  const bot = await buildbot(BUILDS, { crcOf: (core, data) => (core === "fceumm" ? "deadbeef" : crc(data)) });
  try {
    const w = world();
    const auto = w.make(bot.base);
    await (await auto.check(catalogOf("nes"))).done;
    assert.equal(fs.existsSync(w.core("fceumm")), false);
    assert.equal(w.ledger().all().size, 0);
    const [st] = coreStates({ ...catalogOf("nes"), present: new Map(), entries: new Map(), enabled: true, failures: auto.status().failures, now: w.clock() });
    assert.equal(st.state, "failed");
    assert.equal(st.reason, "crc-mismatch");
    const zips = bot.zips().length;
    assert.equal((await auto.check(catalogOf("nes"))).reason, "nothing", "inside the backoff: no retry storm");
    assert.equal(bot.zips().length, zips);
    bot.state.crcOf = (core, data) => crc(data);
    forgetIndex();
    w.advance(31 * 60_000);
    await (await auto.check(catalogOf("nes"))).done;
    assert.deepEqual(fs.readFileSync(w.core("fceumm")), BUILDS.fceumm);
    assert.deepEqual(auto.status().failures, {});
  } finally { bot.close(); }
});

test("the disk floor stops a download before it starts", opts, async () => {
  const bot = await buildbot(BUILDS);
  try {
    const w = world({ free: 512 * 1024 * 1024 });
    const auto = w.make(bot.base, { floorBytes: () => 0 });
    await (await auto.check(catalogOf("nes"))).done;
    assert.equal(fs.existsSync(w.core("fceumm")), false);
    assert.equal(auto.status().failures.fceumm.reason, "disk-floor");
    assert.deepEqual(stagingLeft(w), []);
  } finally { bot.close(); }
});

test("the user's core is pinned: not fetched, not updated, no update badge", opts, async () => {
  const bot = await buildbot(BUILDS);
  try {
    const w = world();
    const mine = nro("my-korean-patch-build");
    fs.writeFileSync(w.core("fceumm"), mine);
    const auto = w.make(bot.base);
    assert.equal((await auto.check(catalogOf("nes"))).reason, "nothing");
    await auto.update().done;
    assert.deepEqual(fs.readFileSync(w.core("fceumm")), mine);
    assert.deepEqual(bot.zips(), []);
    const [st] = await auto.states(catalogOf("nes"), new Map([["fceumm", sha(mine)]]));
    assert.equal(st.state, "pinned");
    assert.equal("updateAvailable" in st, false);
  } finally { bot.close(); }
});

test("setting off: a scan does nothing; a core in the trash is not fetched again", opts, async () => {
  const bot = await buildbot(BUILDS);
  try {
    const w = world();
    w.enabled = false;
    const auto = w.make(bot.base);
    assert.equal((await auto.check(catalogOf("nes"))).reason, "off");
    assert.deepEqual(bot.hits, []);
    const [st] = await auto.states(catalogOf("nes"), new Map());
    assert.deepEqual([st.state, st.reason], ["missing", "auto-off"]);
    w.enabled = true;
    fs.writeFileSync(w.core("fceumm"), nro("old"));
    await toTrash(w.retroDir, w.core("fceumm"), "fceumm_libretro_libnx.nro");
    assert.equal((await auto.check(catalogOf("nes"))).reason, "nothing");
    assert.equal((await auto.states(catalogOf("nes"), new Map()))[0].state, "held");
  } finally { bot.close(); }
});

test("update replaces only the server's cores whose CRC changed, keeps no old copy, and leaves the forwarder key alone", opts, async () => {
  const bot = await buildbot(BUILDS);
  try {
    const w = world();
    const auto = w.make(bot.base);
    await (await auto.check(catalogOf("nes", "gba", "snes"))).done;
    const mine = nro("user-snes9x");
    fs.writeFileSync(w.core("snes9x"), mine); // the user's build over the server's: now pinned
    bot.state.builds = { ...bot.state.builds, fceumm: nro("fceumm-b"), snes9x: nro("snes9x-b") };
    bot.state.date = "2026-10-23";
    const out = await auto.update().done;
    assert.deepEqual(out.replaced, ["fceumm"]);
    assert.deepEqual(out.current, ["mgba"]);
    assert.deepEqual(out.pinned, ["snes9x"]);
    assert.deepEqual(fs.readFileSync(w.core("fceumm")), nro("fceumm-b"));
    assert.deepEqual(fs.readFileSync(w.core("snes9x")), mine);
    assert.deepEqual(fs.readdirSync(path.join(w.packDir, "cores")).sort(), ["fceumm_libretro_libnx.nro", "mgba_libretro_libnx.nro", "snes9x_libretro_libnx.nro"], "no backup or temp files");
    assert.equal(fs.existsSync(path.join(w.dataDir, "retro-pack-prev")), false);
    assert.equal(w.ledger().all().get("cores/fceumm_libretro_libnx.nro").built, "2026-10-23");
    const zips = bot.zips().length;
    await auto.update().done;
    assert.equal(bot.zips().length, zips, "a second update downloads nothing");
    // Shortcuts are never made again by themselves: the core path in a forwarder is the same after an update.
    assert.equal("revs" in JSON.parse(fs.readFileSync(path.join(w.dataDir, STATE_FILE), "utf8")), false, "no core revision is kept for forwarder keys");
    const game = { id: "nes-0123456789", name: "Game", core: "fceumm", romSdPath: "roms/nes/a.nes", publisher: "x" };
    assert.equal(forwarderSpec({ ...game, coreRev: "2026-10-23" }).key, forwarderSpec(game).key, "a core revision never moves a forwarder key");
  } finally { bot.close(); }
});

test("a second start reads no core in full: the hashes come from the cache", opts, async () => {
  const bot = await buildbot(BUILDS);
  try {
    const store = hashStore(openDatabase(":memory:"), "retro");
    let computed = 0;
    const counting = { ...store, set: (...a) => { computed++; return store.set(...a); } };
    const w = world({ hashCache: new HashCache(counting) });
    await (await w.make(bot.base).check(catalogOf("nes", "gba"))).done;
    await w.make(bot.base).update().done;
    const first = computed;
    assert.ok(first >= 2);
    await w.make(bot.base).update().done;
    assert.equal(computed, first, "nothing hashed again");
  } finally { bot.close(); }
});

test("switch a user's core to the official build and back: the user's file goes to the trash and returns", opts, async () => {
  const bot = await buildbot(BUILDS);
  try {
    const w = world();
    const mine = nro("my-build");
    fs.writeFileSync(w.core("fceumm"), mine);
    const auto = w.make(bot.base);
    const out = await auto.useOfficial("fceumm").done;
    assert.deepEqual(out.installed, ["fceumm"]);
    assert.deepEqual(fs.readFileSync(w.core("fceumm")), BUILDS.fceumm);
    const trash = await listTrash(w.retroDir);
    assert.equal(trash.length, 1);
    assert.equal(trash[0].name, "fceumm_libretro_libnx.nro");
    const [st] = await auto.states(catalogOf("nes"), new Map([["fceumm", sha(BUILDS.fceumm)]]));
    assert.deepEqual([st.state, st.userVersion], ["present", true]);
    await auto.useUserVersion("fceumm");
    assert.deepEqual(fs.readFileSync(w.core("fceumm")), mine);
    assert.equal(w.ledger().all().has("cores/fceumm_libretro_libnx.nro"), false);
    assert.deepEqual(await listTrash(w.retroDir), []);
    await assert.rejects(auto.useUserVersion("fceumm"), /휴지통/);
  } finally { bot.close(); }
});

test("a failed fetch puts the user's core back from the trash", opts, async () => {
  const bot = await buildbot(BUILDS, { crcOf: () => "deadbeef" });
  try {
    const w = world();
    const mine = nro("my-build");
    fs.writeFileSync(w.core("fceumm"), mine);
    const out = await w.make(bot.base).useOfficial("fceumm").done;
    assert.match(out.error, /CRC32/);
    assert.deepEqual(fs.readFileSync(w.core("fceumm")), mine);
    assert.deepEqual(await listTrash(w.retroDir), []);
  } finally { bot.close(); }
});

test("a redirect to another host is not followed", opts, async () => {
  const bot = await buildbot(BUILDS);
  try {
    const w = world();
    const auto = w.make(bot.base.replace("/latest/", "/"), {});
    // The base has no index there: the index request fails, nothing is placed.
    await (await auto.check(catalogOf("nes"))).done;
    assert.equal(fs.existsSync(w.core("fceumm")), false);
    const { fetchIndex } = await import("../../src/retro/nightly-cores.js");
    forgetIndex();
    const hop = async (url, init) => (url.endsWith(".index-extended") ? fetch(bot.base.replace("/latest/", "/elsewhere"), init) : fetch(url, init));
    await assert.rejects(fetchIndex({ base: bot.base, fetchImpl: hop }), /example\.invalid 는 코어를 받는 주소가 아닙니다/);
  } finally { bot.close(); }
});

test("old clients get the manifest exactly as it is; on-demand clients get every core marked; one core's files", () => {
  const m = {
    version: "v-all",
    files: [
      { path: "retroarch/assets/a.png", size: 1, sha256: "a".repeat(64) },
      { path: "retroarch/cores/fceumm_libretro_libnx.nro", size: 10, sha256: "b".repeat(64) },
      // A core for a console with no games, and one no system names (the operator put it there).
      { path: "retroarch/cores/mgba_libretro_libnx.nro", size: 10, sha256: "c".repeat(64) },
      { path: "retroarch/cores/openbor_libretro_libnx.nro", size: 10, sha256: "f".repeat(64) },
      { path: "retroarch/info/fceumm_libretro.info", size: 2, sha256: "d".repeat(64) },
      { path: "switch/retroarch_switch.nro", size: 5, sha256: "e".repeat(64) },
    ],
  };
  const before = JSON.stringify(m);
  assert.equal(manifestView(m, { onDemand: false }), m, "without the flag: the very manifest, byte for byte");
  assert.equal(JSON.stringify(manifestView(m, { onDemand: false })), before);
  const od = manifestView(m, { onDemand: true });
  assert.equal(od.files.length, m.files.length);
  assert.deepEqual(od.files[1], { ...m.files[1], core: "fceumm", onDemand: true });
  assert.deepEqual(od.files[4], { ...m.files[4], core: "fceumm" });
  assert.equal(od.files[0].core, undefined);
  assert.notEqual(od.version, m.version);
  assert.equal(JSON.stringify(m), before, "the manifest itself is not changed");
  assert.deepEqual(coreFiles(m, "fceumm").map((f) => [f.path, f.core]), [["retroarch/cores/fceumm_libretro_libnx.nro", "fceumm"], ["retroarch/info/fceumm_libretro.info", "fceumm"]]);
  assert.deepEqual(coreFiles(m, "stella"), []);
});

/** A hashFile whose `nth` call lets `write()` land right after it read the file: a user's write racing the server. */
function racingHash(nth, write) {
  let calls = 0;
  return async (abs) => {
    const h = await sha256File(abs);
    if (++calls === nth) write();
    return h;
  };
}

/** Puts the user's `bytes` in the trash and the server's build of fceumm in its place, the way useOfficial does. */
async function officialOverUser(w, base, bytes) {
  fs.writeFileSync(w.core("fceumm"), bytes);
  await w.make(base).useOfficial("fceumm").done;
  assert.deepEqual(fs.readFileSync(w.core("fceumm")), BUILDS.fceumm);
  assert.equal((await listTrash(w.retroDir)).length, 1);
}

test("F2: a user's file written while update checks the old one is never overwritten", opts, async () => {
  const bot = await buildbot(BUILDS);
  try {
    const w = world();
    await (await w.make(bot.base).check(catalogOf("nes"))).done;
    bot.state.builds = { ...bot.state.builds, fceumm: nro("fceumm-b") };
    const mine = nro("user-wrote-this-meanwhile");
    // Call 1 is update's look at the core, call 2 the check just before the swap.
    const auto = w.make(bot.base, { hashFile: racingHash(2, () => fs.writeFileSync(w.core("fceumm"), mine)) });
    const out = await auto.update().done;
    assert.deepEqual(out.replaced, []);
    assert.deepEqual(fs.readFileSync(w.core("fceumm")), mine, "the user's bytes are kept");
    assert.deepEqual(fs.readdirSync(path.join(w.packDir, "cores")), ["fceumm_libretro_libnx.nro"], "nothing left aside");
  } finally { bot.close(); }
});

test("F2: switching back never deletes a file the user changed after the server looked", opts, async () => {
  const bot = await buildbot(BUILDS);
  try {
    const w = world();
    await officialOverUser(w, bot.base, nro("my-build"));
    const changed = nro("changed-meanwhile");
    const auto = w.make(bot.base, { hashFile: racingHash(1, () => fs.writeFileSync(w.core("fceumm"), changed)) });
    await assert.rejects(auto.useUserVersion("fceumm"), (err) => err.status === 409);
    assert.deepEqual(fs.readFileSync(w.core("fceumm")), changed, "the changed file is where it was");
    assert.equal((await listTrash(w.retroDir)).length, 1, "the user version stays in the trash");
    assert.deepEqual(fs.readdirSync(path.join(w.packDir, "cores")), ["fceumm_libretro_libnx.nro"]);
  } finally { bot.close(); }
});

test("switching back needs the core's own name free: a taken slot leaves the trash item in place", opts, async () => {
  const bot = await buildbot(BUILDS);
  try {
    const w = world();
    await officialOverUser(w, bot.base, nro("my-build"));
    const other = nro("someone-else");
    // Call 2 hashes the server's file moved aside; then another file lands in the slot.
    const auto = w.make(bot.base, { hashFile: racingHash(2, () => fs.writeFileSync(w.core("fceumm"), other)) });
    await assert.rejects(auto.useUserVersion("fceumm"), (err) => err.status === 409);
    assert.deepEqual(fs.readFileSync(w.core("fceumm")), other);
    assert.equal((await listTrash(w.retroDir)).length, 1, "nothing restored under another name");
    assert.deepEqual(fs.readdirSync(path.join(w.packDir, "cores")), ["fceumm_libretro_libnx.nro"]);
  } finally { bot.close(); }
});

/** The real trash restore, with `occupy` run first: another file takes the core's place mid-swap. */
const occupiedRestore = (occupy, calls = []) => async (dir, entry, o) => {
  calls.push(o);
  await occupy?.();
  return restoreEntry(dir, entry, o);
};

test("G1: a place taken during the restore is refused by the trash, its entry stays and the pack never lists a numbered core", opts, async () => {
  const bot = await buildbot(BUILDS);
  try {
    const w = world();
    await officialOverUser(w, bot.base, nro("my-build"));
    const other = nro("someone-else");
    const auto = w.make(bot.base, { restore: occupiedRestore(() => fs.writeFileSync(w.core("fceumm"), other)) });
    await assert.rejects(auto.useUserVersion("fceumm"), (err) => err.status === 409);
    assert.deepEqual(fs.readdirSync(path.join(w.packDir, "cores")), ["fceumm_libretro_libnx.nro"], "no \"(2)\" core is left");
    assert.deepEqual(fs.readFileSync(w.core("fceumm")), other, "the file that took the place stays");
    const listed = (await listPack(w.packDir, { cleanDir: path.join(w.dataDir, "clean") })).map((f) => f.path);
    assert.deepEqual(listed.filter((p) => p.includes("(2)")), [], "the pack does not list it");
    const trash = await listTrash(w.retroDir);
    assert.equal(trash.length, 1, "the user's core is still in the trash");
    assert.equal(trash[0].name, "fceumm_libretro_libnx.nro");
  } finally { bot.close(); }
});

test("G1: the restore is asked for the exact name", opts, async () => {
  const bot = await buildbot(BUILDS);
  try {
    const w = world();
    await officialOverUser(w, bot.base, nro("my-build"));
    const calls = [];
    const auto = w.make(bot.base, { restore: occupiedRestore(() => fs.writeFileSync(w.core("fceumm"), nro("someone-else")), calls) });
    await assert.rejects(auto.useUserVersion("fceumm"), (err) => err.status === 409);
    assert.deepEqual(calls, [{ exactName: true }]);
  } finally { bot.close(); }
});

test("G1: once the place is free again, the user's core comes back under its own name", opts, async () => {
  const bot = await buildbot(BUILDS);
  try {
    const w = world();
    const mine = nro("my-build");
    await officialOverUser(w, bot.base, mine);
    let occupy = true;
    const auto = w.make(bot.base, { restore: occupiedRestore(() => occupy && fs.writeFileSync(w.core("fceumm"), nro("brief"))) });
    await assert.rejects(auto.useUserVersion("fceumm"), (err) => err.status === 409);
    occupy = false;
    fs.rmSync(w.core("fceumm"));
    await auto.useUserVersion("fceumm");
    assert.deepEqual(fs.readdirSync(path.join(w.packDir, "cores")), ["fceumm_libretro_libnx.nro"]);
    assert.deepEqual(fs.readFileSync(w.core("fceumm")), mine);
    assert.deepEqual(await listTrash(w.retroDir), []);
  } finally { bot.close(); }
});

/**
 * A buildbot that answers the index and then misbehaves on the zip: "silent" never sends headers,
 * "stall" sends headers and a few bytes and then nothing, "trickle" sends a byte every 50 ms forever.
 * `index: "silent"` never answers the index either.
 */
async function slowBot(zip, { index = "ok" } = {}) {
  const timers = new Set();
  const server = http.createServer((req, res) => {
    if (req.url.endsWith(".index-extended")) {
      if (index === "silent") return;
      res.end(`2026-10-21 ${crc(BUILDS.fceumm)} fceumm_libretro_libnx.nro.zip\n`);
      return;
    }
    if (zip === "silent") return;
    res.writeHead(200, { "Content-Length": 100_000 });
    res.write(Buffer.alloc(10));
    if (zip === "trickle") timers.add(setInterval(() => res.write(Buffer.alloc(1)), 50));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    base: `http://127.0.0.1:${server.address().port}/latest/`,
    close: () => {
      for (const t of timers) clearInterval(t);
      server.closeAllConnections();
      server.close();
    },
  };
}

const SHORT = { connect: 300, idle: 300, total: 1500 };
const SHORT_ALL = { core: SHORT, index: SHORT };

for (const [what, zip, index] of [["no answer to the index", "ok", "silent"], ["no headers for the zip", "silent", "ok"], ["a body that stops", "stall", "ok"], ["a body that never ends", "trickle", "ok"]]) {
  test(`F3: ${what} times out, fails as a download with backoff and frees the pack`, { ...opts, timeout: 15_000 }, async () => {
    const bot = await slowBot(zip, { index });
    try {
      const w = world();
      const auto = w.make(bot.base, { timeouts: SHORT_ALL });
      const r = await auto.check(catalogOf("nes"));
      const out = await r.done;
      assert.deepEqual(out.installed ?? [], []);
      assert.equal(auto.status().failures.fceumm.reason, "download");
      assert.equal(auto.status().job, null);
      assert.equal(fs.existsSync(w.core("fceumm")), false);
      const release = claimFill();
      assert.ok(release, "the pack is free for a fill again");
      release();
    } finally { bot.close(); }
  });
}

test("F4: the free space is measured where the core is written too, not only on the data disk", opts, async () => {
  const bot = await buildbot(BUILDS);
  try {
    const w = world();
    const retroName = path.basename(w.retroDir);
    const asked = [];
    const freeBytes = async (dir) => {
      asked.push(dir);
      return dir.includes(retroName) ? 100 * 1024 * 1024 : 100 * GIB;
    };
    const auto = w.make(bot.base, { freeBytes, floorBytes: () => 0 });
    await (await auto.check(catalogOf("nes"))).done;
    assert.equal(fs.existsSync(w.core("fceumm")), false, "the retro disk is short: nothing written there");
    assert.equal(auto.status().failures.fceumm.reason, "disk-floor");
    assert.ok(asked.some((d) => d.includes(retroName)), "the retro disk was asked");
    assert.ok(asked.some((d) => d.includes(path.basename(w.dataDir))), "and the data disk, where the zip is staged");
    assert.deepEqual(fs.readdirSync(path.join(w.packDir, "cores")), []);
  } finally { bot.close(); }
});

test("F5: automation tokens may start the install and the update, never move a user's core to or from the trash", async () => {
  const { tokenBlocked } = await import("../../src/routes/admin-page.js");
  assert.equal(tokenBlocked("POST", "/api/retro-cores/official"), true);
  assert.equal(tokenBlocked("POST", "/api/retro-cores/user-version"), true);
  assert.equal(tokenBlocked("POST", "/api/retro-cores/Official"), true, "case does not get around it");
  assert.equal(tokenBlocked("POST", "/api/retro-cores/auto"), false);
  assert.equal(tokenBlocked("POST", "/api/retro-cores/update"), false);
});

/** Makes link() fail the way exFAT and CIFS do; `before(to)` runs first. Returns the mock to restore. */
const noHardLinks = (before = () => {}) => mock.method(fsp, "link", async (_from, to) => {
  before(to);
  throw Object.assign(new Error("operation not permitted, link"), { code: "EPERM" });
});
const coreNames = (w) => fs.readdirSync(path.join(w.packDir, "cores")).sort();

test("G2: without hard links a core is still installed and updated, and nothing is left hidden", opts, async () => {
  const bot = await buildbot(BUILDS);
  const m = noHardLinks();
  try {
    const w = world();
    const first = await (await w.make(bot.base).check(catalogOf("nes"))).done;
    assert.deepEqual(first.installed, ["fceumm"]);
    assert.deepEqual(fs.readFileSync(w.core("fceumm")), BUILDS.fceumm);
    bot.state.builds = { ...bot.state.builds, fceumm: nro("fceumm-b") };
    const out = await w.make(bot.base).update().done;
    assert.deepEqual(out.replaced, ["fceumm"]);
    assert.deepEqual(fs.readFileSync(w.core("fceumm")), nro("fceumm-b"));
    assert.deepEqual(coreNames(w), ["fceumm_libretro_libnx.nro"], "no aside or partial file is left");
  } finally { m.mock.restore(); bot.close(); }
});

test("G2: without hard links a user's file dropped during an update stays in place, not hidden", opts, async () => {
  const bot = await buildbot(BUILDS);
  try {
    const w = world();
    await (await w.make(bot.base).check(catalogOf("nes"))).done;
    bot.state.builds = { ...bot.state.builds, fceumm: nro("fceumm-b") };
    const mine = nro("user-wrote-this-meanwhile");
    const m = noHardLinks();
    try {
      const auto = w.make(bot.base, { hashFile: racingHash(1, () => fs.writeFileSync(w.core("fceumm"), mine)) });
      const out = await auto.update().done;
      assert.deepEqual(out.replaced, []);
    } finally { m.mock.restore(); }
    assert.deepEqual(fs.readFileSync(w.core("fceumm")), mine);
    assert.deepEqual(coreNames(w), ["fceumm_libretro_libnx.nro"]);
  } finally { bot.close(); }
});

test("G2: without hard links the copy never overwrites a file that got to the place first", opts, async () => {
  const bot = await buildbot(BUILDS);
  const mine = nro("dropped-at-the-last-moment");
  let w;
  const m = noHardLinks((to) => { if (to === w.core("fceumm")) fs.writeFileSync(to, mine); });
  try {
    w = world();
    const out = await (await w.make(bot.base).check(catalogOf("nes"))).done;
    assert.deepEqual([out.installed, out.failed], [[], []], "kept, not failed: the copy was refused, not the disk");
    assert.deepEqual(fs.readFileSync(w.core("fceumm")), mine);
    assert.deepEqual(coreNames(w), ["fceumm_libretro_libnx.nro"]);
    assert.equal(w.ledger().all().has("cores/fceumm_libretro_libnx.nro"), false, "no ledger row for the user's file");
  } finally { m.mock.restore(); bot.close(); }
});

/** A leftover beside `core`'s place, named the way auto-cores.js names them. */
const leftover = (w, core, kind, bytes) => {
  const abs = path.join(w.packDir, "cores", `.${core}_libretro_libnx.nro.${crypto.randomBytes(6).toString("hex")}.${kind}`);
  fs.writeFileSync(abs, bytes);
  return abs;
};

test("G3: on start the partial downloads, staging and the server's own moved-aside files are deleted", opts, async () => {
  const bot = await buildbot(BUILDS);
  try {
    const w = world();
    await (await w.make(bot.base).check(catalogOf("nes", "gba"))).done;
    leftover(w, "fceumm", "cfpart", nro("half"));
    leftover(w, "fceumm", "aside", BUILDS.fceumm); // the server's, its place is taken
    fs.rmSync(w.core("mgba"));
    leftover(w, "mgba", "aside", BUILDS.mgba); // the server's, mid-update: its place is empty
    fs.mkdirSync(path.join(w.dataDir, "retro-core-staging", "fceumm-abc"), { recursive: true });
    fs.writeFileSync(path.join(w.dataDir, "retro-core-staging", "fceumm-abc", "x.zip"), "zip");
    const out = await w.make(bot.base).recover();
    assert.deepEqual(out.held, []);
    assert.deepEqual(coreNames(w), ["fceumm_libretro_libnx.nro"]);
    assert.deepEqual(fs.existsSync(path.join(w.dataDir, "retro-core-staging")) ? fs.readdirSync(path.join(w.dataDir, "retro-core-staging")) : [], []);
  } finally { bot.close(); }
});

test("G3: a user's file left aside goes back to its name when the place is empty", opts, async () => {
  const w = world();
  const mine = nro("users-core");
  leftover(w, "fceumm", "aside", mine);
  const out = await w.make("http://127.0.0.1:1/").recover();
  assert.deepEqual(out.held, []);
  assert.deepEqual(coreNames(w), ["fceumm_libretro_libnx.nro"]);
  assert.deepEqual(fs.readFileSync(w.core("fceumm")), mine);
});

test("G3: a user's file left aside whose place is taken is held, shown, never deleted, and comes back on request", opts, async () => {
  const bot = await buildbot(BUILDS);
  try {
    const w = world();
    const hiddenUser = nro("user-a");
    const occupant = nro("user-b");
    fs.writeFileSync(w.core("fceumm"), occupant);
    const aside = leftover(w, "fceumm", "aside", hiddenUser);
    const auto = w.make(bot.base);
    const out = await auto.recover();
    assert.equal(out.held.length, 1);
    assert.deepEqual({ core: out.held[0].core, file: out.held[0].file, size: out.held[0].size }, { core: "fceumm", file: path.basename(aside), size: hiddenUser.length });
    // Before each job too: it is still there after one, and still not deleted.
    await (await auto.check(catalogOf("nes"), { force: true })).done;
    assert.deepEqual(fs.readFileSync(aside), hiddenUser);
    assert.deepEqual((await auto.hidden()).map((h) => h.file), [path.basename(aside)]);
    // The admin brings it back: the file in its place goes to the trash (nothing deleted).
    await auto.useUserVersion("fceumm", { hidden: path.basename(aside) });
    assert.deepEqual(fs.readFileSync(w.core("fceumm")), hiddenUser);
    assert.deepEqual(coreNames(w), ["fceumm_libretro_libnx.nro"]);
    const trash = await listTrash(w.retroDir);
    assert.equal(trash.length, 1);
    // What went to the trash is the occupant's bytes: restored through the trash's own API to check.
    fs.renameSync(w.core("fceumm"), path.join(w.retroDir, "parked"));
    await restoreEntry(w.retroDir, trash[0].entry);
    assert.deepEqual(fs.readFileSync(w.core("fceumm")), occupant);
    fs.renameSync(path.join(w.retroDir, "parked"), w.core("fceumm"));
    assert.deepEqual(await auto.hidden(), []);
  } finally { bot.close(); }
});

test("G3: bringing back a held file over the server's own core deletes the server's core and its ledger row", opts, async () => {
  const bot = await buildbot(BUILDS);
  try {
    const w = world();
    await (await w.make(bot.base).check(catalogOf("nes"))).done;
    const hiddenUser = nro("user-a");
    const aside = leftover(w, "fceumm", "aside", hiddenUser);
    const auto = w.make(bot.base);
    assert.equal((await auto.hidden()).length, 1);
    await assert.rejects(auto.useUserVersion("fceumm", { hidden: "../../etc/passwd" }), (err) => err.status === 404);
    await auto.useUserVersion("fceumm", { hidden: path.basename(aside) });
    assert.deepEqual(fs.readFileSync(w.core("fceumm")), hiddenUser);
    assert.deepEqual(coreNames(w), ["fceumm_libretro_libnx.nro"]);
    assert.deepEqual(await listTrash(w.retroDir), [], "the server's core is not kept");
    assert.equal(w.ledger().all().has("cores/fceumm_libretro_libnx.nro"), false);
  } finally { bot.close(); }
});

/** Waits for `cond()` to hold, failing after `ms`. */
async function until(cond, ms = 10_000, what = "condition") {
  const t0 = Date.now();
  while (!(await cond())) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

test("the default restore asks the trash for the exact name: a place taken while it restores leaves the item as it was", opts, async () => {
  const bot = await buildbot(BUILDS);
  try {
    const w = world();
    await officialOverUser(w, bot.base, nro("my-build"));
    const other = nro("someone-else");
    const restore = async (d, e, o) => {
      fs.writeFileSync(w.core("fceumm"), other);
      return restoreCore(d, e, o);
    };
    await assert.rejects(w.make(bot.base, { restore }).useUserVersion("fceumm"), (err) => err.status === 409);
    assert.deepEqual(fs.readFileSync(w.core("fceumm")), other);
    assert.deepEqual(coreNames(w), ["fceumm_libretro_libnx.nro"]);
    const trash = await listTrash(w.retroDir);
    assert.equal(trash.length, 1);
    assert.deepEqual(trash[0].files.map((f) => path.basename(f)), ["fceumm_libretro_libnx.nro"], "the item keeps its own name, never \"(2)\"");
  } finally { bot.close(); }
});

test("H1: without hard links a copy cut short by a crash leaves only a hidden partial file; the next start fetches the core whole", { ...opts, timeout: 30_000 }, async () => {
  const big = Buffer.concat([nro("fceumm-big"), Buffer.alloc(200_000, 7)]);
  const bot = await buildbot({ fceumm: big });
  try {
    const w = world();
    const dbFile = path.join(w.dataDir, "security.db");
    const href = (p) => new URL(p, import.meta.url).href;
    const child = spawn(process.execPath, ["--input-type=module", "-e", `
      import fs from "fs"; import fsp from "fs/promises"; import { Readable } from "stream";
      const [auto, db, sec, bundle, retroDir, dataDir, dbFile, base] = process.argv.slice(1);
      const { createAutoCores } = await import(auto);
      const { openDatabase, SECURITY_MIGRATIONS } = await import(db);
      const { packLedger } = await import(sec);
      const { sevenZipBin } = await import(bundle);
      fsp.link = async () => { throw Object.assign(new Error("EPERM link"), { code: "EPERM" }); };
      const orig = fs.createReadStream;
      fs.createReadStream = (p, o) => String(p).endsWith(".cfpart")
        ? new Readable({ read() { if (!this.sent) { this.sent = 1; this.push(fs.readFileSync(p).subarray(0, 4096)); } } })
        : orig(p, o);
      const store = packLedger({ db: openDatabase(dbFile, { migrations: SECURITY_MIGRATIONS }) });
      const a = createAutoCores({ packDir: () => retroDir + "/retroarch", retroDir, dataDir, ledger: () => store, base: () => base, freeBytes: async () => 1e15, bin: sevenZipBin() });
      await a.check({ systems: { nes: { core: "fceumm" } }, games: [{ id: "g", system: "nes", core: "fceumm" }] });
      setInterval(() => {}, 1000);
    `, href("../../src/retro/auto-cores.js"), href("../../src/db/database.js"), href("../../src/db/security-stores.js"), href("../../src/retro/pack-bundle.js"), w.retroDir, w.dataDir, dbFile, bot.base], { stdio: "ignore" });
    const dir = path.join(w.packDir, "cores");
    const stuck = () => fs.readdirSync(dir).some((n) => {
      const size = fs.statSync(path.join(dir, n)).size;
      return n === "fceumm_libretro_libnx.nro" ? size > 0 : n.endsWith(".cfpart") && size === 4096;
    });
    try {
      await until(stuck, 20_000, "the copy to stall");
      await new Promise((r) => setTimeout(r, 200));
    } finally {
      child.kill("SIGKILL");
    }
    await new Promise((r) => (child.exitCode !== null || child.signalCode !== null ? r() : child.once("exit", r)));
    assert.deepEqual(coreNames(w).filter((n) => !n.startsWith(".")), [], "nothing under the real name after the crash");
    assert.deepEqual((await listPack(w.packDir, { cleanDir: path.join(w.dataDir, "clean") })).filter((f) => f.path.includes("cores/")).map((f) => f.path), [], "the pack lists no partial file");
    const store = packLedger({ db: openDatabase(dbFile, { migrations: SECURITY_MIGRATIONS }) });
    forgetIndex();
    const auto = createAutoCores({ packDir: () => w.packDir, retroDir: w.retroDir, dataDir: w.dataDir, ledger: () => store, base: () => bot.base, freeBytes: async () => 100 * GIB, bin });
    assert.deepEqual((await auto.recover()).held, []);
    assert.deepEqual(coreNames(w), [], "recover() deletes the partial file");
    const c = await auto.check(catalogOf("nes"));
    assert.equal(c.started, true);
    assert.deepEqual((await c.done).installed, ["fceumm"]);
    assert.deepEqual(fs.readFileSync(w.core("fceumm")), big);
    assert.deepEqual(coreNames(w), ["fceumm_libretro_libnx.nro"]);
  } finally { bot.close(); }
});

test("H1: without hard links the real name never shows a half-written core while the copy runs", opts, async () => {
  const bot = await buildbot(BUILDS);
  const w = world();
  let release;
  const gate = new Promise((r) => { release = r; });
  const seen = [];
  const link = noHardLinks();
  const orig = fs.createReadStream;
  const read = mock.method(fs, "createReadStream", (p, o) => {
    if (!String(p).endsWith(".cfpart")) return orig(p, o);
    const inner = orig(p, o);
    return new Readable({
      async read() {
        if (this.started) return;
        this.started = true;
        seen.push(coreNames(w));
        await gate;
        for await (const chunk of inner) this.push(chunk);
        this.push(null);
      },
    });
  });
  try {
    const c = await w.make(bot.base).check(catalogOf("nes"));
    await until(() => seen.length > 0, 10_000, "the copy to start");
    assert.ok(seen[0].every((n) => n.startsWith(".") && n.endsWith(".cfpart")), `only hidden partial files while copying: ${seen[0]}`);
    release();
    assert.deepEqual((await c.done).installed, ["fceumm"]);
    assert.deepEqual(fs.readFileSync(w.core("fceumm")), BUILDS.fceumm);
    assert.deepEqual(coreNames(w), ["fceumm_libretro_libnx.nro"]);
  } finally { release(); read.mock.restore(); link.mock.restore(); bot.close(); }
});

test("H2: the admin's listing of hidden files only reads: nothing is moved, deleted or put back", async () => {
  const w = world();
  fs.writeFileSync(w.core("fceumm"), nro("user-b"));
  const held = leftover(w, "fceumm", "aside", nro("user-a"));
  const back = leftover(w, "mgba", "aside", nro("user-c")); // its place is empty: recover() would put it back
  const part = leftover(w, "snes9x", "cfpart", nro("half"));
  const staging = path.join(w.dataDir, "retro-core-staging", "fceumm-abc");
  fs.mkdirSync(staging, { recursive: true });
  const before = coreNames(w);
  const auto = w.make("http://127.0.0.1:1/");
  assert.deepEqual((await auto.hidden()).map((h) => [h.core, h.file]), [["fceumm", path.basename(held)]]);
  assert.deepEqual(coreNames(w), before);
  assert.ok(fs.existsSync(back) && fs.existsSync(part) && fs.existsSync(staging));
  // It reads while the pack is held too, instead of going blank.
  const release = claimFill();
  try {
    assert.equal((await auto.hidden()).length, 1);
  } finally { release(); }
});

test("H2: a scan that finds the pack held by another writer runs once it is free, not dropped", opts, async () => {
  const bot = await buildbot(BUILDS);
  try {
    const w = world();
    const auto = w.make(bot.base);
    await until(() => !fillBusy(), 10_000, "the pack to be free");
    const release = claimFill();
    let out;
    try {
      out = await auto.check(catalogOf("nes"));
    } finally { release(); }
    assert.equal(out.started, false);
    assert.equal(out.reason, "busy");
    await until(() => fs.existsSync(w.core("fceumm")) && !auto.status().job, 10_000, "the queued scan to install the core");
    assert.deepEqual(fs.readFileSync(w.core("fceumm")), BUILDS.fceumm);
  } finally { bot.close(); }
});
