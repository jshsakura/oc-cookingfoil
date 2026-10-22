import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readCnmtIdentity } from "../../src/meta/cnmt-parse.js";
import {
  REASONS, REASON_TEXT, createOrganizer, moveNoReplace, folderNameOf, isIncoming, planOrganize,
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

test("names: folder names are made safe, a ticket names its title", () => {
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
    titledbName: nameOf,
    incoming: [
      nameItem("dl/whatever.nsp", { id: { titleId: BASE, version: 0, kind: "base", baseTitleId: BASE }, source: "cnmt" }),
      nameItem("upd.nsp", { id: { titleId: UPD, version: 65536, kind: "update", baseTitleId: BASE }, source: "cnmt" }),
      nameItem(`costume [${DLC}][v0].nsp`),
    ],
  });
  assert.deepEqual(plan.moves.map((m) => m.to).sort(), [
    `마이 게임/DLC/costume [${DLC}][v0].nsp`,
    `마이 게임/update/마이 게임 [${UPD}][v65536].nsp`,
    `마이 게임/마이 게임 [${BASE}][v0].nsp`,
  ]);
  assert.ok(plan.moves.every((m) => m.folderIsNew));
  assert.deepEqual(plan.held, []);
});

test("the game's folder already in the library is used, whatever the operator named it", () => {
  const plan = planOrganize({
    titledbName: nameOf,
    romsRels: [`내 젤다/Zelda [${BASE}][v0].nsp`, `내 젤다/Patches/Zelda [${UPD}][v65536].nsp`],
    incoming: [nameItem(`Zelda [${UPD}][v131072].nsp`), nameItem(`Zelda [${UPD}][v65536].nsp`)],
  });
  assert.deepEqual(plan.moves.map((m) => [m.to, m.folderIsNew]), [[`내 젤다/update/마이 게임 [${UPD}][v131072].nsp`, false]]);
  assert.deepEqual(plan.held.map((h) => h.reason), [REASONS.have]);
});

test("an update with no base anywhere still gets the game's folder when the title is known", () => {
  const plan = planOrganize({ titledbName: nameOf, incoming: [nameItem(`[${UPD}][v65536].nsp`)] });
  assert.deepEqual(plan.moves.map((m) => m.to), [`마이 게임/update/마이 게임 [${UPD}][v65536].nsp`]);
  const unknown = planOrganize({ incoming: [nameItem("[0100CCCC00030800][v65536].nsp")] });
  assert.deepEqual(unknown.held.map((h) => h.reason), [REASONS.waitBase]);
});

test("two games of one name get apart folders; a name already taken by a folder is not reused", () => {
  const plan = planOrganize({
    titledbName: () => "Same",
    romsRels: ["Same/Old [0100DDDD00040000][v0].nsp"],
    incoming: [nameItem(`a [${BASE}][v0].nsp`)],
  });
  assert.deepEqual(plan.moves.map((m) => m.to), [`Same [${BASE}]/Same [${BASE}][v0].nsp`]);
});

test("what stays, and why", () => {
  const plan = planOrganize({
    titledbName: nameOf,
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
  const plan = planOrganize({ titledbName: nameOf, incoming: [nameItem("x.nsp", { id, source: "ticket" })] });
  assert.deepEqual(plan.moves.map((m) => m.to), [`마이 게임/마이 게임 [${BASE}][v0].nsp`]);
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
      titledbName: nameOf,
      retroDir: path.join(roms, "retro"),
      homebrewDir: path.join(roms, "homebrew"),
      systems: () => ({}),
      readRefs: async () => [],
      begin: () => ({ step() {}, done() {} }),
      rescan: () => {},
      rescanRetro: () => {},
      rescanHomebrew: () => {},
    });
    const { moved } = await org.sweep();
    assert.equal(moved, 1);
    assert.ok(fs.existsSync(path.join(roms, `내 게임/update/마이 게임 [${UPD}][v65536].nsp`)));
    assert.ok(!fs.existsSync(path.join(roms, "incoming/pack/update.nsp")));
    assert.deepEqual(reads, ["update.nsp"], "a file still being copied is not opened");
    const v = org.view();
    assert.deepEqual(v.held.map((h) => [h.rel, h.reason]).sort(), [["copying.nsp", REASONS.settling], ["pack/notes.txt", EXTRA_REASONS.unknown]]);
    assert.equal(v.waiting, 1);
    assert.equal(v.recent[0].to, `내 게임/update/마이 게임 [${UPD}][v65536].nsp`);
    await org.sweep();
    assert.deepEqual(reads, ["update.nsp"], "a settled file is read once");
  } finally {
    fs.rmSync(roms, { recursive: true, force: true });
  }
});

