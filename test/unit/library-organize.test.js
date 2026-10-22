import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readCnmtIdentity } from "../../src/meta/cnmt-parse.js";
import {
  REASONS, createOrganizer, moveNoReplace, folderNameOf, isIncoming, planOrganize, taggedName,
} from "../../src/meta/library-organize.js";
import { createIdentifier, identityFromName, identityFromTicket } from "../../src/meta/file-identity.js";
import { EXTRA_REASONS } from "../../src/meta/incoming-extras.js";

const BASE = "0100AAAA00010000";
const UPD = "0100AAAA00010800";
const DLC = "0100AAAA00011001";
const OTHER = "0100BBBB00020000";
const OLD = Date.now() - 10 * 60_000;
const nameItem = (rel, extra = {}) => ({ rel, mtimeMs: OLD, id: identityFromName(rel), source: "name", ...extra });
const titles = { [BASE]: "마이 게임", [OTHER]: "Other: Game" };
const nameOf = (tid) => titles[tid] ?? null;

function cnmt({ titleId, version = 0, type, appId = null }) {
  const buf = Buffer.alloc(0x20 + 0x10);
  buf.writeBigUInt64LE(BigInt(`0x${titleId}`), 0);
  buf.writeUInt32LE(version, 8);
  buf[0x0C] = type;
  buf.writeUInt16LE(0x10, 0x0E);
  if (appId) buf.writeBigUInt64LE(BigInt(`0x${appId}`), 0x20);
  return buf;
}

test("a cnmt says what a package is and which game it belongs to", () => {
  assert.deepEqual(readCnmtIdentity(cnmt({ titleId: BASE, type: 0x80 })), { titleId: BASE, version: 0, kind: "base", baseTitleId: BASE });
  assert.deepEqual(readCnmtIdentity(cnmt({ titleId: UPD, version: 65536, type: 0x81, appId: BASE })), { titleId: UPD, version: 65536, kind: "update", baseTitleId: BASE });
  // An add-on's base comes from its extended header, not from id arithmetic.
  assert.equal(readCnmtIdentity(cnmt({ titleId: "0100CCCC0003F001", type: 0x82, appId: OTHER })).baseTitleId, OTHER);
  assert.equal(readCnmtIdentity(cnmt({ titleId: BASE, type: 0x01 })), null, "a system title is none of ours");
  assert.equal(readCnmtIdentity(Buffer.alloc(4)), null);
});

test("names: tags are kept or added, folder names are made safe, a ticket names its title", () => {
  assert.equal(taggedName(`Game [${BASE}][v0].nsp`, { titleId: BASE, version: 0 }), `Game [${BASE}][v0].nsp`);
  assert.equal(taggedName("Game.nsz", { titleId: BASE, version: 0 }), `Game [${BASE}][v0].nsz`);
  assert.equal(taggedName(`Game [${UPD}].nsp`, { titleId: UPD, version: 131072 }), `Game [${UPD}][v131072].nsp`);
  assert.equal(folderNameOf("Zelda: Echoes / Wisdom?"), "Zelda - Echoes Wisdom");
  assert.equal(folderNameOf("  .. "), null);
  assert.deepEqual(identityFromTicket(["a.nca", `${BASE.toLowerCase()}0000000000000012.tik`]), { titleId: BASE, version: null, kind: "base", baseTitleId: BASE });
  assert.equal(identityFromTicket(["a.nca"]), null);
  assert.ok(isIncoming("incoming/x.nsp", "incoming") && isIncoming("Incoming/a/b.nsp", "incoming"));
  assert.ok(!isIncoming("incomings/x.nsp", "incoming") && !isIncoming("Game/incoming/x.nsp", "incoming"));
  assert.ok(!isIncoming("incoming/x.nsp", null), "a drop box outside the games folder hides nothing in it");
});

test("a new game gets a folder named after it; its update and DLC follow, each tagged", () => {
  const plan = planOrganize({
    nameOf,
    incoming: [
      nameItem("dl/whatever.nsp", { id: { titleId: BASE, version: 0, kind: "base", baseTitleId: BASE }, source: "cnmt" }),
      nameItem("upd.nsp", { id: { titleId: UPD, version: 65536, kind: "update", baseTitleId: BASE }, source: "cnmt" }),
      nameItem(`costume [${DLC}][v0].nsp`),
    ],
  });
  assert.deepEqual(plan.moves.map((m) => m.to).sort(), [
    `마이 게임/DLC/costume [${DLC}][v0].nsp`,
    `마이 게임/update/upd [${UPD}][v65536].nsp`,
    `마이 게임/whatever [${BASE}][v0].nsp`,
  ]);
  assert.ok(plan.moves.every((m) => m.folderIsNew));
  assert.deepEqual(plan.held, []);
});

