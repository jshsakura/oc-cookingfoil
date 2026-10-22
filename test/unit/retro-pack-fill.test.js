import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { openDatabase, SECURITY_MIGRATIONS } from "../../src/db/database.js";
import { packLedger } from "../../src/db/security-stores.js";
import { downloadBundle, sevenZipBin } from "../../src/retro/pack-bundle.js";
import { applyFill, commit, decide, describeFill, isProtected, REAL_IO, REAL_PACK, wantedCores } from "../../src/retro/pack-fill.js";
import { BEZEL_CREDIT, bezelCredit } from "../../src/retro/credits.js";
import { LANGS } from "../../src/meta/langs.js";

const bin = sevenZipBin();
const opts = { skip: bin ? false : "7-Zip is not installed (COOK_7Z_BIN, 7z, 7zz or 7za)" };
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "retro-pack-fill-"));

/** An NRO-looking file: "NRO0" at 0x10, then `tag` so each version differs. */
const nro = (tag) => Buffer.concat([Buffer.alloc(0x10), Buffer.from("NRO0"), Buffer.from(tag)]);

/**
 * A small bundle laid out like the official one, packed with 7-Zip, with the lock and official table that describe it.
 * `files` maps a path inside the archive to its bytes.
 */
function makeBundle(version, files) {
  const dir = tmp();
  const root = path.join(dir, "src");
  for (const [rel, data] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), data);
  }
  const archive = path.join(dir, "RetroArch.7z");
  const made = spawnSync(bin, ["a", "-bd", "-y", archive, "."], { cwd: root, stdio: "ignore" });
  assert.equal(made.status, 0, "7-Zip could not make the fixture");
  const bytes = fs.readFileSync(archive);
  const officialFiles = {};
  for (const rel of Object.keys(files)) {
    const m = rel.match(/^retroarch\/cores\/(.+_libretro_libnx\.nro)$/);
    if (m) officialFiles[m[1]] = [sha(files[rel]), files[rel].length];
  }
  const body = files["switch/retroarch_switch.nro"];
  const lock = {
    version,
    bundle: { url: "http://unused.invalid/RetroArch.7z", file: "RetroArch.7z", size: bytes.length, sha256: sha(bytes) },
    paths: {
      body: { from: "switch/retroarch_switch.nro", to: "retroarch.nro", size: body.length, sha256: sha(body), verified: true },
      cores: { from: "retroarch/cores", to: "cores", verified: true },
      dirs: [
        { from: "retroarch/info", to: "info", verified: true },
        { from: "retroarch/assets", to: "assets", verified: true },
        { from: "retroarch/autoconfig", to: "autoconfig", verified: true },
      ],
    },
  };
  const dirsOf = (top) => Object.keys(files).filter((r) => r.startsWith(`retroarch/${top}/`)).map((r) => r.slice(`retroarch/${top}/`.length)).sort();
  const manifest = { version, dirs: { info: dirsOf("info"), assets: dirsOf("assets"), autoconfig: dirsOf("autoconfig") } };
  return { archive, bytes, pack: { lock, official: { version, files: officialFiles }, manifest } };
}

const files = (tag, extra = {}) => ({
  "switch/retroarch_switch.nro": nro(`body-${tag}`),
  "retroarch/cores/fceumm_libretro_libnx.nro": nro(`fceumm-${tag}`),
  "retroarch/cores/mgba_libretro_libnx.nro": nro(`mgba-${tag}`),
  "retroarch/cores/unused_libretro_libnx.nro": nro(`unused-${tag}`),
  "retroarch/info/fceumm_libretro.info": `display_name = "Nintendo - NES (${tag})"\n`,
  "retroarch/assets/ozone/a.txt": `asset ${tag}\n`,
  "retroarch/autoconfig/hid/pad.cfg": `input_driver = "hid" # ${tag}\n`,
  ...extra,
});

