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

test("a patch folder with a readme and a dot file, undone through the journal, stays in the drop box until it changes", async () => {
  const root = fs.mkdtempSync(path.join(tmp, "b-"));
  const incoming = { key: "incoming", dir: path.join(root, "incoming") };
  const patches = { key: "patches", dir: path.join(root, "patches") };
  fs.mkdirSync(incoming.dir, { recursive: true });
  const placedAt = "0100AAAA00000000/Korean Patch";
  put(patches.dir, `${placedAt}/atmosphere/contents/0100AAAA00000000/exefs/main`, "main");
  put(patches.dir, `${placedAt}/atmosphere/contents/0100AAAA00000000/romfs/a.bin`, "ab");
  put(patches.dir, `${placedAt}/README.md`, "read me");
  put(patches.dir, `${placedAt}/.DS_Store`, "junk");
  const line = await journal.recordMove({ action: "organize", fromRoot: incoming, from: "Korean Patch", toRoot: patches, to: placedAt });
  await journal.undoMove([incoming, patches], line.id);
  let placed = 0;
  const org = organizer(root, { undone: () => journal.undoneHeld([incoming, patches], "incoming"), placeFolder: async () => { placed++; return {}; } });
  await org.sweep();
  assert.equal(placed, 0, "left where the undo put it");
  assert.ok(org.view().held.length > 0 && org.view().held.every((h) => h.code === "undone"));
  put(incoming.dir, "Korean Patch/atmosphere/contents/0100AAAA00000000/romfs/b.bin", "more");
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
