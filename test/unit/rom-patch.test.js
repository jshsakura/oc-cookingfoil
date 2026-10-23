import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import express from "express";

// A patch file the admin drops on one retro ROM: the original is backed up outside the trash,
// the ROM is replaced under its own name, a wrong source leaves it untouched, and restoring
// puts the original back. Every byte here is made up.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "rom-patch-"));
process.env.COOK_DATA_DIR = path.join(root, "data");
process.env.COOK_RETRO_DIR = path.join(root, "retro");
process.env.COOK_RATING_SYNC = "false";
process.env.COOK_RETRO_AUTO_CORES = "false";
const retro = process.env.COOK_RETRO_DIR;

const rom = (n, seed) => Buffer.from(Array.from({ length: n }, (_, i) => (i * seed + 7) & 0xff));
const crc = (buf) => zlib.crc32(buf) >>> 0;
const put = (rel, body) => {
  fs.mkdirSync(path.dirname(path.join(retro, rel)), { recursive: true });
  fs.writeFileSync(path.join(retro, rel), body);
};
const read = (rel) => fs.readFileSync(path.join(retro, rel));

// ---- patch writers, just enough of each format ----

/** BPS/UPS numbers. */
function num(n) {
  const out = [];
  for (;;) {
    const x = n % 128;
    n = Math.floor(n / 128);
    if (n === 0) {
      out.push(0x80 | x);
      return Buffer.from(out);
    }
    out.push(x);
    n--;
  }
}

/** An IPS patch of [offset, bytes] records and [offset, count, value] runs. */
function ips(records, { truncate } = {}) {
  const parts = [Buffer.from("PATCH")];
  for (const r of records) {
    const head = Buffer.alloc(5);
    head.writeUIntBE(r[0], 0, 3);
    if (Buffer.isBuffer(r[1])) {
      head.writeUInt16BE(r[1].length, 3);
      parts.push(head, r[1]);
    } else {
      head.writeUInt16BE(0, 3);
      const run = Buffer.alloc(3);
      run.writeUInt16BE(r[1], 0);
      run[2] = r[2];
      parts.push(head, run);
    }
  }
  parts.push(Buffer.from("EOF"));
  if (truncate !== undefined) {
    const t = Buffer.alloc(3);
    t.writeUIntBE(truncate, 0, 3);
    parts.push(t);
  }
  return Buffer.concat(parts);
}

const withFooter = (body, source, target) => {
  const sums = Buffer.alloc(8);
  sums.writeUInt32LE(crc(source), 0);
  sums.writeUInt32LE(crc(target), 4);
  const head = Buffer.concat([body, sums]);
  const own = Buffer.alloc(4);
  own.writeUInt32LE(crc(head), 0);
  return Buffer.concat([head, own]);
};

/** A BPS patch from `actions`: ["read", n] | ["data", bytes] | ["src", delta, n] | ["tgt", delta, n]. */
function bps(source, target, actions, meta = Buffer.alloc(0)) {
  const parts = [Buffer.from("BPS1"), num(source.length), num(target.length), num(meta.length), meta];
  const signed = (d) => num(Math.abs(d) * 2 + (d < 0 ? 1 : 0));
  for (const [kind, a, b] of actions) {
    if (kind === "read") parts.push(num((a - 1) * 4));
    if (kind === "data") parts.push(num((a.length - 1) * 4 + 1), a);
    if (kind === "src") parts.push(num((b - 1) * 4 + 2), signed(a));
    if (kind === "tgt") parts.push(num((b - 1) * 4 + 3), signed(a));
  }
  return withFooter(Buffer.concat(parts), source, target);
}

/** A UPS patch turning `source` into `target`. */
function ups(source, target) {
  const parts = [Buffer.from("UPS1"), num(source.length), num(target.length)];
  const at = (buf, i) => (i < buf.length ? buf[i] : 0);
  let last = 0;
  for (let i = 0; i < target.length; ) {
    if (at(source, i) === at(target, i)) {
      i++;
      continue;
    }
    parts.push(num(i - last));
    const run = [];
    while (i < target.length && at(source, i) !== at(target, i)) run.push(at(source, i) ^ at(target, i++));
    parts.push(Buffer.from(run), Buffer.from([0]));
    last = i + 1;
    i++;
  }
  return withFooter(Buffer.concat(parts), source, target);
}

