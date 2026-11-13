// The Vita client's test card (its tests/tests.cpp makeCard), made the same way here: one of everything a scan
// knows, things it must skip, and fake secrets whose bytes a leak check looks for. test/golden/vita-fixture.jsonl
// is what the client makes of it.
import { mkdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";

export const FIXED_TIME = 1700000000;
export const FAKE_WORK = "FAKE-WORKBIN-NOT-A-REAL-LICENSE-0001";
export const FAKE_RIF = "FAKE-RIF-NOT-A-REAL-LICENSE-0002";
export const FAKE_DB = "FAKE-LICENSEDB-NOT-REAL-0003";

const le16 = (v) => Buffer.from([v & 255, v >> 8]);
const le32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };

// A param.sfo with text entries and one number, as the tools that make them lay it out.
export function sfo(text) {
  const entries = [];
  let keys = Buffer.alloc(0);
  let values = Buffer.alloc(0);
  const add = (key, format, value, max) => {
    entries.push(Buffer.concat([le16(keys.length), le16(format), le32(value.length), le32(max), le32(values.length)]));
    keys = Buffer.concat([keys, Buffer.from(key + "\0", "latin1")]);
    values = Buffer.concat([values, value, Buffer.alloc(max - value.length)]);
  };
  add("ATTRIBUTE", 0x0404, Buffer.from([0x10, 0, 0, 0]), 4);
  for (const [key, value] of text) {
    const v = Buffer.concat([Buffer.from(value, "utf8"), Buffer.from([0])]);
    add(key, 0x0204, v, Math.floor((v.length + 3) / 4) * 4 + 4);
  }
  while (keys.length % 4) keys = Buffer.concat([keys, Buffer.from([0])]);
  const table = Buffer.concat(entries);
  const keyStart = 20 + table.length;
  return Buffer.concat([Buffer.from("\0PSF", "latin1"), le32(0x101), le32(keyStart), le32(keyStart + keys.length), le32(entries.length), table, keys, values]);
}

function put(file, data) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, data);
  utimesSync(file, FIXED_TIME, FIXED_TIME);
}

/** Makes the card under `at`; returns its ux0 folder. */
export function makeCard(at) {
  rmSync(at, { recursive: true, force: true });
  const ux0 = path.join(at, "ux0");
  const p = (rel) => path.join(ux0, rel);
  put(p("app/PCSE00001/eboot.bin"), "eboot");
  put(p("app/PCSE00001/sce_sys/param.sfo"), sfo([["TITLE", 'Game "One"\n'], ["APP_VER", "01.00"], ["CATEGORY", "gd"]]));
  put(p("app/PCSE00001/sce_sys/package/head.bin"), "head");
  put(p("app/PCSE00001/sce_sys/package/work.bin"), FAKE_WORK);
  put(p("app/VITASHELL/eboot.bin"), "shell");
  put(p("app/VITASHELL/sce_sys/param.sfo"), sfo([["TITLE", "VitaShell"], ["APP_VER", "02.02"], ["CATEGORY", "gd"]]));
  put(p("app/notatitle/eboot.bin"), "skipped");
  put(p("patch/PCSE00001/eboot.bin"), "patched");
  put(p("patch/PCSE00001/sce_sys/param.sfo"), sfo([["TITLE", 'Game "One"\n'], ["APP_VER", "01.05"], ["CATEGORY", "gp"]]));
  put(p("addcont/PCSE00001/DLC0000000000001/data.bin"), "dlc");
  put(p("license/app/PCSE00001/6488b73b912a753a492e2714e9b38bc7.rif"), FAKE_RIF); // privacy-ok: a made-up licence name
  put(p("license/addcont/PCSE00001/DLC0000000000001/6488b73b912a753a492e2714e9b38bc7.rif"), FAKE_RIF); // privacy-ok: same
  put(p("license/license.db"), FAKE_DB);
  put(p("user/00/savedata/PCSE00001/sce_sys/param.sfo"), "save-sfo");
  put(p("user/00/savedata/PCSE00001/slot0"), "save");
  put(p("user/00/trophy/conf/x"), "not backed up");
  put(p("repatch/PCSE00001/eboot.bin"), "overlay");
  put(p("reAddcont/PCSE00001/DLC0000000000002/data.bin"), "overlay-dlc");
  put(p("pspemu/ISO/Disc [K].iso"), "iso");
  put(p("pspemu/ISO/Other.CSO"), "cso");
  put(p("pspemu/ISO/readme.txt"), "skipped");
  put(p("pspemu/PSP/GAME/SLPM00001/EBOOT.PBP"), "pbp");
  put(p("pspemu/PSP/SAVEDATA/ULJS00001/DATA.BIN"), "psp-save");
  put(p("pspemu/seplugins/POPS.txt"), "pops");
  put(p("data/retroarch/retroarch.cfg"), "cfg");
  put(p("data/retroarch/config/Snes9x/Game.cfg"), "core cfg");
  put(p("data/retroarch/savefiles/Game.srm"), "srm");
  put(p("data/retroarch/system/bios.bin"), "bios");
  put(p("data/retroarch/assets/x.png"), "not backed up");
  // A link out of the card is never followed.
  put(path.join(at, "outside/escape.bin"), "outside");
  symlinkSync(path.join(at, "outside"), p("app/PCSE00001/link"));
  return ux0;
}

/** The client's manifests of the card, one per line, as it wrote them. */
export const fixtureLines = (text) => text.split("\n").filter(Boolean).map((line) => line.replace(/\tprivacy-ok$/, ""));
