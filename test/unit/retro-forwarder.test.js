import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// A stand-in hacBrewPack: writes <nspdir>/<titleid>.nsp holding its arguments.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "cf-fwd-test-"));
const fakeBin = path.join(root, "hacbrewpack");
fs.writeFileSync(fakeBin, `#!/bin/sh
tid=""; nsp=""; exefs=""
while [ $# -gt 0 ]; do
  case "$1" in --titleid) tid="$2"; shift ;; --nspdir) nsp="$2"; shift ;; --exefsdir) exefs="$2"; shift ;; esac
  shift
done
mkdir -p "$nsp" && echo "NSP $tid" > "$nsp/$tid.nsp"
[ -n "$FWD_NPDM_OUT" ] && cp "$exefs/main.npdm" "$FWD_NPDM_OUT"
exit 0
`, { mode: 0o755 });
process.env.COOK_HACBREWPACK_BIN = fakeBin;
// The real exefs is built in the Docker image; the NPDM here is its 1 KB descriptor (no code).
process.env.COOK_FORWARDER_EXEFS = path.resolve(import.meta.dirname, "../fixtures/forwarder-exefs");
const keysDir = path.join(root, "keys");
fs.mkdirSync(keysDir);
fs.writeFileSync(path.join(keysDir, "prod.keys"), `header_key = ${"ab".repeat(32)}\nkey_area_key_application_00 = ${"cd".repeat(16)}\n`);

const fwd = await import("../../src/retro/forwarder.js");

const game = (over = {}) => ({
  id: "snes-0123456789",
  name: "슈퍼 마리오 월드 (Super Mario World) [K v1.0]",
  core: "snes9x",
  romSdPath: "roms/snes/슈퍼 마리오 월드 (Super Mario World) [K v1.0].sfc",
  artKey: "aaaaaaaaaaaa",
  publisher: "RetroArch · 슈퍼 패미컴 (SNES)",
  icon: null,
  ...over,
});

test("a game's forwarder title ID is fixed, in the 05 range, and ends in 000", () => {
  const id = fwd.forwarderTitleId("snes-0123456789");
  assert.match(id, /^05[0-9A-F]{11}000$/);
  assert.equal(fwd.forwarderTitleId("snes-0123456789"), id, "same game, same ID: a reinstall replaces it");
  assert.notEqual(fwd.forwarderTitleId("snes-0123456780"), id);
});

test("the HOME menu name is the Korean title without the English name or patch tags", () => {
  assert.equal(fwd.displayName("슈퍼 마리오 월드 (Super Mario World) [K v1.0]"), "슈퍼 마리오 월드");
  assert.equal(fwd.displayName("록맨 X (Rockman X (Japan)) [J-K]"), "록맨 X");
  assert.equal(fwd.displayName("Xenogears KOR"), "Xenogears KOR");
  assert.equal(fwd.displayName("(Only English) [K]"), "(Only English)", "nothing before the parentheses keeps them");
});

test("the NACP names the game in every language and carries the title ID", () => {
  const n = fwd.nacp({ name: "슈퍼 마리오 월드", publisher: "RetroArch", titleId: "05ABCDEF01234000" });
  assert.equal(n.length, 0x4000);
  for (const lang of [0, 12, 15]) assert.equal(n.subarray(lang * 0x300, lang * 0x300 + 0x200).toString("utf8").replace(/\0+$/, ""), "슈퍼 마리오 월드");
  assert.equal(n.readBigUInt64LE(0x3038), 0x05abcdef01234000n);
  assert.equal(n.readBigUInt64LE(0x3078), 0x05abcdef01234000n);
  assert.equal(n[0x3025], 0, "no user picker before the game starts");
  const long = fwd.nacp({ name: "가".repeat(300), publisher: "p", titleId: "0500000000000000" });
  assert.ok(Buffer.from(long.subarray(0, 0x200)).toString("utf8").replace(/\0+$/, "").endsWith("가"), "a long name is cut on a character boundary");
  assert.equal(long[0x1ff], 0, "and stays NUL-terminated");
});