const hasXdelta = (() => {
  try {
    execFileSync("xdelta3", ["-V"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

// ---- the library ----

const SOURCE = rom(0x400, 3);
const TARGET = Buffer.concat([SOURCE.subarray(0, 0x100), Buffer.from("KOREAN PATCHED!!"), SOURCE.subarray(0x110), Buffer.alloc(0x40, 0x5a)]);
const BPS_PATCH = bps(SOURCE, TARGET, [["read", 0x100], ["data", Buffer.from("KOREAN PATCHED!!")], ["src", 0x110, 0x400 - 0x110], ["data", Buffer.from([0x5a])], ["tgt", 0x400, 0x3f]]);
put("roms/gba/Plain Quest (Japan).gba", SOURCE);
put("roms/gba/Other Quest (Japan).gba", rom(0x400, 5));
put("roms/gba/Zipped Quest (Japan).zip", zlib.deflateRawSync(Buffer.alloc(1))); // replaced below
put("roms/gba/Ips Quest (Japan).gba", rom(0x200, 9));

const catalog = await import("../../src/retro/catalog.js");
const { zipStore } = await import("../../src/helpers/zip-store.js");
const { zipEntries, entryData } = await import("../../src/helpers/zip-read.js");
const { applyIps } = await import("../../src/retro/patch-formats/ips.js");
const { applyBps } = await import("../../src/retro/patch-formats/bps.js");
const { applyUps } = await import("../../src/retro/patch-formats/ups.js");
const { applyRomPatch, restoreOriginal, patchFormat, ORIGINALS_DIR } = await import("../../src/retro/rom-patch.js");
const { patchOf, setPatch } = await import("../../src/retro/rom-patch-records.js");
const { default: retroRouter } = await import("../../src/routes/retro.js");
const { mountRetroPatchApi } = await import("../../src/routes/admin/retro-patch-api.js");
const { tokenBlocked } = await import("../../src/routes/admin-page.js");

const ZIP_ROM = rom(0x300, 11);
const README = Buffer.from("readme text");
put("roms/gba/Zipped Quest (Japan).zip", zipStore([{ name: "Zipped Quest (Japan).gba", data: ZIP_ROM }, { name: "readme.txt", data: README }]));

put("roms/gba/Trash Quest (Japan).gba", SOURCE);
const { trashGame, restoreEntry } = await import("../../src/retro/trash.js");

let server;
const url = (p) => `http://127.0.0.1:${server.address().port}${p}`;
const ADMIN = { "X-Test-Admin": "yes", "Accept-Language": "en" };
const get = async (p, headers = ADMIN) => (await fetch(url(p), { headers })).json();
const patchFile = (name, body) => {
  const abs = path.join(root, "incoming", name);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  return abs;
};
const upload = (id, name, body, headers = ADMIN) => {
  const fd = new FormData();
  fd.append("file", new Blob([body]), name);
  return fetch(url(`/admin/api/retro-patch/${id}/apply`), { method: "POST", headers, body: fd });
};
const gameByFile = async (file) => (await catalog.current(retro)).games.find((g) => g.file === file);

before(async () => {
  await catalog.scan(retro);
  const app = express();
  app.use(express.json());
  app.use("/api/retro", retroRouter());
  const admin = express.Router();
  const requireSession = (req, res) => {
    if (req.get("X-Test-Admin") === "yes") return true;
    res.status(401).json({ error: "2fa required" });
    return false;
  };
  mountRetroPatchApi(admin, requireSession);
  app.use("/admin", admin);
  server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
});
after(() => {
  server?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test("IPS records, runs, growth and the truncation size are applied", () => {
  const src = rom(0x20, 3);
  const out = applyIps(src, ips([[2, Buffer.from([1, 2, 3])], [0x1e, 4, 0xee]]));
  assert.equal(out.length, 0x22, "a record past the end grows the file");
  assert.deepEqual([...out.subarray(2, 5)], [1, 2, 3]);
  assert.deepEqual([...out.subarray(0x1e)], [0xee, 0xee, 0xee, 0xee]);
  assert.deepEqual(out.subarray(5, 0x1e), src.subarray(5, 0x1e));
  assert.equal(applyIps(src, ips([], { truncate: 0x10 })).length, 0x10);
  assert.throws(() => applyIps(src, Buffer.from("PATCH\x00\x00")), { code: "bad-patch" });
});

test("BPS builds the target from source reads, patch data, source copies and overlapping target copies", () => {
  const out = applyBps(SOURCE, BPS_PATCH);
  assert.deepEqual(out, TARGET);
  const withMeta = bps(SOURCE, TARGET, [["read", 0x100], ["data", Buffer.from("KOREAN PATCHED!!")], ["src", 0x110, 0x400 - 0x110], ["data", Buffer.alloc(0x40, 0x5a)]], Buffer.from("<patch/>"));
  assert.deepEqual(applyBps(SOURCE, withMeta), TARGET, "metadata is skipped");
});

test("BPS and UPS refuse a source that is not their own", () => {
  const other = rom(0x400, 5);
  assert.throws(() => applyBps(other, BPS_PATCH), { code: "source-mismatch" });
  assert.throws(() => applyUps(other, ups(SOURCE, TARGET)), { code: "source-mismatch" });
  const broken = Buffer.from(BPS_PATCH);
  broken[10] ^= 0xff;
  assert.throws(() => applyBps(SOURCE, broken), { code: "bad-patch" }, "a patch whose own CRC fails is refused");
});

test("UPS XORs runs into the source, growing and shrinking it", () => {
  assert.deepEqual(applyUps(SOURCE, ups(SOURCE, TARGET)), TARGET);
  const shorter = Buffer.from(SOURCE.subarray(0, 0x300));
  shorter[5] ^= 0x11;
  assert.deepEqual(applyUps(SOURCE, ups(SOURCE, shorter)), shorter);
});

test("the format comes from the patch's first bytes", () => {
  assert.equal(patchFormat(Buffer.from("PATCH")), "ips");
  assert.equal(patchFormat(BPS_PATCH), "bps");
  assert.equal(patchFormat(Buffer.from("UPS1....")), "ups");
  assert.equal(patchFormat(Buffer.from([0xd6, 0xc3, 0xc4, 0])), "xdelta");
  assert.equal(patchFormat(Buffer.from("hello")), null);
});

test("a BPS patch backs the original up, replaces the ROM under its name, and restore puts it back", async () => {
  const g = await gameByFile("Plain Quest (Japan).gba");
  const record = await applyRomPatch(retro, g, { patchPath: patchFile("ko.bps", BPS_PATCH), patchName: "ko.bps" });
  assert.deepEqual(read("roms/gba/Plain Quest (Japan).gba"), TARGET);
  assert.equal(record.backup, `${ORIGINALS_DIR}/${g.id}/Plain Quest (Japan).gba`);
  assert.deepEqual(read(record.backup), SOURCE, "the original is kept outside the trash");
  assert.deepEqual(record.patches.map((p) => [p.name, p.format, p.verified]), [["ko.bps", "bps", true]]);
  assert.deepEqual(fs.readdirSync(path.join(retro, "roms/gba")).filter((f) => f.startsWith(".")), [], "no work file is left beside the ROM");

  const restored = await restoreOriginal(retro, g.id);
  assert.equal(restored.file, "Plain Quest (Japan).gba");
  assert.deepEqual(read("roms/gba/Plain Quest (Japan).gba"), SOURCE);
  assert.equal(patchOf(g.id), null);
  assert.equal(fs.existsSync(path.join(retro, ORIGINALS_DIR, g.id)), false);
  await assert.rejects(restoreOriginal(retro, g.id), { code: "not-patched" });
});

test("a source that does not match leaves the ROM, the backup folder and the records untouched", async () => {
  const g = await gameByFile("Other Quest (Japan).gba");
  const before = read("roms/gba/Other Quest (Japan).gba");
  await assert.rejects(applyRomPatch(retro, g, { patchPath: patchFile("ko.bps", BPS_PATCH), patchName: "ko.bps" }), { code: "source-mismatch" });
  await assert.rejects(applyRomPatch(retro, g, { patchPath: patchFile("ko.ups", ups(SOURCE, TARGET)), patchName: "ko.ups" }), { code: "source-mismatch" });
  await assert.rejects(applyRomPatch(retro, g, { patchPath: patchFile("x.txt", "not a patch"), patchName: "x.txt" }), { code: "unknown-format" });
  assert.deepEqual(read("roms/gba/Other Quest (Japan).gba"), before);
  assert.equal(fs.existsSync(path.join(retro, ORIGINALS_DIR, g.id)), false);
  assert.equal(patchOf(g.id), null);
  assert.deepEqual(fs.readdirSync(path.join(retro, "roms/gba")).filter((f) => f.startsWith(".")), []);
});

test("an IPS patch is recorded as unverified, and a second patch goes on top of the first", async () => {
  const g = await gameByFile("Ips Quest (Japan).gba");
  const original = read("roms/gba/Ips Quest (Japan).gba");
  await applyRomPatch(retro, g, { patchPath: patchFile("a.ips", ips([[0, Buffer.from("AB")]])), patchName: "a.ips" });
  const record = await applyRomPatch(retro, g, { patchPath: patchFile("b.ips", ips([[2, Buffer.from("CD")]])), patchName: "b.ips" });
  assert.deepEqual(record.patches.map((p) => [p.name, p.verified]), [["a.ips", false], ["b.ips", false]]);
  assert.equal(read("roms/gba/Ips Quest (Japan).gba").subarray(0, 4).toString(), "ABCD");
  assert.deepEqual(read(record.backup), original, "the backup is still the original from before the first patch");
  await restoreOriginal(retro, g.id);
  assert.deepEqual(read("roms/gba/Ips Quest (Japan).gba"), original);
});

test("a zip ROM has the ROM inside patched and is zipped again with its other files", async () => {
  const g = await gameByFile("Zipped Quest (Japan).zip");
  const zipped = read("roms/gba/Zipped Quest (Japan).zip");
  const target = Buffer.from(ZIP_ROM);
  target.write("HANGUL", 0x40);
  await applyRomPatch(retro, g, { patchPath: patchFile("z.ups", ups(ZIP_ROM, target)), patchName: "z.ups" });
  const buf = read("roms/gba/Zipped Quest (Japan).zip");
  const entries = zipEntries(buf);
  assert.deepEqual(entries.map((e) => e.name), ["Zipped Quest (Japan).gba", "readme.txt"]);
  assert.deepEqual(entryData(buf, entries[0]), target);
  assert.deepEqual(entryData(buf, entries[1]), README);
  assert.equal(entries[0].method, 8, "zipped again deflated");
  await restoreOriginal(retro, g.id);
  assert.deepEqual(read("roms/gba/Zipped Quest (Japan).zip"), zipped);
});

test("xdelta goes through xdelta3, and its absence is a clear error", { skip: !hasXdelta && "xdelta3 is not installed" }, async () => {
  const g = await gameByFile("Other Quest (Japan).gba");
  const original = read("roms/gba/Other Quest (Japan).gba");
  const target = Buffer.from(original);
  target.write("XDELTA", 0x80);
  const work = path.join(root, "xd");
  fs.mkdirSync(work, { recursive: true });
  fs.writeFileSync(path.join(work, "src"), original);
  fs.writeFileSync(path.join(work, "tgt"), target);
  execFileSync("xdelta3", ["-e", "-f", "-s", path.join(work, "src"), path.join(work, "tgt"), path.join(work, "p.xdelta")]);
  const patch = fs.readFileSync(path.join(work, "p.xdelta"));
  await assert.rejects(applyRomPatch(retro, g, { patchPath: patchFile("p.xdelta", patch), patchName: "p.xdelta", bin: path.join(root, "no-such-xdelta3") }), { code: "xdelta-missing" });
  await assert.rejects(applyRomPatch(retro, await gameByFile("Plain Quest (Japan).gba"), { patchPath: patchFile("p.xdelta", patch), patchName: "p.xdelta" }), { code: "xdelta-failed" });
  assert.deepEqual(read("roms/gba/Plain Quest (Japan).gba"), SOURCE, "a refused xdelta leaves the ROM");
  const record = await applyRomPatch(retro, g, { patchPath: patchFile("p.xdelta", patch), patchName: "p.xdelta" });
  assert.equal(record.patches[0].format, "xdelta");
  assert.deepEqual(read("roms/gba/Other Quest (Japan).gba"), target);
  await restoreOriginal(retro, g.id);
  assert.deepEqual(read("roms/gba/Other Quest (Japan).gba"), original);
});

test("the admin API needs a session, and refuses unknown games, odd ids and a record pointing outside", async () => {
  const g = await gameByFile("Plain Quest (Japan).gba");
  assert.equal((await upload(g.id, "ko.bps", BPS_PATCH, {})).status, 401);
  assert.equal((await fetch(url("/admin/api/retro-patch"))).status, 401);
  assert.equal((await fetch(url(`/admin/api/retro-patch/${g.id}/restore`), { method: "POST" })).status, 401);
  const unknown = await upload("gba-0000000000", "ko.bps", BPS_PATCH);
  assert.equal(unknown.status, 404);
  assert.equal((await unknown.json()).code, "no-game");
  for (const id of ["..%2F..%2Fetc", "..", "gba-..%2Fx"]) {
    assert.equal((await upload(id, "ko.bps", BPS_PATCH)).status, 404, id);
    assert.equal((await fetch(url(`/admin/api/retro-patch/${id}/restore`), { method: "POST", headers: ADMIN })).status, 404, id);
  }
  const noFile = await fetch(url(`/admin/api/retro-patch/${g.id}/apply`), { method: "POST", headers: ADMIN, body: new FormData() });
  assert.equal((await noFile.json()).code, "one-file");
  // A record that someone pointed outside the retro folder is never followed.
  setPatch("gba-ffffffffff", { system: "gba", path: "../outside.gba", file: "outside.gba", backup: `${ORIGINALS_DIR}/gba-ffffffffff/outside.gba`, original: { size: 1 }, patches: [] });
  const outside = await fetch(url("/admin/api/retro-patch/gba-ffffffffff/restore"), { method: "POST", headers: ADMIN });
  assert.equal((await outside.json()).code, "outside");
  setPatch("gba-ffffffffff", null);
  assert.ok(tokenBlocked("POST", `/api/retro-patch/${g.id}/apply`), "automation tokens cannot apply");
  assert.ok(tokenBlocked("POST", `/api/retro-patch/${g.id}/restore`), "automation tokens cannot restore");
  assert.equal(tokenBlocked("GET", "/api/retro-patch"), false);
});

test("an uploaded patch marks the game as a Korean patch in the console list and the admin list until restored", async () => {
  const g = await gameByFile("Plain Quest (Japan).gba");
  const r = await upload(g.id, "Plain Quest KO.bps", BPS_PATCH);
  const body = await r.json();
  assert.equal(r.status, 200, JSON.stringify(body));
  assert.deepEqual(body.game.patch.patches.map((p) => [p.name, p.format, p.verified]), [["Plain Quest KO.bps", "bps", true]]);

  const listed = (await get("/api/retro/games?pageSize=50&variants=all")).games.find((x) => x.file === g.file);
  assert.deepEqual(listed.edition, { korean: true, source: "patch", applied: true });
  assert.equal(listed.id, g.id, "same name, same id");
  const one = await get(`/api/retro/games/${g.id}`);
  assert.equal(one.edition.applied, true);

  const status = await get("/admin/api/retro-patch?q=quest");
  assert.deepEqual(status.patched.map((x) => x.id), [g.id]);
  assert.ok(status.games.some((x) => x.id === g.id && x.patch), "search results carry the patch too");

  const bad = await upload((await gameByFile("Other Quest (Japan).gba")).id, "ko.bps", BPS_PATCH);
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).code, "source-mismatch");

  const back = await fetch(url(`/admin/api/retro-patch/${g.id}/restore`), { method: "POST", headers: ADMIN });
  assert.equal(back.status, 200);
  assert.deepEqual(read("roms/gba/Plain Quest (Japan).gba"), SOURCE);
  const after = (await get("/api/retro/games?pageSize=50&variants=all")).games.find((x) => x.file === g.file);
  assert.equal(after.edition, undefined);
  assert.deepEqual((await get("/admin/api/retro-patch")).patched, []);
});

test("a patched game sent to the trash takes its original along, and comes back still able to undo the patch", async () => {
  const g = await gameByFile("Trash Quest (Japan).gba");
  const record = await applyRomPatch(retro, g, { patchPath: patchFile("ko.bps", BPS_PATCH), patchName: "ko.bps" });
  const cat = await catalog.current(retro);
  const { entry, files } = await trashGame(retro, g, cat.systems[g.system]);
  assert.ok(files.includes(record.backup));
  assert.equal(fs.existsSync(path.join(retro, record.backup)), false, "the original left its folder");
  assert.deepEqual(read(path.join(".cookingfoil-trash", entry, record.backup)), SOURCE);

  await restoreEntry(retro, entry);
  assert.deepEqual(read(record.backup), SOURCE);
  await restoreOriginal(retro, g.id);
  assert.deepEqual(read("roms/gba/Trash Quest (Japan).gba"), SOURCE);
});
