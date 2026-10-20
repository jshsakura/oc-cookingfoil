import { test, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "retro-rom-hash-"));
process.env.COOK_DATA_DIR = root;

const romHashes = await import("../../src/retro/rom-hash.js");
const activity = await import("../../src/tasks/activity.js");

after(() => fs.rmSync(root, { recursive: true, force: true }));

const md5 = (buf) => crypto.createHash("md5").update(buf).digest("hex");
const rom = (n, seed) => Buffer.from(Array.from({ length: n }, (_, i) => (i * seed + 3) & 0xff));

function game(id, system, file, data) {
  const dir = fs.mkdtempSync(path.join(root, "roms-"));
  const abs = path.join(dir, file);
  if (data) fs.writeFileSync(abs, data);
  return { id, system, file, rel: file, abs };
}

test("a ROM is hashed once per file, and again after an in-place overwrite that keeps size and mtime", async () => {
  const a = game("nes-a1", "nes", "a.nes", rom(0x4000, 3));
  const arcade = game("arcade-k1", "arcade", "kof98.zip", Buffer.from("zip"));
  const disc = game("ps1-d1", "ps1", "d.chd", Buffer.from("disc"));
  assert.equal(romHashes.known(a), null, "nothing before the first pass");

  const first = await romHashes.pass([a, arcade, disc], { pauseMs: 0 });
  assert.equal(first.hashed, 2, "disc systems have no such hash");
  assert.equal(romHashes.known(a), md5(rom(0x4000, 3)));
  assert.equal(romHashes.known(arcade), md5("kof98"));
  assert.equal(romHashes.known(disc), null);
  assert.equal((await romHashes.pass([a, arcade, disc], { pauseMs: 0 })).hashed, 0, "unchanged files are not read again");

  // SMB-style copy: same size, mtime put back; only ctime moves.
  const st = fs.statSync(a.abs);
  fs.writeFileSync(a.abs, rom(0x4000, 5));
  fs.utimesSync(a.abs, st.atime, st.mtime);
  assert.equal(fs.statSync(a.abs).size, st.size);
  assert.equal((await romHashes.pass([a, arcade, disc], { pauseMs: 0 })).hashed, 1);
  assert.equal(romHashes.known(a), md5(rom(0x4000, 5)));
});

test("a removed game is forgotten, and an unreadable file gives null without stopping the pass", async () => {
  const a = game("nes-b1", "nes", "a.nes", rom(0x2000, 7));
  const b = game("nes-b2", "nes", "b.nes", rom(0x2000, 9));
  await romHashes.pass([a, b], { pauseMs: 0 });
  assert.ok(romHashes.known(b));
  await romHashes.pass([a], { pauseMs: 0 });
  assert.equal(romHashes.known(b), null, "gone from the catalog, gone from the store");

  // A folder named like a ROM: stat works, reading it does not.
  const broken = game("nes-b3", "nes", "broken.nes", null);
  fs.mkdirSync(broken.abs);
  const missing = game("nes-b4", "nes", "missing.nes", null);
  const r = await romHashes.pass([broken, missing, a], { pauseMs: 0 });
  assert.equal(r.hashed, 1, "the unreadable one is tried; a missing one has no file to key");
  assert.equal(romHashes.known(broken), null);
  assert.equal(romHashes.known(a), md5(rom(0x2000, 7)));
  assert.equal(await romHashes.hashOf(broken), null);
  assert.equal((await romHashes.pass([broken, missing, a], { pauseMs: 0 })).hashed, 0, "an unreadable file is not retried until it changes");
});

test("a pass with work shows in the activity menu", async () => {
  const a = game("nes-c1", "nes", "a.nes", rom(0x1000, 11));
  await romHashes.pass([a], { pauseMs: 0 });
  const seen = activity.list().recent;
  assert.ok(seen.some((e) => e.kind === "retro-hash" && /합니다$/.test(e.title)));
});

test("hashOf works out a hash on demand and keeps it for the pass", async () => {
  const a = game("gba-d1", "gba", "a.gba", rom(0x1000, 13));
  assert.equal(await romHashes.hashOf(a), md5(rom(0x1000, 13)));
  assert.equal(romHashes.known(a), md5(rom(0x1000, 13)));
  assert.equal((await romHashes.pass([a], { pauseMs: 0 })).hashed, 0);
});