/** Serves `archive` with Range support; `hits` records each request's Range header. */
async function serve(archive) {
  const hits = [];
  const server = http.createServer((req, res) => {
    const data = fs.readFileSync(archive);
    hits.push(req.headers.range ?? null);
    const m = /^bytes=(\d+)-/.exec(req.headers.range ?? "");
    if (m) {
      res.writeHead(206, { "Content-Range": `bytes ${m[1]}-${data.length - 1}/${data.length}`, "Content-Length": data.length - Number(m[1]) });
      res.end(data.subarray(Number(m[1])));
    } else {
      res.writeHead(200, { "Content-Length": data.length });
      res.end(data);
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}/RetroArch.7z`, hits, close: () => server.close() };
}

const GAMES = [
  { core: "fceumm", system: "nes" }, { core: "fceumm", system: "nes" },
  { core: "mgba", system: "gba" },
  { core: "stella", system: "atari2600" },
];

function world() {
  const dataDir = tmp();
  const packDir = path.join(tmp(), "retroarch");
  fs.mkdirSync(packDir, { recursive: true });
  const store = packLedger({ db: openDatabase(":memory:", { migrations: SECURITY_MIGRATIONS }) });
  return { dataDir, packDir, store, ledger: store.forRoot("test-root") };
}

const snapshot = (dir) => {
  const out = {};
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else out[r] = sha(fs.readFileSync(path.join(dir, r)));
    }
  };
  if (fs.existsSync(dir)) walk("");
  return out;
};

test("the file list of the folders matches the lock and the bundle it was taken from", () => {
  assert.equal(REAL_PACK.manifest.version, REAL_PACK.lock.version);
  assert.deepEqual(Object.fromEntries(Object.entries(REAL_PACK.manifest.dirs).map(([k, v]) => [k, v.length])), { info: 292, assets: 2500, autoconfig: 127 });
  assert.deepEqual(Object.keys(REAL_PACK.manifest.dirs), REAL_PACK.lock.paths.dirs.map((d) => d.to));
});

test("decide: only the server's own untouched file is ever replaced", () => {
  const entry = { sha256: "a" };
  assert.equal(decide({ current: null, entry: undefined, next: "b" }), "install");
  assert.equal(decide({ current: "x", entry: undefined, next: "b" }), "operator", "no ledger row: the operator's");
  assert.equal(decide({ current: "b", entry: undefined, next: "b" }), "current");
  assert.equal(decide({ current: "x", entry, next: "b" }), "modified", "the hash moved since the server placed it");
  assert.equal(decide({ current: "a", entry, next: "b" }), "replace");
  assert.equal(decide({ current: "b", entry: { sha256: "b" }, next: "b" }), "current");
});

test("retroarch.cfg, config/ and system/ are never the server's to write", () => {
  for (const rel of ["retroarch.cfg", "system/bios.bin", "config/mgba/x.cfg"]) assert.equal(isProtected(rel), true, rel);
  for (const rel of ["retroarch.nro", "cores/a_libretro_libnx.nro", "info/a.info"]) assert.equal(isProtected(rel), false, rel);
});

test("a core the bundle lacks, such as stella, is reported and never fetched", () => {
  const { have, lacking } = wantedCores(GAMES, makeOnlyTable({ fceumm: 1, mgba: 1 }));
  assert.deepEqual(have.map((c) => c.core), ["fceumm", "mgba"]);
  assert.deepEqual(lacking.map((c) => c.core), ["stella"]);
});
function makeOnlyTable(cores) {
  return { lock: { paths: { cores: { verified: true } } }, official: { files: Object.fromEntries(Object.keys(cores).map((c) => [`${c}_libretro_libnx.nro`, ["h", 1]])) } };
}

test("the real lock lists no stella, dsno or OpenBOR and every hash line carries the privacy marker", () => {
  const text = fs.readFileSync(new URL("../../src/retro/data/retro-pack.lock.json", import.meta.url), "utf8");
  assert.doesNotMatch(text, /stella|dsno|openbor/i);
  for (const line of text.split("\n")) if (/[0-9a-f]{40,}/.test(line)) assert.match(line, /privacy-ok/, line);
  assert.equal(REAL_PACK.lock.bundle.sha256.length, 64);
  assert.equal(REAL_PACK.lock.paths.cores.verified, true);
});

test("a core the live pack changed (not in the ledger) is the operator's, even though the bundle has that name", async () => {
  const { packDir, ledger, dataDir } = world();
  fs.mkdirSync(path.join(packDir, "cores"), { recursive: true });
  fs.writeFileSync(path.join(packDir, "cores/bluemsx_libretro_libnx.nro"), nro("korean patch"));
  const plan = await describeFill({ packDir, ledger, games: [{ core: "bluemsx", system: "msx" }], systems: {}, cacheDir: dataDir });
  assert.equal(plan.items.find((i) => i.name === "bluemsx").state, "operator");
  assert.deepEqual(plan.kept, [{ rel: "cores/bluemsx_libretro_libnx.nro", state: "operator" }]);
});

test("a download whose hash is not the lock's is deleted and refused, and nothing is installed", opts, async () => {
  const good = makeBundle("1.0.0", files("a"));
  const bad = makeBundle("1.0.0", files("evil"));
  const srv = await serve(bad.archive);
  const w = world();
  try {
    const pack = { ...good.pack, lock: { ...good.pack.lock, bundle: { ...good.pack.lock.bundle, size: bad.bytes.length } } };
    await assert.rejects(applyFill({ ...w, games: GAMES, url: srv.url, pack, bin }), (err) => err.hashMismatch === true);
    assert.ok(!fs.existsSync(path.join(w.dataDir, "retro-pack-cache/1.0.0/RetroArch.7z")), "the bad file is gone");
    assert.deepEqual(snapshot(w.packDir), {});
    assert.equal(w.ledger.all().size, 0);
  } finally {
    srv.close();
  }
});

test("a part of the download carries on with a Range request", opts, async () => {
  const b = makeBundle("1.0.0", files("a"));
  const srv = await serve(b.archive);
  const cacheDir = tmp();
  try {
    fs.writeFileSync(path.join(cacheDir, "RetroArch.7z"), b.bytes.subarray(0, 100));
    const seen = [];
    const out = await downloadBundle({ ...b.pack.lock.bundle, url: srv.url, cacheDir, onProgress: (p) => seen.push(p.done) });
    assert.equal(out.downloaded, true);
    assert.deepEqual(srv.hits, ["bytes=100-"]);
    assert.equal(sha(fs.readFileSync(out.file)), b.pack.lock.bundle.sha256);
    assert.equal(seen.at(-1), b.bytes.length);
    // Already complete: checked, not fetched again.
    assert.equal((await downloadBundle({ ...b.pack.lock.bundle, url: srv.url, cacheDir })).downloaded, false);
    assert.equal(srv.hits.length, 1);
  } finally {
    srv.close();
  }
});

test("fills an empty pack with the body, the cores games use and the folders, and leaves cfg and system alone", opts, async () => {
  const b = makeBundle("1.0.0", files("a"));
  const srv = await serve(b.archive);
  const w = world();
  try {
    fs.writeFileSync(path.join(w.packDir, "retroarch.cfg"), "video_fullscreen = true\n");
    fs.mkdirSync(path.join(w.packDir, "system"), { recursive: true });
    fs.writeFileSync(path.join(w.packDir, "system/bios.bin"), "bios");
    fs.mkdirSync(path.join(w.packDir, "config/mgba"), { recursive: true });
    fs.writeFileSync(path.join(w.packDir, "config/mgba/game.cfg"), "x = 1\n");
    const before = snapshot(w.packDir);

    const steps = [];
    const out = await applyFill({ ...w, games: GAMES, url: srv.url, pack: b.pack, bin, onStep: (s) => steps.push(s) });
    assert.deepEqual([...new Set(steps)], ["download", "unpack", "check", "place"]);
    assert.equal(out.installed, 6);
    assert.equal(out.replaced, 0);

    const after = snapshot(w.packDir);
    for (const k of Object.keys(before)) assert.equal(after[k], before[k], `${k} is untouched`);
    assert.deepEqual(Object.keys(after).filter((k) => !(k in before)).sort(), [
      "assets/ozone/a.txt", "autoconfig/hid/pad.cfg", "cores/fceumm_libretro_libnx.nro", "cores/mgba_libretro_libnx.nro", "info/fceumm_libretro.info", "retroarch.nro",
    ]);
    assert.ok(!fs.existsSync(path.join(w.packDir, "cores/unused_libretro_libnx.nro")), "a core no game uses is not installed");
    assert.ok(!fs.existsSync(path.join(w.packDir, "cores/stella_libretro_libnx.nro")));
    assert.equal(w.ledger.all().size, 6);
    assert.deepEqual(w.ledger.all().get("cores/mgba_libretro_libnx.nro"), { sha256: sha(nro("mgba-a")), source: "bundle", lockVersion: "1.0.0" });
    assert.ok(!fs.readdirSync(w.dataDir).includes("retro-pack-staging") || fs.readdirSync(path.join(w.dataDir, "retro-pack-staging")).length === 0, "staging is cleaned");
  } finally {
    srv.close();
  }
});

test("running it twice gives the same result and the second run changes nothing", opts, async () => {
  const b = makeBundle("1.0.0", files("a"));
  const srv = await serve(b.archive);
  const w = world();
  try {
    await applyFill({ ...w, games: GAMES, url: srv.url, pack: b.pack, bin });
    const once = snapshot(w.packDir);
    const rows = JSON.stringify([...w.ledger.all()]);
    const again = await applyFill({ ...w, games: GAMES, url: srv.url, pack: b.pack, bin });
    assert.equal(again.installed, 0);
    assert.equal(again.replaced, 0);
    assert.deepEqual(snapshot(w.packDir), once);
    assert.equal(JSON.stringify([...w.ledger.all()]), rows);
    assert.equal(srv.hits.length, 1, "the verified download is reused");
  } finally {
    srv.close();
  }
});

test("with nothing to place and no bundle on disk it does not download", opts, async () => {
  const b = makeBundle("1.0.0", files("a"));
  const srv = await serve(b.archive);
  const w = world();
  try {
    await applyFill({ ...w, games: GAMES, url: srv.url, pack: b.pack, bin });
    fs.rmSync(path.join(w.dataDir, "retro-pack-cache"), { recursive: true });
    const out = await applyFill({ ...w, games: GAMES, url: srv.url, pack: b.pack, bin });
    assert.equal(out.skipped, true);
    assert.equal(srv.hits.length, 1);
  } finally {
    srv.close();
  }
});

test("a new lock version replaces only the server's untouched files and keeps the previous ones", opts, async () => {
  const v1 = makeBundle("1.0.0", files("a"));
  const v2 = makeBundle("2.0.0", files("b"));
  const s1 = await serve(v1.archive);
  const s2 = await serve(v2.archive);
  const w = world();
  try {
    await applyFill({ ...w, games: GAMES, url: s1.url, pack: v1.pack, bin });
    // The operator changes the mgba core and the info file by hand, and drops a core of their own.
    fs.writeFileSync(path.join(w.packDir, "cores/mgba_libretro_libnx.nro"), nro("my own mgba"));
    fs.writeFileSync(path.join(w.packDir, "info/fceumm_libretro.info"), "display_name = \"mine\"\n");
    const games = [...GAMES, { core: "unused", system: "x" }];
    fs.writeFileSync(path.join(w.packDir, "cores/unused_libretro_libnx.nro"), nro("operator unused"));

    const out = await applyFill({ ...w, games, url: s2.url, pack: v2.pack, bin });
    const read = (rel) => fs.readFileSync(path.join(w.packDir, rel));
    assert.deepEqual(read("retroarch.nro"), nro("body-b"), "an untouched file moves to the new version");
    assert.deepEqual(read("cores/fceumm_libretro_libnx.nro"), nro("fceumm-b"));
    assert.deepEqual(read("cores/mgba_libretro_libnx.nro"), nro("my own mgba"), "a file the operator changed stays");
    assert.deepEqual(read("cores/unused_libretro_libnx.nro"), nro("operator unused"), "a file the ledger never held stays");
    assert.match(read("info/fceumm_libretro.info").toString(), /mine/);
    assert.deepEqual(out.kept.map((k) => [k.rel, k.state]).sort(), [["cores/mgba_libretro_libnx.nro", "modified"], ["cores/unused_libretro_libnx.nro", "operator"]]);
    assert.deepEqual(fs.readFileSync(path.join(w.dataDir, "retro-pack-prev/1.0.0/cores/fceumm_libretro_libnx.nro")), nro("fceumm-a"), "the replaced file is kept");
    assert.equal(w.ledger.all().get("retroarch.nro").lockVersion, "2.0.0");
    assert.ok(!fs.existsSync(path.join(w.dataDir, "retro-pack-cache/1.0.0")), "the old download is dropped once the new version is in");
  } finally {
    s1.close();
    s2.close();
  }
});

test("a step that fails midway puts the pack back and writes no ledger rows", opts, async () => {
  const v1 = makeBundle("1.0.0", files("a"));
  const v2 = makeBundle("2.0.0", files("b"));
  const s1 = await serve(v1.archive);
  const s2 = await serve(v2.archive);
  const w = world();
  try {
    await applyFill({ ...w, games: GAMES, url: s1.url, pack: v1.pack, bin });
    const before = snapshot(w.packDir);
    const rows = JSON.stringify([...w.ledger.all()]);
    let renames = 0;
    const io = { ...REAL_IO, rename: (a, b) => (++renames === 3 ? Promise.reject(new Error("disk full")) : fs.promises.rename(a, b)) };
    await assert.rejects(applyFill({ ...w, games: GAMES, url: s2.url, pack: v2.pack, bin, io }), (err) => err.rolledBack === true && /disk full/.test(err.message));
    assert.ok(renames >= 3, "it got past the first files before failing");
    assert.deepEqual(snapshot(w.packDir), before, "every file is as it was, no .cfpart left");
    assert.equal(JSON.stringify([...w.ledger.all()]), rows);
    // And once the disk is fine the same run goes through.
    const ok = await applyFill({ ...w, games: GAMES, url: s2.url, pack: v2.pack, bin });
    assert.ok(ok.replaced >= 3);
  } finally {
    s1.close();
    s2.close();
  }
});

test("commit puts back a new file's absence when a later rename fails", async () => {
  const src = tmp();
  fs.writeFileSync(path.join(src, "a"), "A");
  fs.writeFileSync(path.join(src, "b"), "B");
  const packDir = tmp();
  let n = 0;
  const io = { ...REAL_IO, link: (a, b) => (++n === 2 ? Promise.reject(new Error("nope")) : fs.promises.link(a, b)) };
  const ops = [{ rel: "x/a", abs: path.join(src, "a"), sha256: sha("A"), action: "install" }, { rel: "x/b", abs: path.join(src, "b"), sha256: sha("B"), action: "install" }];
  await assert.rejects(commit(ops, { packDir, io }), (err) => err.rolledBack === true && /nope/.test(err.message));
  assert.equal(n, 2, "it got as far as the second file");
  assert.deepEqual(snapshot(packDir), {}, "the first file and every temporary name are gone");
});

test("the bezel credit comes in all twelve client languages and names the project", () => {
  for (const lang of LANGS) assert.ok(BEZEL_CREDIT.text[lang]?.length > 10, lang);
  assert.deepEqual(bezelCredit("ko"), { name: "The Bezel Project", url: "https://github.com/thebezelproject", text: BEZEL_CREDIT.text.ko });
  assert.equal(bezelCredit("xx").text, BEZEL_CREDIT.text.en, "an unknown language is English");
  for (const t of Object.values(BEZEL_CREDIT.text)) assert.doesNotMatch(t, /—/);
});

// ---- review of #95 ----

/** The real file operations plus a hook that runs before `copy` (copyFile or copyExcl) and `place` (rename or link). */
function hookedIo({ beforeCopy = async () => {}, beforePlace = async () => {}, failCopy = null } = {}) {
  const fsp = fs.promises;
  const copy = async (a, b) => {
    await beforeCopy(a, b);
    if (failCopy?.(a, b)) throw Object.assign(new Error("ENOSPC"), { code: "ENOSPC" });
    return fsp.copyFile(a, b, fs.constants.COPYFILE_EXCL);
  };
  return {
    copyFile: copy, copyExcl: copy,
    rename: async (a, b) => { await beforePlace(a, b); return fsp.rename(a, b); },
    link: async (a, b) => { await beforePlace(a, b); return fsp.link(a, b); },
    rm: (a) => fsp.rm(a, { force: true }),
    mkdir: (d) => fsp.mkdir(d, { recursive: true }),
    lstat: (p) => fsp.lstat(p).catch(() => null),
  };
}

const served = async (b) => { const srv = await serve(b.archive); return { srv, url: srv.url }; };

test("B1: a core the operator puts there after the decision is kept, not overwritten or recorded", opts, async () => {
  const b = makeBundle("1.0.0", files("a"));
  const { srv, url } = await served(b);
  const w = world();
  try {
    let once = true;
    const io = hookedIo({ beforeCopy: async (src, dst) => {
      if (once && dst.includes("cores")) { once = false; fs.mkdirSync(path.join(w.packDir, "cores"), { recursive: true }); fs.writeFileSync(path.join(w.packDir, "cores/fceumm_libretro_libnx.nro"), nro("operator core")); }
    } });
    const out = await applyFill({ ...w, games: GAMES, url, pack: b.pack, bin, io });
    assert.deepEqual(fs.readFileSync(path.join(w.packDir, "cores/fceumm_libretro_libnx.nro")), nro("operator core"));
    assert.equal(w.ledger.all().has("cores/fceumm_libretro_libnx.nro"), false, "not recorded as the server's");
    assert.ok(out.kept.some((k) => k.rel === "cores/fceumm_libretro_libnx.nro" && k.state === "operator"));
    assert.ok(fs.existsSync(path.join(w.packDir, "cores/mgba_libretro_libnx.nro")), "the rest still went in");
  } finally { srv.close(); }
});

test("B1: when a copy fails, a rollback does not delete the operator file that arrived", opts, async () => {
  const b = makeBundle("1.0.0", files("a"));
  const { srv, url } = await served(b);
  const w = world();
  try {
    let n = 0;
    const io = hookedIo({
      beforeCopy: async () => { if (++n === 1) fs.writeFileSync(path.join(w.packDir, "retroarch.nro"), nro("operator body")); },
      failCopy: () => n === 1,
    });
    await assert.rejects(applyFill({ ...w, games: GAMES, url, pack: b.pack, bin, io }));
    assert.deepEqual(fs.readFileSync(path.join(w.packDir, "retroarch.nro")), nro("operator body"));
    assert.equal(w.ledger.all().size, 0);
  } finally { srv.close(); }
});

test("B2: a leftover link under the old fixed temp name cannot make the run overwrite an operator core", opts, async () => {
  const b = makeBundle("1.0.0", files("a"));
  const { srv, url } = await served(b);
  const w = world();
  try {
    fs.mkdirSync(path.join(w.packDir, "cores"), { recursive: true });
    const core = path.join(w.packDir, "cores/fceumm_libretro_libnx.nro");
    fs.writeFileSync(core, nro("operator core"));
    fs.symlinkSync(core, path.join(w.packDir, "retroarch.nro.cfpart"));
    await applyFill({ ...w, games: GAMES, url, pack: b.pack, bin });
    assert.deepEqual(fs.readFileSync(core), nro("operator core"));
    assert.equal(fs.lstatSync(path.join(w.packDir, "retroarch.nro")).isSymbolicLink(), false);
  } finally { srv.close(); }
});

test("B2: a link where a folder should be is refused and nothing is written outside the pack", opts, async () => {
  const b = makeBundle("1.0.0", files("a"));
  const { srv, url } = await served(b);
  const w = world();
  try {
    const outside = tmp();
    fs.symlinkSync(outside, path.join(w.packDir, "assets"));
    await assert.rejects(applyFill({ ...w, games: GAMES, url, pack: b.pack, bin }), /링크/);
    assert.deepEqual(fs.readdirSync(outside), []);
    assert.equal(w.ledger.all().size, 0);
    assert.ok(!fs.existsSync(path.join(w.packDir, "retroarch.nro")), "the whole run was undone");
  } finally { srv.close(); }
});

test("B3: when the ledger write and the rollback both fail, it is not reported as rolled back", opts, async () => {
  const v1 = makeBundle("1.0.0", files("a"));
  const v2 = makeBundle("2.0.0", files("b"));
  const s1 = await serve(v1.archive);
  const s2 = await serve(v2.archive);
  const w = world();
  try {
    await applyFill({ ...w, games: GAMES, url: s1.url, pack: v1.pack, bin });
    const failing = { all: () => w.ledger.all(), put: () => { throw new Error("ledger full"); } };
    const io = hookedIo({ failCopy: (src) => src.includes("retro-pack-prev") });
    await assert.rejects(applyFill({ ...w, ledger: failing, games: GAMES, url: s2.url, pack: v2.pack, bin, io }), (err) => err.rolledBack !== true && Array.isArray(err.stuck) && err.stuck.includes("retroarch.nro"));
    const rec = JSON.parse(fs.readFileSync(path.join(w.dataDir, "retro-pack-recovery.json"), "utf8"));
    assert.ok(rec.stuck.includes("retroarch.nro"));
    // And the next run refuses to go on until someone has looked.
    await assert.rejects(applyFill({ ...w, games: GAMES, url: s2.url, pack: v2.pack, bin }), (err) => err.status === 409);
  } finally { s1.close(); s2.close(); }
});

test("F1: a response longer than the lock's size is cut at once and the partial file is deleted", async () => {
  const cacheDir = tmp();
  let sent = 0;
  const fetchImpl = async () => new Response(new ReadableStream({
    pull(ctl) { if (sent > 4 * 1024 * 1024) return ctl.close(); sent += 64 * 1024; ctl.enqueue(new Uint8Array(64 * 1024)); },
  }), { status: 200 });
  await assert.rejects(downloadBundle({ url: "http://x.invalid/a", file: "RetroArch.7z", size: 16, sha256: "0".repeat(64), cacheDir, fetchImpl }), /크기|SHA/);
  assert.ok(!fs.existsSync(path.join(cacheDir, "RetroArch.7z")));
  assert.ok(sent < 1024 * 1024, `stopped early, ${sent} bytes were pulled`);
});

test("F3: a ledger kept for one pack folder does not make files in another folder the server's", async () => {
  const w = world();
  const a = w.store.forRoot("/pack-a");
  a.put([{ rel: "retroarch.nro", sha256: "old", source: "bundle", lockVersion: "1.0.0" }]);
  assert.equal(a.all().has("retroarch.nro"), true);
  assert.equal(w.store.forRoot("/pack-b").all().size, 0, "another folder has no rows");
});

test("F4: a file missing from a folder that exists is filled in, with no bundle on disk", opts, async () => {
  const b = makeBundle("1.0.0", files("a"));
  const { srv, url } = await served(b);
  const w = world();
  try {
    await applyFill({ ...w, games: GAMES, url, pack: b.pack, bin });
    fs.rmSync(path.join(w.packDir, "info/fceumm_libretro.info"));
    fs.rmSync(path.join(w.dataDir, "retro-pack-cache"), { recursive: true });
    const plan = await describeFill({ ...w, games: GAMES, systems: {}, cacheDir: path.join(w.dataDir, "retro-pack-cache/1.0.0"), pack: b.pack });
    assert.equal(plan.needsBundle, true);
    assert.deepEqual(plan.missing, { info: 1, assets: 0, autoconfig: 0 });
    const out = await applyFill({ ...w, games: GAMES, url, pack: b.pack, bin });
    assert.notEqual(out.skipped, true);
    assert.equal(out.installed, 1);
    assert.match(fs.readFileSync(path.join(w.packDir, "info/fceumm_libretro.info"), "utf8"), /NES/);
  } finally { srv.close(); }
});