const NEW = "0100CCCC00030000";
const NEW_UPD = "0100CCCC00030800";
const NEW_DLC = "0100CCCC00031001";
const cnmtItem = (rel, id, extra = {}) => nameItem(rel, { id, source: "cnmt", ...extra });
const baseId = (titleId) => ({ titleId, version: 0, kind: "base", baseTitleId: titleId });

test("a file's name comes from the admin's name, then titledb, then the NACP, then its own name", () => {
  const item = cnmtItem("[Example.com] File Name.nsp", baseId(NEW), { nacpName: "NACP 이름" });
  const plan = (names) => planOrganize({ ...names, incoming: [item] }).moves.map((m) => m.to);
  assert.deepEqual(plan({ adminName: () => "관리자 이름", titledbName: () => "titledb 이름" }), [`관리자 이름/관리자 이름 [${NEW}][v0].nsp`]);
  assert.deepEqual(plan({ titledbName: () => "titledb 이름" }), [`titledb 이름/titledb 이름 [${NEW}][v0].nsp`]);
  assert.deepEqual(plan({}), [`NACP 이름/NACP 이름 [${NEW}][v0].nsp`]);
  const bare = planOrganize({ incoming: [cnmtItem("[Example.com] File Name.nsp", baseId(NEW))] });
  assert.deepEqual(bare.moves.map((m) => m.to), [`File Name/File Name [${NEW}][v0].nsp`], "the site prefix comes off");
});

test("a broken name at any step is passed over, never written", () => {
  const plan = planOrganize({
    adminName: () => "�",
    titledbName: () => "Bad\u0001Name",
    incoming: [cnmtItem(`� [${NEW}][v0].nsz`, baseId(NEW), { nacpName: "��" })],
  });
  assert.deepEqual(plan.moves, []);
  assert.deepEqual(plan.held.map((h) => h.reason), [REASONS.noName]);
  // The same file whose game already has a folder takes the folder's name.
  const known = planOrganize({
    romsRels: [`내 게임/a [${NEW}][v0].nsp`],
    incoming: [cnmtItem(`� [${NEW_UPD}][v196608].nsz`, { titleId: NEW_UPD, version: 196608, kind: "update", baseTitleId: NEW }, { nacpName: "�" })],
  });
  assert.deepEqual(known.moves.map((m) => m.to), [`내 게임/update/내 게임 [${NEW_UPD}][v196608].nsz`]);
});

test("an update's NACP names a game titledb does not know, and its DLC follows into that folder", () => {
  const plan = planOrganize({
    incoming: [
      cnmtItem(`[${NEW_DLC}][v0].nsp`, { titleId: NEW_DLC, version: 0, kind: "dlc", baseTitleId: NEW }),
      cnmtItem("patch.nsp", { titleId: NEW_UPD, version: 65536, kind: "update", baseTitleId: NEW }, { nacpName: "새 게임: 부제" }),
    ],
  });
  assert.deepEqual(plan.moves.map((m) => m.to), [
    `새 게임 - 부제/update/새 게임 - 부제 [${NEW_UPD}][v65536].nsp`,
    `새 게임 - 부제/DLC/새 게임 - 부제 DLC 1 [${NEW_DLC}][v0].nsp`,
  ]);
  assert.deepEqual(plan.held, []);
});

test("a DLC of a game nobody can name yet stays until its game arrives", () => {
  const dlc = cnmtItem(`Costume Pack [${NEW_DLC}][v0].nsp`, { titleId: NEW_DLC, version: 0, kind: "dlc", baseTitleId: NEW });
  const alone = planOrganize({ incoming: [dlc] });
  assert.deepEqual(alone.held.map((h) => [h.rel, h.reason]), [[dlc.rel, REASONS.waitBase]]);
  const later = planOrganize({ romsRels: [`Game X/Game X [${NEW}][v0].nsp`], incoming: [dlc] });
  assert.deepEqual(later.moves.map((m) => m.to), [`Game X/DLC/Costume Pack [${NEW_DLC}][v0].nsp`]);
  const dlcTitled = planOrganize({ titledbName: (t) => (t === NEW_DLC ? "의상 팩" : null), romsRels: [`Game X/Game X [${NEW}][v0].nsp`], incoming: [dlc] });
  assert.deepEqual(dlcTitled.moves.map((m) => m.to), [`Game X/DLC/의상 팩 [${NEW_DLC}][v0].nsp`], "a DLC's own title names it");
});

