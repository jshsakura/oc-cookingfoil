import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import { DEFAULT_SYSTEMS } from "../../src/retro/systems.js";
import { listArchive, parseSlt } from "../../src/helpers/seven-zip-list.js";
import { createDropHasher } from "../../src/meta/drop-hash.js";
import { sniffSystems, playstationOfCnf, isoRecords } from "../../src/meta/drop-sniff.js";
import { createOrganizer } from "../../src/meta/library-organize.js";
import { createIdentifier } from "../../src/meta/file-identity.js";
import { sevenZipBin } from "../../src/retro/pack-bundle.js";

const bin = sevenZipBin();
const crcOf = (buf) => (zlib.crc32(buf) >>> 0).toString(16).padStart(8, "0");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "cook-formats-"));
const old = () => (Date.now() - 10 * 60_000) / 1000;

/** A cooked (2048-byte sector) ISO 9660 image saying PLAYSTATION, with a SYSTEM.CNF holding `cnf` (none when null). */
function cookedIso(cnf) {
  const img = Buffer.alloc(2048 * 24);
  const pvd = 16 * 2048;
  img.write("\x01CD001\x01", pvd, "latin1");
  img.write("PLAYSTATION".padEnd(32), pvd + 8, "latin1");
  const rec = (at, name, lba, size) => {
    img[at] = 33 + name.length + (name.length % 2 ? 0 : 1);
    img.writeUInt32LE(lba, at + 2);
    img.writeUInt32LE(size, at + 10);
    img[at + 32] = name.length;
    img.write(name, at + 33, "latin1");
    return img[at];
  };
  rec(pvd + 156, "\0", 18, 2048);
  if (cnf !== null) {
    rec(18 * 2048, "SYSTEM.CNF;1", 19, cnf.length);
    img.write(cnf, 19 * 2048, "latin1");
  }
  return img;
}

test("SYSTEM.CNF tells a PS1 disc (BOOT) from a PS2 one (BOOT2)", () => {
  assert.equal(playstationOfCnf("BOOT = cdrom:\\SLUS_000.01;1\r\nTCB = 4\r\n"), "ps1");
  assert.equal(playstationOfCnf("BOOT2 = cdrom0:\\SLUS_200.01;1\nVER = 1.00\n"), "ps2");
  assert.equal(playstationOfCnf("nothing"), null);
  assert.deepEqual(isoRecords(cookedIso("BOOT = x").subarray(18 * 2048, 19 * 2048)).map((r) => r.name), ["SYSTEM.CNF;1"]);
});