test("the game's folder already in the library is used, whatever the operator named it", () => {
  const plan = planOrganize({
    nameOf,
    romsRels: [`내 젤다/Zelda [${BASE}][v0].nsp`, `내 젤다/Patches/Zelda [${UPD}][v65536].nsp`],
    incoming: [nameItem(`Zelda [${UPD}][v131072].nsp`), nameItem(`Zelda [${UPD}][v65536].nsp`)],
  });
  assert.deepEqual(plan.moves.map((m) => [m.to, m.folderIsNew]), [[`내 젤다/update/Zelda [${UPD}][v131072].nsp`, false]]);
  assert.deepEqual(plan.held.map((h) => h.reason), [REASONS.have]);
});

test("an update with no base anywhere still gets the game's folder when the title is known", () => {
  const plan = planOrganize({ nameOf, incoming: [nameItem(`[${UPD}][v65536].nsp`)] });
  assert.deepEqual(plan.moves.map((m) => m.to), [`마이 게임/update/[${UPD}][v65536].nsp`]);
  const unknown = planOrganize({ incoming: [nameItem("[0100CCCC00030800][v65536].nsp")] });
  assert.deepEqual(unknown.held.map((h) => h.reason), [REASONS.noFolder]);
});

test("two games of one name get apart folders; a name already taken by a folder is not reused", () => {
  const plan = planOrganize({
    nameOf: () => "Same",
    romsRels: ["Same/Old [0100DDDD00040000][v0].nsp"],
    incoming: [nameItem(`a [${BASE}][v0].nsp`)],
  });
  assert.deepEqual(plan.moves.map((m) => m.to), [`Same [${BASE}]/a [${BASE}][v0].nsp`]);
});

test("what stays, and why", () => {
  const plan = planOrganize({
    nameOf,
    romsRels: [`A/a [${BASE}][v0].nsp`, `B/b [${UPD}][v65536].nsp`],
    incoming: [
      nameItem(`fresh [${OTHER}][v0].nsp`, { mtimeMs: Date.now() }),
      nameItem("nothing.nsp"),
      nameItem("readme.txt"),
      nameItem("upd.nsp", { id: { titleId: "0100BBBB00020800", version: null, kind: "update", baseTitleId: OTHER }, source: "ticket" }),
      nameItem(`renamed [${OTHER}][v0].nsp`, { id: { titleId: BASE, version: 0, kind: "base", baseTitleId: BASE }, source: "cnmt" }),
      nameItem(`dup [${DLC}][v0].nsp`),
      nameItem(`old [0100EEEE00050000][v0].nsp`),
      nameItem(`also old [0100EEEE00050000][v0].nsz`),
    ],
  });
  const why = Object.fromEntries(plan.held.map((h) => [h.rel, h.reason]));
  assert.equal(why[`fresh [${OTHER}][v0].nsp`], REASONS.settling);
  assert.equal(why["nothing.nsp"], REASONS.noId);
  assert.equal(why["readme.txt"], REASONS.notGame);
  assert.equal(why["upd.nsp"], REASONS.noVersion);
  assert.equal(why[`renamed [${OTHER}][v0].nsp`], REASONS.idMismatch);
  assert.equal(why[`dup [${DLC}][v0].nsp`], REASONS.splitBase, "the game's files sit in folders A and B");
  assert.equal(why[`old [0100EEEE00050000][v0].nsp`], REASONS.twice, "the first by name goes, the other stays");
  assert.deepEqual(plan.moves.map((m) => m.from), [`also old [0100EEEE00050000][v0].nsz`]);
});

test("a base game read from its ticket alone goes in as v0", () => {
  const id = identityFromTicket([`${BASE}0000000000000000.tik`]);
  const plan = planOrganize({ nameOf, incoming: [nameItem("x.nsp", { id, source: "ticket" })] });
  assert.deepEqual(plan.moves.map((m) => m.to), [`마이 게임/x [${BASE}][v0].nsp`]);
});

