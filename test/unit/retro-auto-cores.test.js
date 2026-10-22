import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import zlib from "zlib";
import { spawnSync } from "child_process";
import { openDatabase, SECURITY_MIGRATIONS } from "../../src/db/database.js";
import { hashStore } from "../../src/db/stores.js";
import { packLedger } from "../../src/db/security-stores.js";
import { HashCache } from "../../src/helpers/hash-cache.js";
import { sevenZipBin } from "../../src/retro/pack-bundle.js";
import { coreStates, createAutoCores, coreRev, STATE_FILE } from "../../src/retro/auto-cores.js";
import { forgetIndex, parseIndex } from "../../src/retro/nightly-cores.js";
import { coreFiles, manifestView } from "../../src/retro/base-pack.js";
import { forwarderSpec } from "../../src/retro/forwarder.js";
import { listTrash } from "../../src/retro/trash.js";

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
    assert.equal(fs.existsSync(path.join(w.dataDir, "retro-core-staging")) && fs.readdirSync(path.join(w.dataDir, "retro-core-staging")).length, 0, "no staging left");
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
    assert.equal(fs.readdirSync(path.join(w.dataDir, "retro-core-staging")).length, 0);
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
    const trashed = path.join(w.retroDir, ".trash", "2026-10-22", "core-0123456789");
    fs.mkdirSync(path.join(trashed, "retroarch", "cores"), { recursive: true });
    fs.writeFileSync(path.join(trashed, "retroarch", "cores", "fceumm_libretro_libnx.nro"), nro("old"));
    fs.writeFileSync(path.join(trashed, "manifest.json"), JSON.stringify({ id: "core-0123456789", system: "core", name: "fceumm_libretro_libnx.nro", file: "retroarch/cores/fceumm_libretro_libnx.nro", files: ["retroarch/cores/fceumm_libretro_libnx.nro"], trashedAt: 1 }));
    assert.equal((await auto.check(catalogOf("nes"))).reason, "nothing");
    assert.equal((await auto.states(catalogOf("nes"), new Map()))[0].state, "held");
  } finally { bot.close(); }
});

test("update replaces only the server's cores whose CRC changed, keeps no old copy, and moves the forwarder key", opts, async () => {
  const bot = await buildbot(BUILDS);
  try {
    const w = world();
    const auto = w.make(bot.base);
    await (await auto.check(catalogOf("nes", "gba", "snes"))).done;
    const mine = nro("user-snes9x");
    fs.writeFileSync(w.core("snes9x"), mine); // the user's build over the server's: now pinned
    const keyBefore = forwarderSpec({ id: "nes-0123456789", name: "Game", core: "fceumm", coreRev: coreRev("fceumm", w.dataDir), romSdPath: "roms/nes/a.nes", publisher: "x" }).key;
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
    assert.equal(coreRev("fceumm", w.dataDir), "2026-10-23");
    const keyAfter = forwarderSpec({ id: "nes-0123456789", name: "Game", core: "fceumm", coreRev: coreRev("fceumm", w.dataDir), romSdPath: "roms/nes/a.nes", publisher: "x" }).key;
    assert.notEqual(keyAfter, keyBefore);
    assert.equal(forwarderSpec({ id: "nes-0123456789", name: "Game", core: "mgba", coreRev: null, romSdPath: "roms/nes/a.nes", publisher: "x" }).key,
      forwarderSpec({ id: "nes-0123456789", name: "Game", core: "mgba", romSdPath: "roms/nes/a.nes", publisher: "x" }).key, "no rev, no key change");
    const zips = bot.zips().length;
    await auto.update().done;
    assert.equal(bot.zips().length, zips, "a second update downloads nothing");
    assert.ok(JSON.parse(fs.readFileSync(path.join(w.dataDir, STATE_FILE), "utf8")).revs.fceumm);
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

test("old clients get today's manifest; on-demand clients get every core marked; one core's files", () => {
  const m = {
    version: "v-all",
    files: [
      { path: "retroarch/assets/a.png", size: 1, sha256: "a".repeat(64) },
      { path: "retroarch/cores/fceumm_libretro_libnx.nro", size: 10, sha256: "b".repeat(64) },
      { path: "retroarch/cores/mgba_libretro_libnx.nro", size: 10, sha256: "c".repeat(64) },
      { path: "retroarch/info/fceumm_libretro.info", size: 2, sha256: "d".repeat(64) },
      { path: "switch/retroarch_switch.nro", size: 5, sha256: "e".repeat(64) },
    ],
  };
  const both = manifestView(m, { used: new Set(["fceumm", "mgba"]), onDemand: false });
  assert.deepEqual(both, { version: "v-all", files: m.files }, "every core in use: exactly as before");
  const old = manifestView(m, { used: new Set(["fceumm"]), onDemand: false });
  assert.deepEqual(old.files.map((f) => f.path), m.files.filter((f) => !f.path.includes("mgba")).map((f) => f.path), "no core of a console without games");
  assert.notEqual(old.version, "v-all");
  assert.ok(old.files.every((f) => !("onDemand" in f) && !("core" in f)));
  const od = manifestView(m, { onDemand: true });
  assert.equal(od.files.length, m.files.length);
  assert.deepEqual(od.files[1], { ...m.files[1], core: "fceumm", onDemand: true });
  assert.deepEqual(od.files[3], { ...m.files[3], core: "fceumm" });
  assert.equal(od.files[0].core, undefined);
  assert.notEqual(od.version, old.version);
  assert.deepEqual(coreFiles(m, "fceumm").map((f) => [f.path, f.core]), [["retroarch/cores/fceumm_libretro_libnx.nro", "fceumm"], ["retroarch/info/fceumm_libretro.info", "fceumm"]]);
  assert.deepEqual(coreFiles(m, "stella"), []);
});
