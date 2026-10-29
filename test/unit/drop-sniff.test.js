import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_SYSTEMS } from "../../src/retro/systems.js";
import { sniffSystems, systemOfHead, systemOfZip } from "../../src/meta/drop-sniff.js";
import { planExtras } from "../../src/meta/incoming-extras.js";

const at = (offset, text, size = 40000) => {
  const buf = Buffer.alloc(size);
  buf.write(text, offset, "latin1");
  return buf;
};
const pvd = (offset, system) => {
  const buf = at(offset, "\x01CD001\x01");
  buf.write(system.padEnd(32), offset + 8, "latin1");
  return buf;
};

test("a disc or cartridge image's header names its console", () => {
  assert.equal(systemOfHead(at(0, "SEGA SEGASATURN ")), "saturn");
  assert.equal(systemOfHead(at(16, "SEGA SEGASATURN ")), "saturn", "a raw image after its sync bytes");
  assert.equal(systemOfHead(at(16, "SEGADISCSYSTEM  ")), "segacd");
  assert.equal(systemOfHead(at(0x100, "SEGA MEGA DRIVE ")), "md");
  assert.equal(systemOfHead(pvd(16 * 2352 + 24, "PLAYSTATION")), "ps1");
  assert.equal(systemOfHead(pvd(16 * 2048, "PSP GAME")), "psp");
  assert.equal(systemOfHead(pvd(16 * 2048, "PLAYSTATION")), null, "a cooked PLAYSTATION image may be a PS2 DVD");
  assert.equal(systemOfHead(Buffer.from("# my notes\n")), null);
});

test("a zip is the console its ROMs name, else the arcade set its name is", () => {
  assert.equal(systemOfZip("Tetris", ["Tetris.gb", "readme.txt"], DEFAULT_SYSTEMS), "gb");
  assert.equal(systemOfZip("Sonic", ["Sonic.gen"], DEFAULT_SYSTEMS), "md");
  assert.equal(systemOfZip("sf2", ["sf2e_30g.11e", "sf2e_37b.11f", "sf2_06.bin"], DEFAULT_SYSTEMS), "arcade");
  assert.equal(systemOfZip("Mixed", ["a.gb", "b.gba"], DEFAULT_SYSTEMS), null);
  assert.equal(systemOfZip("Stuff", ["photo.jpg"], DEFAULT_SYSTEMS), null);
});

test("files dropped loose are planned by what their bytes say; notes stay", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cook-sniff-"));
  try {
    const put = (rel, buf) => {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), buf);
    };
    put("Sonic.md", at(0x100, "SEGA GENESIS    ", 1024));
    put("notes.md", Buffer.from("# notes\n"));
    put("FF7/FF7.cue", Buffer.from('FILE "FF7.bin" BINARY\n'));
    put("FF7/FF7.bin", pvd(16 * 2352 + 24, "PLAYSTATION"));
    put("Nights.iso", at(0, "SEGA SEGASATURN "));
    const items = ["Sonic.md", "notes.md", "FF7/FF7.cue", "FF7/FF7.bin", "Nights.iso"].map((rel) => ({ rel, abs: path.join(dir, rel) }));
    const refs = new Map([["FF7/FF7.cue", ["FF7/FF7.bin"]]]);
    const sniffed = await sniffSystems(items, refs, DEFAULT_SYSTEMS);
    const p = planExtras({ items, refs, sniffed, systems: DEFAULT_SYSTEMS });
    assert.deepEqual(p.moves.map((m) => [m.from, m.to]).sort(), [
      ["FF7/FF7.bin", "roms/ps1/FF7/FF7.bin"],
      ["FF7/FF7.cue", "roms/ps1/FF7/FF7.cue"],
      ["Sonic.md", "roms/md/Sonic.md"],
    ]);
    assert.deepEqual(p.held.map((h) => [h.rel, h.code]).sort(), [["Nights.iso", "wrongExtension"], ["notes.md", "noSystem"]]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
