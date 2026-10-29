import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { DEFAULT_SYSTEMS } from "../../src/retro/systems.js";
import { createHashDb, parseDat, slimRows } from "../../src/retro/hash-db.js";
import { createDropHasher } from "../../src/meta/drop-hash.js";
import { createOrganizer } from "../../src/meta/library-organize.js";
import { createIdentifier } from "../../src/meta/file-identity.js";

const crcOf = (buf) => (zlib.crc32(buf) >>> 0).toString(16).padStart(8, "0");
const DAT = (rows) => `clrmamepro (\n\tname "Test"\n\tversion "1"\n)\n\n${rows.map(([n, rom, size, crc]) => `game (\n\tname "${n}"\n\trom ( name "${rom}" size ${size} crc ${crc.toUpperCase()} md5 00 sha1 00 )\n)\n`).join("")}`;

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "cook-hashdb-"));

test("a .dat is read into game names, rom sizes and lower case crcs", () => {
  const rows = parseDat(DAT([["Golden Sun (USA)", "Golden Sun (USA).gba", 8, "ABCDEF01"]]));
  assert.deepEqual(rows, [{ name: "Golden Sun (USA)", rom: "Golden Sun (USA).gba", size: 8, crc: "abcdef01" }]);
  assert.deepEqual(slimRows(rows), { abcdef01: ["Golden Sun (USA)", 8] });
});

test("refresh keeps one small index per system and lookup finds a dump by crc and size", async () => {
  const dir = tmp();
  try {
    const asked = [];
    const db = createHashDb({
      dir,
      base: "https://example.com/metadat",
      download: async (url, dest) => {
        asked.push(url);
        if (url.includes("/redump/")) return { status: 404 };
        fs.writeFileSync(dest, DAT([["Pong (World)", "Pong.gb", 4, "11111111"]]));
        return { status: 200, bytes: 1 };
      },
    });
    const res = await db.refresh({ gb: { libretro: "Nintendo - Game Boy" }, tool: {} });
    assert.deepEqual(res, { indexed: 1, failed: 0 });
    assert.equal(asked[0], "https://example.com/metadat/no-intro/Nintendo%20-%20Game%20Boy.dat");
    assert.deepEqual(db.lookup("11111111", 4), [{ system: "gb", name: "Pong (World)", size: 4 }]);
    assert.deepEqual(db.lookup("11111111", 5), [], "a different size is a different file");
    assert.deepEqual(db.lookup("22222222"), []);
    assert.equal(db.status().systems, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a system whose list cannot be had is counted as failed and the others still index", async () => {
  const dir = tmp();
  try {
    const db = createHashDb({ dir, download: async () => ({ status: 404 }) });
    assert.deepEqual(await db.refresh({ gb: { libretro: "x" } }), { indexed: 0, failed: 1 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a sweep sorts ROMs by their hash, ahead of the extension and the folder they were dropped in", async () => {
  const root = tmp();
  const old = (Date.now() - 10 * 60_000) / 1000;
  const put = (rel, body) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
    fs.utimesSync(abs, old, old);
  };
  try {
    const md = Buffer.from("a mega drive game");
    put("incoming/snes/in-wrong-folder.bin", md); // .bin names no console; the folder says snes, which does not play .bin
    put("incoming/loose.bin", Buffer.from("another mega drive game")); // nowhere to go but its hash
    put("incoming/unknown.bin", Buffer.from("nobody lists this"));
    put("incoming/Whatever Name.sfc", Buffer.from("a snes game")); // the extension already says it
    const lists = new Map([
      [crcOf(md), { system: "md", name: "Sonic (USA)" }],
      [crcOf(Buffer.from("another mega drive game")), { system: "md", name: "Columns (USA)" }],
    ]);
    const hasher = createDropHasher({ lookup: (crc) => (lists.has(crc) ? [lists.get(crc)] : []) });
    const make = (identifyRoms) => createOrganizer({
      incomingDir: path.join(root, "incoming"),
      romsDir: path.join(root, "games"),
      retroDir: path.join(root, "retro"),
      homebrewDir: path.join(root, "homebrew"),
      systems: () => DEFAULT_SYSTEMS,
      readRefs: async () => [],
      romsRels: async () => [],
      ...createIdentifier({ readIdentity: async () => null, readTicketNames: async () => [] }),
      nameOf: () => null,
      begin: () => ({ step() {}, done() {} }),
      rescan: () => {},
      rescanRetro: () => {},
      rescanHomebrew: () => {},
      identifyRoms,
    });
    // Before: without a database only the extension and the folder decide.
    const before = make(undefined);
    assert.equal((await before.sweep()).moved, 1);
    assert.deepEqual(before.view().held.map((h) => h.rel).sort(), ["loose.bin", "snes/in-wrong-folder.bin", "unknown.bin"]);
    // After: the hash decides.
    const after = make((files, refs, systems) => hasher.identify(files, refs, systems));
    assert.equal((await after.sweep()).moved, 2);
    assert.ok(fs.existsSync(path.join(root, "retro/roms/md/in-wrong-folder.bin")));
    assert.ok(fs.existsSync(path.join(root, "retro/roms/md/loose.bin")));
    assert.deepEqual(after.view().recent.slice(0, 2).map((m) => [m.by, m.dbName]).sort(), [["hash", "Columns (USA)"], ["hash", "Sonic (USA)"]]);
    assert.deepEqual(after.view().held.map((h) => h.rel), ["unknown.bin"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
