import { test, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

// CRC-32, SHA-1 and SHA-256 of retro ROM files, read once per file version and
// matched against a made-up dictionary: no real dumps are involved.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "retro-rom-index-"));
process.env.COOK_DATA_DIR = root;

const romIndex = await import("../../src/retro/rom-index.js");
const koMatch = await import("../../src/retro/ko-match.js");
const { useKoreanNames } = await import("../../src/retro/ko-names.js");
const activity = await import("../../src/tasks/activity.js");

after(() => {
  useKoreanNames(null);
  fs.rmSync(root, { recursive: true, force: true });
});

const sha = (alg, buf) => crypto.createHash(alg).update(buf).digest("hex");
const crc = (buf) => (zlib.crc32(buf) >>> 0).toString(16).padStart(8, "0");
const rom = (n, seed) => Buffer.from(Array.from({ length: n }, (_, i) => (i * seed + 7) & 0xff));
const entryOf = (ko, en, buf) => [sha("sha256", buf).slice(0, 32), [ko, en, crc(buf), sha("sha1", buf).slice(0, 32)]];

const NES_BODY = rom(0x4000, 3);
const NES_FILE = Buffer.concat([Buffer.from("NES\x1a"), Buffer.alloc(12), NES_BODY]);
const GBA_ZIPPED = rom(0x3000, 5);
const GBA_PLAIN = rom(0x2000, 9);
const MD_TRACK = rom(0x1000, 11);
useKoreanNames({
  systems: {
    nes: Object.fromEntries([entryOf("헤더 없는 게임", "Headerless Game", NES_BODY)]),
    gba: Object.fromEntries([entryOf("압축 게임", "Zipped Game", GBA_ZIPPED), entryOf("평범한 게임", "Plain Game", GBA_PLAIN)]),
    segacd: Object.fromEntries([entryOf("디스크 게임", "Disc Game", MD_TRACK)]),
  },
  titles: {},
});

/** A zip of `files` ({ name: Buffer }), each deflated or stored. */
function zip(files, { store = false } = {}) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const body = store ? data : zlib.deflateRawSync(data);
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(store ? 0 : 8, 8);
    local.writeUInt32LE(zlib.crc32(data) >>> 0, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(store ? 0 : 8, 10);
    dir.writeUInt32LE(zlib.crc32(data) >>> 0, 16);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, body);
    central.push(dir, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

let n = 0;
function game(system, file, data) {
  const dir = fs.mkdtempSync(path.join(root, "roms-"));
  const abs = path.join(dir, file);
  if (data) fs.writeFileSync(abs, data);
  return { id: `${system}-${String(++n).padStart(10, "0")}`, system, name: path.parse(file).name, file, rel: file, abs };
}

test("a plain ROM gets all three hashes in one pass and is read again only when it changes", async () => {
  const g = game("gba", "Plain Game (USA).gba", GBA_PLAIN);
  const first = await romIndex.pass([g], { pauseMs: 0 });
  assert.equal(first.hashed, 1);
  assert.deepEqual(romIndex.known(g), { crc32: crc(GBA_PLAIN), sha1: sha("sha1", GBA_PLAIN), sha256: sha("sha256", GBA_PLAIN) });
  assert.deepEqual(koMatch.confirmed(g), { ko: "평범한 게임", en: "Plain Game", by: "sha256" });
  assert.equal((await romIndex.pass([g], { pauseMs: 0 })).hashed, 0, "an unchanged file is not read again");

  const other = rom(0x2000, 13);
  fs.writeFileSync(g.abs, other);
  fs.utimesSync(g.abs, new Date(), new Date(Date.now() + 5000));
  assert.equal((await romIndex.pass([g], { pauseMs: 0 })).hashed, 1, "a new mtime reads it again");
  assert.equal(romIndex.known(g).sha256, sha("sha256", other));
  assert.equal(koMatch.confirmed(g), null, "the new content is not in the dictionary");
  assert.ok(activity.list().recent.some((e) => e.kind === "retro-rom-index"), "a pass with work shows in the activity menu");
});

test("a file gone from the disk, or from the catalog, loses its row", async () => {
  const a = game("gba", "a.gba", rom(0x800, 3));
  const b = game("gba", "b.gba", rom(0x800, 5));
  await romIndex.pass([a, b], { pauseMs: 0 });
  assert.ok(romIndex.known(a) && romIndex.known(b));
  fs.rmSync(a.abs);
  await romIndex.pass([a, b], { pauseMs: 0 });
  assert.equal(romIndex.known(a), null, "deleted on disk while the catalog still listed it");
  await romIndex.pass([], { pauseMs: 0 });
  assert.equal(romIndex.known(b), null, "left the catalog");
});

test("an iNES header is left out for the second set of hashes, so a headerless dictionary entry matches", async () => {
  const g = game("nes", "Headerless Game (Japan).nes", NES_FILE);
  await romIndex.pass([g], { pauseMs: 0 });
  const row = romIndex.known(g);
  assert.equal(row.sha256, sha("sha256", NES_FILE));
  assert.deepEqual(row.bare, { crc32: crc(NES_BODY), sha1: sha("sha1", NES_BODY), sha256: sha("sha256", NES_BODY) });
  assert.equal(koMatch.confirmed(g).ko, "헤더 없는 게임");
});

test("a zip is matched by its largest file: the central directory CRC alone, inflated only when the CRC is known", async () => {
  const known = game("gba", "Zipped Game.zip", zip({ "readme.txt": Buffer.from("hi"), "Zipped Game.gba": GBA_ZIPPED }));
  const stored = game("gba", "Zipped Stored.zip", zip({ "Zipped Game.gba": GBA_ZIPPED }, { store: true }));
  const unknown = game("gba", "Other.zip", zip({ "Other.gba": rom(0x1800, 17) }));
  await romIndex.pass([known, stored, unknown], { pauseMs: 0 });

  assert.deepEqual(romIndex.known(known), { crc32: crc(GBA_ZIPPED), sha1: sha("sha1", GBA_ZIPPED), sha256: sha("sha256", GBA_ZIPPED), entry: "Zipped Game.gba" });
  assert.equal(koMatch.confirmed(known).by, "sha256");
  assert.equal(romIndex.known(stored).sha256, sha("sha256", GBA_ZIPPED), "a stored entry reads the same");
  assert.deepEqual(romIndex.known(unknown), { crc32: crc(rom(0x1800, 17)), entry: "Other.gba" }, "nothing to confirm: not inflated");
});

test("with a SHA known, a CRC-32 that collides does not name the game; without one the CRC does", () => {
  const sha256 = sha("sha256", Buffer.from("not in the dictionary"));
  assert.equal(koMatch.nameOfRow("gba", { crc32: crc(GBA_PLAIN), sha1: "0".repeat(40), sha256 }), null);
  assert.equal(koMatch.nameOfRow("gba", { crc32: crc(GBA_PLAIN), entry: "x.gba" }).by, "crc32");
  assert.equal(koMatch.nameOfRow("gba", { skip: "large" }), null);
});

test("a cue sheet is matched by its first track; big, compressed and 7z files are skipped without reading them", async () => {
  const cue = game("segacd", "Disc Game.cue", null);
  fs.writeFileSync(path.join(path.dirname(cue.abs), "Disc Game (Track 1).bin"), MD_TRACK);
  fs.writeFileSync(cue.abs, 'FILE "Disc Game (Track 1).bin" BINARY\n  TRACK 01 MODE1/2352\n    INDEX 01 00:00:00\n');
  const chd = game("segacd", "Disc Game.chd", Buffer.from("chd"));
  const sevenZip = game("gba", "Packed.7z", Buffer.from("7z"));
  const big = game("gba", "Huge.gba", null);
  fs.closeSync(fs.openSync(big.abs, "w"));
  fs.truncateSync(big.abs, romIndex.MAX_BYTES + 1); // sparse: no bytes are written
  await romIndex.pass([cue, chd, sevenZip, big], { pauseMs: 0 });

  assert.equal(romIndex.known(cue).entry, "Disc Game (Track 1).bin");
  assert.equal(koMatch.confirmed(cue).ko, "디스크 게임");
  assert.deepEqual(romIndex.known(chd), { skip: "format" });
  assert.deepEqual(romIndex.known(sevenZip), { skip: "format" });
  assert.deepEqual(romIndex.known(big), { skip: "large" });
  assert.equal(koMatch.confirmed(big), null);
});

test("systems the dictionary names nothing for, the arcade among them, are not read", async () => {
  const arcade = game("arcade", "sf2.zip", zip({ "a.bin": rom(0x100, 3) }));
  const psx = game("ps1", "Game.cue", Buffer.from("FILE \"x.bin\" BINARY\n"));
  assert.deepEqual(await romIndex.pass([arcade, psx], { pauseMs: 0 }), { hashed: 0, stopped: false });
  assert.equal(romIndex.known(arcade), null);
});

test("a pass the admin stops ends after the file it is on, and the rest is read next time", async () => {
  const games = [1, 2, 3].map((i) => game("gba", `s${i}.gba`, rom(0x400, 20 + i)));
  const seen = activity.subscribe((snap) => {
    const job = snap.running.find((e) => e.kind === "retro-rom-index");
    if (job?.current >= 1) activity.cancel(job.id);
  });
  try {
    const r = await romIndex.pass(games, { pauseMs: 300 });
    assert.equal(r.stopped, true);
    assert.ok(r.hashed < 3, `stopped early, read ${r.hashed}`);
  } finally {
    seen();
  }
  await romIndex.pass(games, { pauseMs: 0 });
  assert.ok(games.every((g) => romIndex.known(g)), "the next pass reads what was left");
});
