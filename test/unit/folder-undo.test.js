import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cook-folder-undo-"));
process.env.COOK_DATA_DIR = path.join(tmp, "data");
const { DEFAULT_SYSTEMS } = await import("../../src/retro/systems.js");
const { createOrganizer } = await import("../../src/meta/library-organize.js");
const { createIdentifier } = await import("../../src/meta/file-identity.js");
const journal = await import("../../src/library/journal.js");
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const old = (Date.now() - 10 * 60_000) / 1000;
const put = (base, rel, body = "x") => {
  const abs = path.join(base, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  fs.utimesSync(abs, old, old);
};
const organizer = (root, extra) => createOrganizer({
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
  ...extra,
});

test("a folder the drop box placed is noted as one move, with what an undo must forget", async () => {
  const root = fs.mkdtempSync(path.join(tmp, "a-"));
  put(path.join(root, "incoming"), "Korean Patch/atmosphere/contents/0100AAAA00000000/exefs/main");
  const noted = [];
  const abs = path.join(root, "patches/0100AAAA00000000/Korean Patch");
  const org = organizer(root, {
    placeFolder: async () => ({ where: "0100AAAA00000000/Korean Patch", abs, rewrite: { type: "drop-patch", key: "k" } }),
    journal: async (m) => { noted.push(m); },
  });
  await org.sweep();
  assert.deepEqual(noted, [{ action: "organize", from: path.join(root, "incoming/Korean Patch"), to: abs, extra: { rewrite: { type: "drop-patch", key: "k" } } }]);
});

test("a folder undone back into the drop box stays whole while it is the same folder, and moves again once it changes", async () => {
  const root = fs.mkdtempSync(path.join(tmp, "b-"));
  const base = path.join(root, "incoming");
  put(base, "Korean Patch/atmosphere/contents/0100AAAA00000000/exefs/main", "main");
  put(base, "Korean Patch/atmosphere/contents/0100AAAA00000000/romfs/a.bin", "ab");
  let placed = 0;
  let held = [{ rel: "Korean Patch", dir: true, files: 2, size: 6, mtimeMs: 0 }];
  const org = organizer(root, { undone: () => held, placeFolder: async () => { placed++; return {}; } });
  await org.sweep();
  assert.equal(placed, 0, "left where the undo put it");
  assert.equal(org.view().held.length, 2);
  assert.ok(org.view().held.every((h) => h.code === "undone"));
  held = [{ rel: "Korean Patch", dir: true, files: 3, size: 6, mtimeMs: 0 }];
  await org.sweep();
  assert.equal(placed, 1, "a changed folder is sorted again");
});

test("the journal undoes a folder move and holds the folder, with its file count", async () => {
  const incoming = { key: "incoming", dir: path.join(tmp, "j-incoming") };
  const patches = { key: "patches", dir: path.join(tmp, "j-patches") };
  fs.mkdirSync(incoming.dir, { recursive: true });
  put(patches.dir, "0100AAAA00000000/Korean Patch/atmosphere/main", "main");
  put(patches.dir, "0100AAAA00000000/Korean Patch/readme", "r");
  const line = await journal.recordMove({ action: "organize", fromRoot: incoming, from: "Korean Patch", toRoot: patches, to: "0100AAAA00000000/Korean Patch", extra: { rewrite: { type: "drop-patch", key: "k" } } });
  let seen = null;
  await journal.undoMove([incoming, patches], line.id, { after: async (op) => { seen = op.rewrite; } });
  assert.deepEqual(seen, { type: "drop-patch", key: "k" });
  assert.ok(fs.existsSync(path.join(incoming.dir, "Korean Patch/atmosphere/main")));
  assert.ok(!fs.existsSync(path.join(patches.dir, "0100AAAA00000000")), "the emptied title folder goes");
  const [hold] = journal.undoneHeld([incoming, patches], "incoming");
  assert.deepEqual([hold.rel, hold.dir, hold.files, hold.size], ["Korean Patch", true, 2, 5]);
});