test("moveNoReplace never replaces a file", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cook-org-"));
  try {
    fs.writeFileSync(path.join(dir, "a"), "a");
    fs.writeFileSync(path.join(dir, "b"), "b");
    assert.equal(await moveNoReplace(path.join(dir, "a"), path.join(dir, "b")), false);
    assert.equal(fs.readFileSync(path.join(dir, "b"), "utf8"), "b");
    assert.equal(await moveNoReplace(path.join(dir, "a"), path.join(dir, "c")), true);
    assert.ok(!fs.existsSync(path.join(dir, "a")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a sweep sorts the drop box into the games folder and leaves the rest", async () => {
  const roms = fs.mkdtempSync(path.join(os.tmpdir(), "cook-org-"));
  const put = (rel, mtime = OLD) => {
    const abs = path.join(roms, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, rel);
    fs.utimesSync(abs, mtime / 1000, mtime / 1000);
  };
  try {
    put(`내 게임/a [${BASE}][v0].nsp`);
    put("incoming/pack/update.nsp");
    put("incoming/pack/notes.txt");
    put("incoming/copying.nsp", Date.now());
    const reads = [];
    const org = createOrganizer({
      incomingDir: path.join(roms, "incoming"),
      romsDir: roms,
      romsRels: async () => [`내 게임/a [${BASE}][v0].nsp`],
      ...createIdentifier({
        readIdentity: async (abs) => { reads.push(path.basename(abs)); return abs.endsWith("update.nsp") ? { titleId: UPD, version: 65536, kind: "update", baseTitleId: BASE } : null; },
        readTicketNames: async () => [],
      }),
      nameOf,
      retroDir: path.join(roms, "retro"),
      homebrewDir: path.join(roms, "homebrew"),
      systems: () => ({}),
      readRefs: async () => [],
      begin: () => ({ step() {}, done() {} }),
      rescan: () => {},
      rescanRetro: () => {},
      rescanHomebrew: () => {},
      journal: async (m) => journaled.push(m),
    });
    const journaled = [];
    const { moved } = await org.sweep();
    assert.equal(moved, 1);
    assert.ok(fs.existsSync(path.join(roms, `내 게임/update/update [${UPD}][v65536].nsp`)));
    assert.deepEqual(journaled, [{ action: "organize", from: path.join(roms, "incoming/pack/update.nsp"), to: path.join(roms, `내 게임/update/update [${UPD}][v65536].nsp`) }]);
    assert.ok(!fs.existsSync(path.join(roms, "incoming/pack/update.nsp")));
    assert.deepEqual(reads, ["update.nsp"], "a file still being copied is not opened");
    const v = org.view();
    assert.deepEqual(v.held.map((h) => [h.rel, h.reason]).sort(), [["copying.nsp", REASONS.settling], ["pack/notes.txt", EXTRA_REASONS.unknown]]);
    assert.equal(v.waiting, 1);
    assert.equal(v.recent[0].to, `내 게임/update/update [${UPD}][v65536].nsp`);
    await org.sweep();
    assert.deepEqual(reads, ["update.nsp"], "a settled file is read once");
  } finally {
    fs.rmSync(roms, { recursive: true, force: true });
  }
});

test("a sorted file is journaled and its move undone puts it back in the drop box", async () => {
  const roms = fs.mkdtempSync(path.join(os.tmpdir(), "cook-org-"));
  const incoming = fs.mkdtempSync(path.join(os.tmpdir(), "cook-org-in-"));
  const journal = await import("../../src/library/journal.js");
  const roots = [{ key: "incoming", dir: incoming }, { key: "games", dir: roms }];
  try {
    fs.mkdirSync(path.join(roms, "내 게임"), { recursive: true });
    fs.writeFileSync(path.join(roms, `내 게임/a [${BASE}][v0].nsp`), "a");
    fs.mkdirSync(path.join(incoming, "pack"));
    fs.writeFileSync(path.join(incoming, "pack/update.nsp"), "UPDATE");
    fs.utimesSync(path.join(incoming, "pack/update.nsp"), OLD / 1000, OLD / 1000);
    const rel = (abs) => roots.map((r) => ({ r, rel: path.relative(r.dir, abs) })).find((x) => !x.rel.startsWith(".."));
    const org = createOrganizer({
      incomingDir: incoming, romsDir: roms, romsRels: async () => [`내 게임/a [${BASE}][v0].nsp`],
      ...createIdentifier({ readIdentity: async () => ({ titleId: UPD, version: 65536, kind: "update", baseTitleId: BASE }), readTicketNames: async () => [] }),
      nameOf, retroDir: path.join(roms, "retro"), homebrewDir: path.join(roms, "homebrew"), systems: () => ({}), readRefs: async () => [],
      begin: () => ({ step() {}, done() {} }), rescan: () => {}, rescanRetro: () => {}, rescanHomebrew: () => {},
      journal: async ({ action, from, to }) => {
        const a = rel(from);
        const b = rel(to);
        await journal.recordMove({ action, by: { type: "job", name: "organize" }, fromRoot: a.r, from: a.rel, toRoot: b.r, to: b.rel });
      },      undone: () => journal.undoneHeld(roots, "incoming"),
    });
    assert.equal((await org.sweep()).moved, 1);
    const { items: [op] } = await journal.listJournal(roots);
    assert.deepEqual([op.action, op.from, op.to, op.undoable], ["organize", "pack/update.nsp", `내 게임/update/update [${UPD}][v65536].nsp`, true]);
    await journal.undoMove(roots, op.id);
    assert.equal(fs.readFileSync(path.join(incoming, "pack/update.nsp"), "utf8"), "UPDATE");
    assert.ok(!fs.existsSync(path.join(roms, "내 게임/update")), "the folder the sort made goes with it");
    // The next sweeps leave it where the admin put it back, and say why.
    assert.equal((await org.sweep()).moved, 0);
    assert.ok(fs.existsSync(path.join(incoming, "pack/update.nsp")));
    assert.deepEqual(org.view().held.map((h) => [h.rel, h.reason]), [["pack/update.nsp", REASONS.undone]]);
    // Once released it is sorted again.
    await journal.releaseUndone(roots, op.id);
    assert.equal((await org.sweep()).moved, 1);
  } finally {
    fs.rmSync(roms, { recursive: true, force: true });
    fs.rmSync(incoming, { recursive: true, force: true });
  }
});
