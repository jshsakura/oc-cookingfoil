import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_SYSTEMS } from "../../src/retro/systems.js";
import { EXTRA_REASONS, planExtras, setFolderOf } from "../../src/meta/incoming-extras.js";
import { REASONS, createOrganizer } from "../../src/meta/library-organize.js";
import { createIdentifier } from "../../src/meta/file-identity.js";

const items = (...rels) => rels.map((rel) => ({ rel }));
const plan = (rels, refs = new Map()) => planExtras({ items: items(...rels), refs, systems: DEFAULT_SYSTEMS });

test("a ROM goes to the system the folder it was dropped in chose", () => {
  const p = plan(["snes/Chrono.zip", "PlayStation/Game.chd", "Super Nintendo/F-Zero.smc", "gba/받은 것/Golden Sun.gba"]);
  assert.deepEqual(p.moves.map((m) => [m.from, m.to]), [
    ["gba/받은 것/Golden Sun.gba", "roms/gba/Golden Sun.gba"],
    ["PlayStation/Game.chd", "roms/ps1/Game.chd"],
    ["snes/Chrono.zip", "roms/snes/Chrono.zip"],
    ["Super Nintendo/F-Zero.smc", "roms/snes/F-Zero.smc"],
  ]);
  assert.ok(p.moves.every((m) => m.root === "retro"));
});

test("the extension never picks a system; it only warns when something looks wrong", () => {
  const p = plan(["받은 것/Golden Sun.gba", "snes/Golden Sun.gba", "snes/Chrono.sfc"]);
  const why = Object.fromEntries(p.held.map((h) => [h.rel, h.reason]));
  assert.equal(why["받은 것/Golden Sun.gba"], `${EXTRA_REASONS.noSystem}. 게임보이 어드밴스 롬으로 보입니다`);
  assert.equal(why["snes/Golden Sun.gba"], `${EXTRA_REASONS.wrongExtension}. 게임보이 어드밴스 롬으로 보입니다`);
  assert.deepEqual(p.moves.map((m) => m.to), ["roms/snes/Chrono.sfc"]);
});

test("a ROM outside a system folder stays, and so does what is no ROM", () => {
  const p = plan(["loose.zip", "cover.png", "readme.txt", "snes/notes.txt", "Monkey/monkey.scummvm", "atmosphere/contents/0100AAAA00010000/romfs/a.bin"]);
  const why = Object.fromEntries(p.held.map((h) => [h.rel, h.reason]));
  assert.equal(why["loose.zip"], EXTRA_REASONS.noSystem);
  assert.equal(why["cover.png"], EXTRA_REASONS.noSystem, "a picture is never taken for a PICO-8 cart");
  assert.equal(why["readme.txt"], EXTRA_REASONS.unknown);
  assert.equal(why["snes/notes.txt"], EXTRA_REASONS.unknown);
  assert.equal(why["Monkey/monkey.scummvm"], EXTRA_REASONS.scummvm);
  assert.equal(why["atmosphere/contents/0100AAAA00010000/romfs/a.bin"], EXTRA_REASONS.patch);
  assert.deepEqual(p.moves, []);
});

test("a .cue takes its tracks along into a folder of its own; a missing track holds it", () => {
  const refs = new Map([["ps1/FF7/FF7 (Disc 1).cue", ["ps1/FF7/FF7 (Disc 1).bin"]], ["ps1/Bad.cue", ["ps1/Bad.bin"]]]);
  const p = plan(["ps1/FF7/FF7 (Disc 1).cue", "ps1/FF7/FF7 (Disc 1).bin", "ps1/Bad.cue"], refs);
  assert.deepEqual(p.moves.map((m) => m.to), ["roms/ps1/FF7 (Disc 1)/FF7 (Disc 1).cue", "roms/ps1/FF7 (Disc 1)/FF7 (Disc 1).bin"]);
  assert.deepEqual(p.held.map((h) => [h.rel, h.reason]), [["ps1/Bad.cue", EXTRA_REASONS.missingPart]]);
});

test("a lone .nro goes to a homebrew folder of its own; one with files beside it stays", () => {
  const p = plan(["Tool.nro", "apps/Other.nro", "port/game.nro", "port/data.pak"]);
  assert.deepEqual(p.moves.map((m) => [m.root, m.to]), [["homebrew", "Other/Other.nro"], ["homebrew", "Tool/Tool.nro"]]);
  assert.deepEqual(p.held.map((h) => [h.rel, h.reason]), [["port/data.pak", EXTRA_REASONS.unknown], ["port/game.nro", EXTRA_REASONS.homebrewFolder]]);
  assert.equal(setFolderOf("a:b?.nro"), "ab");
});

test("a sweep copies ROMs and apps to their folders on another root and never replaces one", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cook-extra-"));
  const old = (Date.now() - 10 * 60_000) / 1000;
  const put = (rel, body = rel) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
    fs.utimesSync(abs, old, old);
  };
  try {
    put("games/incoming/gba/Golden Sun.gba", "new");
    put("games/incoming/snes/Kept.sfc", "dropped");
    put("retro/roms/snes/Kept.sfc", "already");
    put("games/incoming/Tool.nro");
    put("games/incoming/ps1/G/G.cue", 'FILE "G.bin" BINARY');
    put("games/incoming/ps1/G/G.bin");
    let rescans = 0;
    const org = createOrganizer({
      romsDir: path.join(root, "games"),
      retroDir: path.join(root, "retro"),
      homebrewDir: path.join(root, "homebrew"),
      systems: () => DEFAULT_SYSTEMS,
      readRefs: async () => ["G.bin"],
      romsRels: async () => [],
      ...createIdentifier({ readIdentity: async () => null, readTicketNames: async () => [] }),
      nameOf: () => null,
      begin: () => ({ step() {}, done() {} }),
      rescan: () => {},
      rescanRetro: () => { rescans++; },
      rescanHomebrew: () => { rescans++; },
    });
    const { moved } = await org.sweep();
    assert.equal(moved, 4);
    assert.equal(fs.readFileSync(path.join(root, "retro/roms/gba/Golden Sun.gba"), "utf8"), "new");
    assert.ok(fs.existsSync(path.join(root, "retro/roms/ps1/G/G.bin")));
    assert.ok(fs.existsSync(path.join(root, "homebrew/Tool/Tool.nro")));
    assert.equal(fs.readFileSync(path.join(root, "retro/roms/snes/Kept.sfc"), "utf8"), "already", "never replaced");
    assert.deepEqual(org.view().held.map((h) => [h.rel, h.reason]), [["snes/Kept.sfc", REASONS.taken]]);
    assert.equal(rescans, 2);
    assert.deepEqual(fs.readdirSync(path.join(root, "games/incoming/snes")), ["Kept.sfc"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