test("an update without a readable NACP of an unknown game still waits", () => {
  const plan = planOrganize({ incoming: [cnmtItem("Some Update.nsp", { titleId: NEW_UPD, version: 65536, kind: "update", baseTitleId: NEW })] });
  assert.deepEqual(plan.held.map((h) => h.reason), [REASONS.waitBase]);
});

test("a sweep reads a NACP only when no other name exists, once per file, and notes each move", async () => {
  const roms = fs.mkdtempSync(path.join(os.tmpdir(), "cook-org-"));
  const put = (rel) => {
    const abs = path.join(roms, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, rel);
    fs.utimesSync(abs, OLD / 1000, OLD / 1000);
  };
  try {
    put("incoming/known.nsp");
    put("incoming/unknown-update.nsp");
    put("incoming/dlc.nsp");
    const ids = {
      "known.nsp": baseId(BASE),
      "unknown-update.nsp": { titleId: NEW_UPD, version: 65536, kind: "update", baseTitleId: NEW },
      "dlc.nsp": { titleId: "0100DDDD00041001", version: 0, kind: "dlc", baseTitleId: "0100DDDD00040000" },
    };
    const nacpReads = [];
    const journal = [];
    const org = createOrganizer({
      incomingDir: path.join(roms, "incoming"),
      romsDir: roms,
      romsRels: async () => [],
      ...createIdentifier({ readIdentity: async (abs) => ids[path.basename(abs)], readTicketNames: async () => [] }),
      titledbName: nameOf,
      readNacpName: async ({ abs }) => { nacpReads.push(path.basename(abs)); return "새 게임"; },
      journal: async (entry) => journal.push(entry),
      retroDir: path.join(roms, "retro"),
      homebrewDir: path.join(roms, "homebrew"),
      systems: () => ({}),
      readRefs: async () => [],
      begin: () => ({ step() {}, done() {} }),
      rescan: () => {},
      rescanRetro: () => {},
      rescanHomebrew: () => {},
    });
    assert.equal((await org.sweep()).moved, 2);
    assert.deepEqual(nacpReads, ["unknown-update.nsp"], "titledb named the base; a DLC has no NACP");
    assert.ok(fs.existsSync(path.join(roms, `마이 게임/마이 게임 [${BASE}][v0].nsp`)));
    assert.ok(fs.existsSync(path.join(roms, `새 게임/update/새 게임 [${NEW_UPD}][v65536].nsp`)));
    assert.deepEqual(journal.map((j) => [j.action, path.relative(roms, j.from), path.relative(roms, j.to)]), [
      ["organize", "incoming/known.nsp", `마이 게임/마이 게임 [${BASE}][v0].nsp`],
      ["organize", "incoming/unknown-update.nsp", `새 게임/update/새 게임 [${NEW_UPD}][v65536].nsp`],
    ]);
    assert.deepEqual(org.view().held.map((h) => [h.rel, h.reason]), [["dlc.nsp", REASONS.waitBase]]);
    await org.sweep();
    assert.deepEqual(nacpReads, ["unknown-update.nsp"], "nothing left needs a NACP read");
  } finally {
    fs.rmSync(roms, { recursive: true, force: true });
  }
});

