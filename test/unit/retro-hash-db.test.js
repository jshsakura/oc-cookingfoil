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
    assert.ok(fs.existsSync(path.join(root, "retro/roms/md/Sonic (USA).bin")));
    assert.ok(fs.existsSync(path.join(root, "retro/roms/md/Columns (USA).bin")));
    assert.deepEqual(after.view().recent.slice(0, 2).map((m) => [m.by, m.dbName]).sort(), [["hash", "Columns (USA)"], ["hash", "Sonic (USA)"]]);
    assert.deepEqual(after.view().held.map((h) => h.rel), ["unknown.bin"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const setup = (files, lists, { cue = false } = {}) => {
  const root = tmp();
  const old = (Date.now() - 10 * 60_000) / 1000;
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
    fs.utimesSync(abs, old, old);
  }
  const hasher = createDropHasher({ lookup: (crc) => lists[crc] ?? [] });
  const org = createOrganizer({
    incomingDir: path.join(root, "incoming"),
    romsDir: path.join(root, "games"),
    retroDir: path.join(root, "retro"),
    homebrewDir: path.join(root, "homebrew"),
    systems: () => DEFAULT_SYSTEMS,
    readRefs: async (abs) => (cue ? [fs.readFileSync(abs, "latin1").match(/FILE "([^"]+)"/)[1]] : []),
    romsRels: async () => [],
    ...createIdentifier({ readIdentity: async () => null, readTicketNames: async () => [] }),
    nameOf: () => null,
    begin: () => ({ step() {}, done() {} }),
    rescan: () => {},
    rescanRetro: () => {},
    rescanHomebrew: () => {},
    identifyRoms: async (f, r, s) => {
      const found = await hasher.identify(f, r, s);
      for (const d of found.values()) if (d.name.startsWith("Dragon")) d.ko = "드래곤 퀘스트";
      return found;
    },
  });
  return { root, org };
};

test("a game's discs go into one folder named after the list, with an .m3u made for it", async () => {
  const d1 = Buffer.from("disc one"), d2 = Buffer.from("disc two");
  const { root, org } = setup(
    { "incoming/a.chd": d1, "incoming/b.chd": d2, "incoming/lone.chd": Buffer.from("lone") },
    {
      [crcOf(d1)]: [{ system: "ps1", name: "Final Fantasy VII (USA) (Disc 1)" }],
      [crcOf(d2)]: [{ system: "ps1", name: "Final Fantasy VII (USA) (Disc 2)" }],
      [crcOf(Buffer.from("lone"))]: [{ system: "ps1", name: "Crash Bandicoot (USA)" }],
    },
  );
  try {
    assert.equal((await org.sweep()).moved, 3);
    const dir = path.join(root, "retro/roms/ps1/Final Fantasy VII (USA)");
    assert.deepEqual(fs.readdirSync(dir).sort(), ["Final Fantasy VII (USA) (Disc 1).chd", "Final Fantasy VII (USA) (Disc 2).chd", "Final Fantasy VII (USA).m3u"]);
    assert.equal(fs.readFileSync(path.join(dir, "Final Fantasy VII (USA).m3u"), "utf8"), "Final Fantasy VII (USA) (Disc 1).chd\nFinal Fantasy VII (USA) (Disc 2).chd\n");
    assert.ok(fs.existsSync(path.join(root, "retro/roms/ps1/Crash Bandicoot (USA).chd")), "a single disc stays a file");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a cue and its tracks keep their file names inside a folder named after the list, and a known Korean title leads the name", async () => {
  const bin = Buffer.from("track one");
  const rom = Buffer.from("a rom");
  const { root, org } = setup(
    { "incoming/x.cue": 'FILE "x.bin" BINARY\n', "incoming/x.bin": bin, "incoming/dq.sfc": rom },
    { [crcOf(bin)]: [{ system: "ps1", name: "Wild Arms (USA)" }], [crcOf(rom)]: [{ system: "snes", name: "Dragon Quest III (Japan)" }] },
    { cue: true },
  );
  try {
    assert.equal((await org.sweep()).moved, 3);
    assert.deepEqual(fs.readdirSync(path.join(root, "retro/roms/ps1/Wild Arms (USA)")).sort(), ["x.bin", "x.cue"]);
    assert.ok(fs.existsSync(path.join(root, "retro/roms/snes/드래곤 퀘스트 (Dragon Quest III (Japan)).sfc")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a disc whose sibling is not in the drop box stays one file named after the list", async () => {
  const d1 = Buffer.from("only disc one");
  const { root, org } = setup({ "incoming/a.chd": d1 }, { [crcOf(d1)]: [{ system: "ps1", name: "Xenogears (USA) (Disc 1)" }] });
  try {
    await org.sweep();
    assert.ok(fs.existsSync(path.join(root, "retro/roms/ps1/Xenogears (USA) (Disc 1).chd")));
    assert.ok(!fs.existsSync(path.join(root, "retro/roms/ps1/Xenogears (USA)")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