test("a 7-Zip listing gives each file's size and CRC-32 without unpacking", async (t) => {
  if (!bin) return t.skip("no 7-Zip");
  const dir = tmp();
  try {
    const rom = Buffer.from("a gba rom body");
    fs.writeFileSync(path.join(dir, "Game.gba"), rom);
    assert.equal(spawnSync(bin, ["a", "-bd", path.join(dir, "g.7z"), path.join(dir, "Game.gba")], { stdio: "ignore" }).status, 0);
    const [e] = await listArchive(path.join(dir, "g.7z"), { bin });
    assert.deepEqual([e.name.endsWith("Game.gba"), e.size, e.crc32], [true, rom.length, crcOf(rom)]);
    assert.deepEqual(await listArchive(path.join(dir, "missing.7z"), { bin }), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("parseSlt keeps files and drops folders and encrypted entries", () => {
  const text = "Path = a.gba\nSize = 4\nCRC = ABCDEF01\nAttributes = A\n\nPath = dir\nFolder = +\nAttributes = D\n\nPath = s.gba\nEncrypted = +\nCRC = 11111111\n";
  assert.deepEqual(parseSlt(text), [{ name: "a.gba", size: 4, crc32: "abcdef01" }]);
});

function setup(files, lists = {}, ko = {}) {
  const root = tmp();
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (body instanceof Function) body(abs); else fs.writeFileSync(abs, body);
    fs.utimesSync(abs, old(), old());
  }
  const reads = [];
  const hasher = createDropHasher({ lookup: (crc) => { reads.push(crc); return lists[crc] ?? []; }, lookupKo: (crc) => ko[crc] ?? [] });
  const org = createOrganizer({
    incomingDir: path.join(root, "incoming"),
    romsDir: path.join(root, "games"),
    retroDir: path.join(root, "retro"),
    homebrewDir: path.join(root, "homebrew"),
    systems: () => DEFAULT_SYSTEMS,
    readRefs: async (abs) => (abs.endsWith(".cue") ? [fs.readFileSync(abs, "latin1").match(/FILE "([^"]+)"/)[1]] : []),
    romsRels: async () => [],
    ...createIdentifier({ readIdentity: async () => null, readTicketNames: async () => [] }),
    nameOf: () => null,
    begin: () => ({ step() {}, done() {} }),
    rescan: () => {},
    rescanRetro: () => {},
    rescanHomebrew: () => {},
    identifyRoms: (f, r, s) => hasher.identify(f, r, s),
  });
  return { root, org, reads };
}

test("a .7z with one listed ROM is sorted and named by its CRC; a .chd is never read in full", async (t) => {
  if (!bin) return t.skip("no 7-Zip");
  const rom = Buffer.from("a gba rom body");
  const { root, org, reads } = setup(
    {
      "incoming/pack.7z": (abs) => {
        const src = path.join(path.dirname(abs), "Whatever.gba");
        fs.writeFileSync(src, rom);
        spawnSync(bin, ["a", "-bd", abs, src], { stdio: "ignore" });
        fs.rmSync(src);
      },
      "incoming/disc.chd": Buffer.from("MComprHD".padEnd(4096, "x")),
    },
    { [crcOf(rom)]: [{ system: "gba", name: "Golden Sun (USA)" }] },
  );
  try {
    await org.sweep();
    assert.ok(fs.existsSync(path.join(root, "retro/roms/gba/Golden Sun (USA).7z")));
    assert.deepEqual(reads, [crcOf(rom)], "the .chd was not hashed");
    assert.deepEqual(org.view().held.map((h) => h.rel), ["disc.chd"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a cooked PLAYSTATION image: BOOT goes to ps1, BOOT2 is held as PS2, no SYSTEM.CNF is held as unsure", async () => {
  const { root, org } = setup({
    "incoming/one/one.cue": 'FILE "one.iso" BINARY\n  TRACK 01 MODE1/2048\n    INDEX 01 00:00:00\n',
    "incoming/one/one.iso": cookedIso("BOOT = cdrom:\\SLUS_000.01;1\n"),
    "incoming/two.iso": cookedIso("BOOT2 = cdrom0:\\SLUS_200.01;1\n"),
    "incoming/three.iso": cookedIso(null),
  });
  try {
    await org.sweep();
    assert.ok(fs.existsSync(path.join(root, "retro/roms/ps1/one/one.iso")), "a cue over a cooked PS1 image goes to ps1");
    const held = Object.fromEntries(org.view().held.map((h) => [h.rel, h.code]));
    assert.deepEqual(held, { "two.iso": "ps2", "three.iso": "psUnsure" });
    assert.deepEqual([...await sniffSystems([{ rel: "x.iso", abs: path.join(root, "incoming/three.iso") }], new Map(), DEFAULT_SYSTEMS)], [["x.iso", "psUnsure"]]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a Korean-patched ROM no list has is placed and named by the retro database's own hashes", async () => {
  const patched = Buffer.from("korean patched rom");
  const original = Buffer.from("original rom");
  const { root, org } = setup(
    { "incoming/anything.bin": patched, "incoming/Orig.bin": original },
    { [crcOf(original)]: [{ system: "md", name: "Phantasy Star (USA)" }] },
    { [crcOf(patched)]: [{ system: "md", ko: "판타지 스타", en: "Phantasy Star (Korean Translation)" }], [crcOf(original)]: [{ system: "md", ko: "판타지 스타", en: null }] },
  );
  try {
    assert.equal((await org.sweep()).moved, 2);
    assert.ok(fs.existsSync(path.join(root, "retro/roms/md/판타지 스타 (Phantasy Star (Korean Translation)).bin")), "no list has it; the database names it");
    assert.ok(fs.existsSync(path.join(root, "retro/roms/md/판타지 스타 (Phantasy Star (USA)).bin")), "the list names the original, the database adds the Korean title");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