test("a sweep never writes over a file that appears at the target between plan and move", async () => {
  const roms = fs.mkdtempSync(path.join(os.tmpdir(), "cook-org-"));
  try {
    const src = path.join(roms, "incoming/x.nsp");
    fs.mkdirSync(path.dirname(src), { recursive: true });
    fs.writeFileSync(src, "new");
    fs.utimesSync(src, OLD / 1000, OLD / 1000);
    const target = path.join(roms, `마이 게임/마이 게임 [${BASE}][v0].nsp`);
    const org = createOrganizer({
      incomingDir: path.join(roms, "incoming"),
      romsDir: roms,
      romsRels: async () => [],
      identify: async () => {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, "already here");
        return { id: baseId(BASE), source: "cnmt" };
      },
      forget: () => {},
      titledbName: nameOf,
      retroDir: path.join(roms, "retro"),
      homebrewDir: path.join(roms, "homebrew"),
      systems: () => ({}),
      readRefs: async () => [],
      begin: () => ({ step() {}, done() {} }),
      rescan: () => {},
      rescanRetro: () => {},
      rescanHomebrew: () => {},
    });
    assert.equal((await org.sweep()).moved, 0);
    assert.equal(fs.readFileSync(target, "utf8"), "already here");
    assert.ok(fs.existsSync(src));
    assert.deepEqual(org.view().held.map((h) => h.reason), [REASONS.taken]);
  } finally {
    fs.rmSync(roms, { recursive: true, force: true });
  }
});

const NFD = "포켓몬".normalize("NFD");

test("a folder spelled in NFD is the same folder: another game's is not doubled, the game's own is reused", () => {
  assert.notEqual(NFD, "포켓몬");
  const other = planOrganize({ titledbName: () => "포켓몬", romsRels: [`${NFD}/Old [0100DDDD00040000][v0].nsp`], incoming: [cnmtItem("x.nsp", baseId(NEW))] });
  assert.deepEqual(other.moves.map((m) => m.to), [`포켓몬 [${NEW}]/포켓몬 [${NEW}][v0].nsp`]);
  const own = planOrganize({
    titledbName: () => "포켓몬",
    romsRels: [`${NFD}/a [${NEW}][v0].nsp`, `${NFD}/Update/a [${NEW_UPD}][v65536].nsp`],
    incoming: [cnmtItem("u.nsp", { titleId: NEW_UPD, version: 131072, kind: "update", baseTitleId: NEW })],
  });
  assert.deepEqual(own.moves.map((m) => m.to), [`${NFD}/Update/포켓몬 [${NEW_UPD}][v131072].nsp`], "the folder and its update folder as spelled on disk");
  const file = planOrganize({ titledbName: () => "포켓몬", romsRels: [`${NFD}/${NFD} [${NEW}][v65536].nsp`], incoming: [cnmtItem("b.nsp", { titleId: NEW, version: 65536, kind: "base", baseTitleId: NEW })] });
  assert.deepEqual(file.held.map((h) => h.reason), [REASONS.have]);
});

test("a DLC alone waits for its game; a game with no usable name says so", () => {
  const dlc = planOrganize({ incoming: [cnmtItem(`Pack [${NEW_DLC}][v0].nsp`, { titleId: NEW_DLC, version: 0, kind: "dlc", baseTitleId: NEW })] });
  assert.deepEqual(dlc.held.map((h) => [h.reason, h.code]), [[REASONS.waitBase, "waitBase"]]);
  const update = planOrganize({ incoming: [cnmtItem("Some Update.nsp", { titleId: NEW_UPD, version: 65536, kind: "update", baseTitleId: NEW })] });
  assert.deepEqual(update.held.map((h) => h.code), ["waitBase"]);
  const base = planOrganize({ incoming: [cnmtItem(`[${NEW}][v0].nsp`, baseId(NEW))] });
  assert.deepEqual(base.held.map((h) => h.code), ["noName"]);
  const crowded = planOrganize({ titledbName: () => "Same", romsRels: ["Same/x [0100DDDD00040000][v0].nsp", `Same [${NEW}]/y [0100EEEE00050000][v0].nsp`], incoming: [cnmtItem("z.nsp", baseId(NEW))] });
  assert.deepEqual(crowded.held.map((h) => h.code), ["noFolder"], "both folder names taken is a real naming failure");
});

