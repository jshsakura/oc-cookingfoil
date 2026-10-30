import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const data = fs.mkdtempSync(path.join(os.tmpdir(), "cook-dropfolders-data-"));
process.env.COOK_DATA_DIR = data;
const { DEFAULT_SYSTEMS } = await import("../../src/retro/systems.js");
const { planFolders } = await import("../../src/meta/drop-folders.js");
const { placeFolderKind } = await import("../../src/meta/folder-place.js");
const { createOrganizer } = await import("../../src/meta/library-organize.js");
const { createIdentifier } = await import("../../src/meta/file-identity.js");
after(() => fs.rmSync(data, { recursive: true, force: true }));

const items = (...rels) => rels.map((rel) => ({ rel }));

test("folders are told apart by what is in them", () => {
  const plan = planFolders(items(
    "Korean Patch/atmosphere/contents/0100AAAA00000000/exefs/main",
    "Korean Patch/readme.txt",
    "atmosphere/contents/0100BBBB00000000/exefs/main",
    "Cool Port/cool.nro", "Cool Port/data/a.bin",
    "0100CCCC00000000/save.sav",
    "Monkey/monkey.scummvm", "Monkey/data.001",
    "snes/game.sfc",
    "loose.gba",
  ), DEFAULT_SYSTEMS);
  assert.deepEqual(plan.groups.map((g) => [g.kind, g.root, g.body.name ?? null]), [["patch", "Korean Patch/", "Korean Patch"], ["homebrew", "Cool Port/", null]]);
  assert.deepEqual(plan.held.map((h) => [h.rel, h.code]).sort(), [
    ["0100CCCC00000000/save.sav", "save"], ["atmosphere/contents/0100BBBB00000000/exefs/main", "patchName"],
  ]);
  assert.deepEqual(plan.moves.map((m) => m.to).sort(), ["roms/ScummVM/Monkey/data.001", "roms/ScummVM/Monkey/monkey.scummvm"]);
  assert.deepEqual(plan.rest.map((i) => i.rel), ["snes/game.sfc", "loose.gba"]);
});

test("a patch folder dropped in the drop box lands in the patch folder through the upload page's own code", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cook-dropfolders-"));
  const old = (Date.now() - 10 * 60_000) / 1000;
  const put = (rel, body) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
    fs.utimesSync(abs, old, old);
  };
  try {
    put("incoming/Korean Patch/atmosphere/contents/0100AAAA00000000/exefs/main", "main");
    put("incoming/Korean Patch/atmosphere/contents/0100AAAA00000000/romfs/a.bin", "a");
    put("incoming/Monkey/monkey.scummvm", "x");
    put("incoming/Monkey/data.001", "d");
    put("incoming/0100CCCC00000000/save.sav", "s");
    const org = createOrganizer({
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
      placeFolder: async (kind, its, body) => {
        const work = path.join(root, "work");
        fs.mkdirSync(path.join(work, "in"), { recursive: true });
        try {
          return await placeFolderKind({ kind, items: its, body, work, fromFolder: true, rootOf: () => path.join(root, "patches") });
        } finally {
          fs.rmSync(work, { recursive: true, force: true });
        }
      },
    });
    const { moved } = await org.sweep();
    assert.equal(moved, 3, "the patch folder and the two ScummVM files");
    const patch = path.join(root, "patches/0100AAAA00000000/Korean Patch/atmosphere/contents/0100AAAA00000000");
    assert.deepEqual(fs.readdirSync(patch).sort(), ["exefs", "romfs"]);
    assert.ok(fs.existsSync(path.join(root, "retro/roms/ScummVM/Monkey/monkey.scummvm")));
    assert.ok(!fs.existsSync(path.join(root, "incoming/Korean Patch")), "the emptied folder is gone");
    assert.deepEqual(org.view().held.map((h) => [h.rel, h.code]), [["0100CCCC00000000/save.sav", "save"]]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