test("the forwarder starts the game's core with the bundle's ROM path", () => {
  assert.deepEqual(fwd.launchTarget("snes9x", "roms/snes/a b.sfc"), {
    nroPath: "sdmc:/retroarch/cores/snes9x_libretro_libnx.nro",
    argv: 'sdmc:/retroarch/cores/snes9x_libretro_libnx.nro "sdmc:/roms/snes/a b.sfc"',
  });
  assert.equal(fwd.launchTarget("snes9x", 'roms/snes/a"b.sfc'), null, "a quote would break argv");
  assert.equal(fwd.launchTarget("snes9x", "roms/../x.sfc"), null);
  assert.equal(fwd.launchTarget("", "roms/snes/a.sfc"), null);
});

test("hacBrewPack is handed only the keys it uses", () => {
  const keys = fwd.packingKeys(`header_key = ${"AB".repeat(32)}\r\nkey_area_key_application_00 = ${"cd".repeat(16)}\nmaster_kek_source_06 = ${"ef".repeat(17)}\nmaster_key_00 = ${"01".repeat(16)}\n`);
  assert.equal(keys, `header_key = ${"ab".repeat(32)}\nkey_area_key_application_00 = ${"cd".repeat(16)}\n`);
});

test("forwarders are built once, rebuilt when the game changes, and dropped with it", async () => {
  fwd.resetAvailability();
  assert.equal(fwd.forwardersAvailable(keysDir), true);
  const out = path.join(root, "out");
  const first = await fwd.ensureForwarder(out, game(), keysDir);
  assert.equal(fs.readFileSync(first.path, "utf8").trim(), `NSP ${first.spec.titleId.toLowerCase()}`);
  assert.equal((await fwd.ensureForwarder(out, game(), keysDir)).path, first.path, "already built");

  const second = await fwd.ensureForwarder(out, game({ artKey: "bbbbbbbbbbbb" }), keysDir);
  assert.deepEqual(fs.readdirSync(out), [path.basename(second.path)], "a new cover means a new NSP, and the old one goes");
  assert.notEqual(second.path, first.path);
  assert.equal(second.spec.titleId, first.spec.titleId, "under the same title ID");
});

test("without prod.keys there are no forwarders", () => {
  fwd.resetAvailability();
  const later = path.join(root, "no-keys");
  assert.equal(fwd.forwardersAvailable(later), false);
  fs.mkdirSync(later, { recursive: true });
  fs.copyFileSync(path.join(keysDir, "prod.keys"), path.join(later, "prod.keys"));
  assert.equal(fwd.forwardersAvailable(later), true, "keys handed in later count without a restart");
  fs.rmSync(later, { recursive: true, force: true });
  fwd.resetAvailability();
});

test("the shortcut's CPU cores are written into its NPDM, as Sphaira does, and only 4 changes the build", async () => {
  const npdm = fs.readFileSync(path.join(fwd.EXEFS_DIR, "main.npdm"));
  assert.ok(fwd.npdmForCores(npdm, 3).equals(npdm), "the shipped NPDM already is the 3-core one");
  const four = fwd.npdmForCores(npdm, 4);
  const changed = [...npdm.keys()].filter((i) => npdm[i] !== four[i]);
  assert.equal(changed.length, 4, "one capability word in ACI0 and one in ACID");
  for (const at of [768, 960]) assert.equal(four.readUInt32LE(at), 0x030073f7, "cores 0-3, priority 28-63");
  assert.throws(() => fwd.npdmForCores(npdm, 2), /3 or 4/);
  assert.throws(() => fwd.npdmForCores(Buffer.alloc(0x100), 4), /not an NPDM/);

  const plain = fwd.forwarderSpec(game());
  assert.equal(fwd.forwarderSpec(game({ cores: 3 })).key, plain.key, "the default keeps every NSP already built");
  const quad = fwd.forwarderSpec(game({ cores: 4 }));
  assert.notEqual(quad.key, plain.key);
  assert.equal(quad.titleId, plain.titleId, "same title: installing it replaces the other");

  const out = path.join(root, "cores-out");
  const packed = path.join(root, "packed.npdm");
  process.env.FWD_NPDM_OUT = packed;
  try {
    await fwd.ensureForwarder(out, game({ cores: 4 }), keysDir);
    assert.ok(fs.readFileSync(packed).equals(four), "the NSP was packed with the 4-core NPDM");
    await fwd.ensureForwarder(out, game(), keysDir);
    assert.ok(fs.readFileSync(packed).equals(npdm), "and the default one is the shipped NPDM");
  } finally {
    delete process.env.FWD_NPDM_OUT;
  }
});