test("a DLC file name that says nothing gives way to '<game> DLC n'", () => {
  const plan = planOrganize({
    romsRels: [`Game X/Game X [${NEW}][v0].nsp`],
    incoming: ["dlc2.nsp", "dlc_01.nsp", "123.nsp", "Costume Pack.nsp"].map((rel, i) => cnmtItem(rel, { titleId: `0100CCCC0003${String(1001 + i).padStart(4, "0")}`, version: 0, kind: "dlc", baseTitleId: NEW })),
  });
  const named = Object.fromEntries(plan.moves.map((m) => [m.from, m.to.split("/").pop().replace(/ \[.*$/, "")]));
  assert.deepEqual(named, { "dlc2.nsp": "Game X DLC 1", "dlc_01.nsp": "Game X DLC 2", "123.nsp": "Game X DLC 3", "Costume Pack.nsp": "Costume Pack" });
});

test("a base and its update in one batch take one name: the base's, else the update's NACP", () => {
  const upd = (extra) => cnmtItem("patch.nsp", { titleId: NEW_UPD, version: 65536, kind: "update", baseTitleId: NEW }, extra);
  const both = planOrganize({ incoming: [cnmtItem("base.nsp", baseId(NEW), { nacpName: "Base Name" }), upd({ nacpName: "Update Name" })] });
  assert.deepEqual(both.moves.map((m) => m.to), [`Base Name/Base Name [${NEW}][v0].nsp`, `Base Name/update/Base Name [${NEW_UPD}][v65536].nsp`]);
  const fromUpdate = planOrganize({ incoming: [cnmtItem("nsw2u.com - Raw File Name.nsp", baseId(NEW)), upd({ nacpName: "Update Name" })] });
  assert.deepEqual(fromUpdate.moves.map((m) => m.to), [`Update Name/Update Name [${NEW}][v0].nsp`, `Update Name/update/Update Name [${NEW_UPD}][v65536].nsp`]);
});

test("every hold reason and the drop box's own words are in ko, en, ja and zh", () => {
  const langs = ["ko", "en", "ja", "zh"];
  assert.deepEqual(Object.keys(REASON_TEXT), langs);
  for (const lang of langs) {
    assert.deepEqual(Object.keys(REASON_TEXT[lang]).sort(), Object.keys(REASONS).sort(), lang);
    for (const [code, text] of Object.entries(REASON_TEXT[lang])) {
      assert.ok(text && !/[—–]/.test(text), `${lang}.${code}`);
      if (lang !== "ko") assert.ok(!/[가-힣]/.test(text), `${lang}.${code} is not Korean`);
    }
  }
  assert.equal(REASONS.waitBase, REASON_TEXT.ko.waitBase);
});

test("the NACP cache knows a file by its inode and ctime too, and retries a failed read", async () => {
  const roms = fs.mkdtempSync(path.join(os.tmpdir(), "cook-org-"));
  const abs = path.join(roms, "incoming/u.nsp");
  const put = (body) => {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const tmp = `${abs}.tmp`;
    fs.writeFileSync(tmp, body);
    fs.utimesSync(tmp, OLD / 1000, OLD / 1000);
    fs.renameSync(tmp, abs);
  };
  try {
    put("AAAA");
    const reads = [];
    let answer = null;
    let epoch = "no keys";
    const org = createOrganizer({
      incomingDir: path.join(roms, "incoming"),
      romsDir: roms,
      romsRels: async () => [],
      identify: async () => ({ id: { titleId: NEW_UPD, version: 65536, kind: "update", baseTitleId: NEW }, source: "cnmt" }),
      forget: () => {},
      readNacpName: async () => { reads.push(answer); return answer; },
      nacpEpoch: async () => epoch,
      retroDir: path.join(roms, "retro"),
      homebrewDir: path.join(roms, "homebrew"),
      systems: () => ({}),
      readRefs: async () => [],
      begin: () => ({ step() {}, done() {} }),
      rescan: () => {},
      rescanRetro: () => {},
      rescanHomebrew: () => {},
    });
    await org.sweep();
    await org.sweep();
    assert.equal(reads.length, 1, "a failed read is not repeated while nothing changed");
    epoch = "keys";
    await org.sweep();
    assert.equal(reads.length, 2, "new keys or nstool: the read is tried again");
    await org.sweep({ retry: true });
    assert.equal(reads.length, 3, "a sweep asked for by hand tries again too");
    put("BBBB"); // same name, size and mtime; a new inode and ctime
    answer = "Second";
    await org.sweep();
    assert.equal(reads.length, 4, "another file under the same name, size and mtime is read again");
    assert.ok(fs.existsSync(path.join(roms, `Second/update/Second [${NEW_UPD}][v65536].nsp`)));
  } finally {
    fs.rmSync(roms, { recursive: true, force: true });
  }
});
