/**
 * Firmware a console's core needs, or can use, in RetroArch's system folder.
 * The files are copyrighted, so the server never ships or fetches them: the
 * operator puts them in <retro dir>/retroarch/system/ and the admin page says
 * which the games in the library still need (requirements.js).
 *
 *   BIOS[id] = { groups, extra?, md5?, nested?, exact? }
 *     groups    required: every group must be met; a group is met by any one
 *               of its files (paths relative to retroarch/system/, which is
 *               also where the core looks for them on the console)
 *     extra     [{ files, required?, ext? }] more groups: optional unless
 *               `required`, and with `ext` only while the system has a game
 *               with one of those extensions (the FDS BIOS for .fds disks)
 *     md5       { file: [md5, …] } the dumps libretro documents; a file under
 *               another name with one of these is recognised as that file
 *     nested    the core searches the file's folder and every folder under it
 *               (NeoCD reads system/neocd/ and its subfolders)
 *     exact     only that exact path will do (blueMSX's Machines/ tree)
 *
 * The operator manages the files; the server never renames or moves them. It
 * recognises them where people usually put them: any letter case, at the top
 * of system/, or in a folder named after the system (id or server folder), its
 * core, or "bios", or by md5 under another name. The base pack sends every
 * file at its own path and, while nothing is there, one more copy of a
 * recognised file under the path its core reads (firmwareDelivery).
 *
 * Sources: the BIOS table of each core's page in the libretro docs
 * (github.com/libretro/docs, docs/library/<core>.md) and the core's info file
 * (github.com/libretro/libretro-core-info, <core>_libretro.info), read on
 * 2026-10-22. A file without a documented md5 has none here.
 *
 * Rules are keyed by system id and only apply while that system has games.
 */
import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { fileKey } from "../helpers/hash-cache.js";
import { isReadme } from "../helpers/readme-name.js";
import { DEFAULT_SYSTEMS } from "./systems.js";

// NeoCD takes any one of these (front loader, top loader, CDZ, Universe BIOS),
// from system/neocd/ and the folders under it.
const NEOCD_DIR = "neocd";
const NEOCD = ["neocd_f.rom", "neocd_sf.rom", "front-sp1.bin", "neocd_t.rom", "neocd_st.rom", "top-sp1.bin",
  "neocd_z.rom", "neocd_sz.rom", "neocd.bin", "uni-bioscd.rom"];

// Genesis Plus GX: "BIOS choice isn't locked to any specific revisions"; PicoDrive's page lists another US dump.
const SEGA_CD_MD5 = {
  "bios_CD_U.bin": ["854b9150240a198070150e4566ae1290", "2efd74e3232ff260e371b99f84024f7f"],
  "bios_CD_E.bin": ["e66fa1dc5820d254611fdcdba0662372"],
  "bios_CD_J.bin": ["278a9397d192149e84e820ac621a8edd"],
};

export const BIOS = {
  // gearcoleco page and info: colecovision.rom required; coleco.rom and os7.u2 are the same BIOS; may sit in system/gearcoleco/.
  col: { groups: [["colecovision.rom", "coleco.rom", "os7.u2"]], md5: Object.fromEntries(["colecovision.rom", "coleco.rom", "os7.u2"].map((f) => [f, ["2c66f5911e5b42b8ebe113403548eee7"]])) },
  // o2em page: the libretro core only works with o2rom.bin.
  videopac: { groups: [["o2rom.bin"]], md5: { "o2rom.bin": ["562d5ebf9e030a40d6fabfc2f33139fd"] } },
  // bluemsx page: the Machines and Databases folders of a full blueMSX install.
  msx: { groups: [["Machines/Shared Roms/MSX.rom"], ["Databases/msxromdb.xml"]], exact: true },
  // neocd info (paths); its README gives SHA-1 only, so no md5 here.
  neocd: { groups: [NEOCD.map((f) => `${NEOCD_DIR}/${f}`)], nested: true },
  // beetle_pce_fast page: syscard3.pce required.
  pcecd: { groups: [["syscard3.pce"]], md5: { "syscard3.pce": ["38179df8f4ac870017db21ebcbf53114"] } },
  // genesis_plus_gx page: the CD BIOS of the disc's region; any one boots that region's discs.
  segacd: { groups: [["bios_CD_U.bin", "bios_CD_E.bin", "bios_CD_J.bin"]], md5: SEGA_CD_MD5 },
  // fceumm page: disksys.rom is required for Famicom Disk System games.
  nes: { groups: [], extra: [{ files: ["disksys.rom"], required: true, ext: [".fds"] }], md5: { "disksys.rom": ["ca30b50f880eb660a320674ed365ef7a"] } },
  // gambatte page: optional boot ROMs (used with 'Use official bootloader' on).
  gb: { groups: [], extra: [{ files: ["gb_bios.bin"] }], md5: { "gb_bios.bin": ["32fbbd84168d3482956eb3c5051637f5"] } },
  gbc: { groups: [], extra: [{ files: ["gbc_bios.bin"] }], md5: { "gbc_bios.bin": ["dbfce9db9deaa2567f6a84fde55f9680"] } },
  // mgba page: optional (used with 'Use BIOS file if found' on).
  gba: { groups: [], extra: [{ files: ["gba_bios.bin"] }], md5: { "gba_bios.bin": ["a860e8c0b6d573d191e4ec7db1b1e4f6"] } },
  // genesis_plus_gx page: boot ROMs, optional (with the 'System bootrom' option).
  md: { groups: [], extra: [{ files: ["bios_MD.bin"] }], md5: { "bios_MD.bin": ["45e298905a08f9cfb38fd504cd6dbc84"] } },
  sms: {
    groups: [], extra: [{ files: ["bios_U.sms", "bios_E.sms", "bios_J.sms"] }],
    md5: { "bios_U.sms": ["840481177270d5642a14ca71ee72844c"], "bios_E.sms": ["840481177270d5642a14ca71ee72844c"], "bios_J.sms": ["24a519c53f67b00640d0048ef7089105"] },
  },
  gg: { groups: [], extra: [{ files: ["bios.gg"] }], md5: { "bios.gg": ["672e104c3be3a238301aceffc3b23fd6"] } },
  // pcsx_rearmed page: without one of these it falls back to an HLE BIOS with lower compatibility.
  ps1: {
    groups: [], extra: [{ files: ["scph5501.bin", "scph1001.bin", "scph7001.bin", "scph101.bin", "PSXONPSP660.bin"] }],
    md5: {
      "scph5501.bin": ["490f666e1afb15b7362b406ed1cea246"], "scph1001.bin": ["924e392ed05558ffdb115408c263dccf"],
      "scph7001.bin": ["1e68c231d0896b7eadcad1d7d8e76129"], "scph101.bin": ["6e3735ff4c7dc899ee98981385f6f3d0"],
      "PSXONPSP660.bin": ["c53ca5908936d412331790f4426c6c33"],
    },
  },
  // melonds page: all optional.
  nds: {
    groups: [], extra: [{ files: ["bios7.bin"] }, { files: ["bios9.bin"] }, { files: ["firmware.bin"] }],
    md5: { "bios7.bin": ["df692a80a5b1bc90728bc3dfc76cd948"], "bios9.bin": ["a392174eb3e572fed6447e956bde4b25"] },
  },
  // yabause page: optional, but required to load .m3u (multi-disc) games; "the md5sum is just a hint".
  saturn: { groups: [], extra: [{ files: ["saturn_bios.bin"], required: true, ext: [".m3u"] }, { files: ["saturn_bios.bin"] }], md5: { "saturn_bios.bin": ["af5828fdff51384f99b3c4926be27762"] } },
  // prosystem page: optional.
  a7800: { groups: [], extra: [{ files: ["7800 BIOS (U).rom"] }], md5: { "7800 BIOS (U).rom": ["0763f1ffb006ddbe32e52d497ee848ae"] } },
  // handy info marks lynxboot.img optional (its docs page still says required).
  lynx: { groups: [], extra: [{ files: ["lynxboot.img"] }], md5: { "lynxboot.img": ["fcd403db69f54290b51035d82f835e7b"] } },
};

const MAX_DEPTH = 4;
/** No BIOS is this big; a bigger file is not hashed. */
export const FIRMWARE_HASH_MAX = 64 * 1024 * 1024;

const lower = (s) => String(s).toLowerCase();
const baseOf = (f) => f.slice(f.lastIndexOf("/") + 1);
const dirOf = (f) => f.slice(0, Math.max(0, f.lastIndexOf("/")));
/** A path with a hidden or empty part, which the base pack never sends. Pure. */
const hidden = (rel) => rel.split("/").some((p) => !p || p.startsWith("."));

/** Every group of a rule: { files, required, ext? }, the required ones first. Pure. */
export function ruleGroups(rule) {
  return [...rule.groups.map((files) => ({ files, required: true })), ...(rule.extra ?? []).map((x) => ({ required: false, ...x }))];
}

/** Folder names (lower case) a system's firmware may sit in besides its own place. */
function homes(id) {
  const s = DEFAULT_SYSTEMS[id] ?? {};
  return new Set(["bios", id, s.folder, s.core, s.coreName].filter(Boolean).map(lower));
}

/** Whether `rel` (a path under system/) can stand for `want` of system `id`, by its name. Pure. */
export function nameMatches(rel, want, id, rule = BIOS[id]) {
  const r = lower(rel);
  const w = lower(want);
  if (r === w) return true;
  if (rule.exact || baseOf(r) !== baseOf(w)) return false;
  const dir = dirOf(r);
  const wdir = dirOf(w);
  if (!dir || dir === wdir || (rule.nested && wdir && dir.startsWith(`${wdir}/`))) return true;
  return homes(id).has(dir.split("/")[0]);
}

/** [{ id, want }] for each file name (lower case) the rules know. */
function nameIndex(rules) {
  const index = new Map();
  for (const [id, rule] of Object.entries(rules)) {
    for (const g of ruleGroups(rule)) for (const want of g.files) {
      const key = lower(baseOf(want));
      if (!(index.get(key) ?? []).some((x) => x.want === want)) index.set(key, [...(index.get(key) ?? []), { id, want }]);
    }
  }
  return index;
}
const NAMES = nameIndex(BIOS);

/**
 * The path a file of the system folder's core reads it under when the table
 * knows it by name (SCPH5501.BIN → scph5501.bin, bios/neocd_f.rom →
 * neocd/neocd_f.rom); a NeoCD file already somewhere under neocd/ and any
 * other file keep their path. Pure.
 */
export function consoleFirmwarePath(rel, rules = BIOS) {
  const names = rules === BIOS ? NAMES : nameIndex(rules);
  for (const { id, want } of names.get(lower(baseOf(rel))) ?? []) {
    const rule = rules[id];
    if (!nameMatches(rel, want, id, rule)) continue;
    if (rule.nested && lower(rel).startsWith(`${lower(dirOf(want))}/`)) return rel;
    return want;
  }
  return rel;
}

/** Where the base pack sends a file of the system folder: its own path, but a NeoCD BIOS at the top goes into neocd/. Pure. */
export function packFirmwarePath(rel) {
  return !rel.includes("/") && NEOCD.includes(rel) ? `${NEOCD_DIR}/${rel}` : rel;
}

/**
 * Which file of the system folder the console gets at each path, one source
 * per path: Map(lower-case path → { rel, path, copy, rank }). Every file goes
 * at its own path (packFirmwarePath). A file known by name somewhere else
 * (consoleFirmwarePath) or by md5 (`renames`, from firmwareRenames) also goes
 * as a copy to the path its core reads, only while no file has that path.
 * The console's file system ignores case, so paths that differ only in case
 * are one path. When several files want one path, the first wins of: a file
 * named exactly as its core reads it (rank 0), any other at its own path (1),
 * a copy of a file known by name (2), a copy of a file known by md5 (3); then
 * the first name in code point order. The base pack and the requirements view
 * both read this, so the view shows the very file the console gets. Pure.
 */
export function firmwareDelivery(files, renames = new Map(), rules = BIOS) {
  const out = new Map();
  const offer = (rank, rel, at, copy) => {
    const had = out.get(lower(at));
    if (had && (had.rank < rank || (had.rank === rank && had.rel < rel))) return;
    out.set(lower(at), { rel, path: at, copy, rank });
  };
  const shown = files.filter((rel) => !hidden(rel));
  for (const rel of shown) {
    const own = packFirmwarePath(rel);
    offer(own === rel && consoleFirmwarePath(rel, rules) === rel ? 0 : 1, rel, own, false);
  }
  const taken = new Set(out.keys());
  for (const rel of shown) {
    const named = consoleFirmwarePath(rel, rules);
    const byName = lower(named) !== lower(rel);
    const want = byName ? named : renames.get(rel);
    if (want && !taken.has(lower(want))) offer(byName ? 2 : 3, rel, want, true);
  }
  return out;
}

/** retroarch/system/ (or base-pack/system/, the earlier name) under the retro folder. */
export function firmwareDir(retroDir) {
  const dirs = ["retroarch", "base-pack"].map((d) => path.join(retroDir, d, "system"));
  return dirs.find((d) => fs.existsSync(d)) ?? dirs[0];
}

/** Every file under `dir` as a "/"-separated relative path, a README.md at its top left out; empty when it is missing. */
export async function listFirmware(dir, depth = 0, prefix = "") {
  const entries = await fsp.readdir(path.join(dir, prefix), { withFileTypes: true }).catch(() => []);
  const out = [];
  for (const e of entries) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory() && depth < MAX_DEPTH) out.push(...(await listFirmware(dir, depth + 1, rel)));
    else if (e.isFile() && !(depth === 0 && isReadme(e.name))) out.push(rel);
  }
  return out;
}

/**
 * [{ id, missing: [[file, …], …] }] for each of `systemIds` (the consoles that
 * have games) whose required groups `files` (paths under the system folder)
 * do not meet by name; each missing entry is one group, any one of whose files
 * would do. Pure.
 */
export function missingBios(systemIds, files, rules = BIOS) {
  return [...new Set(systemIds)]
    .filter((id) => Object.hasOwn(rules, id))
    .map((id) => ({ id, missing: rules[id].groups.filter((g) => !g.some((want) => files.some((f) => nameMatches(f, want, id, rules[id])))) }))
    .filter((x) => x.missing.length);
}

/** MD5 of small files, remembered by path and fileKey (size, mtime, ctime, inode); `reads` counts the files actually read. */
export class Md5Cache {
  constructor() {
    this.map = new Map();
    this.reads = 0;
  }

  /** The file's md5, or null when it is missing, not a file or bigger than FIRMWARE_HASH_MAX. */
  async md5(abs) {
    const st = await fsp.stat(abs).catch(() => null);
    if (!st?.isFile() || st.size > FIRMWARE_HASH_MAX) return null;
    const key = fileKey(st);
    const hit = this.map.get(abs);
    if (hit?.key === key) return hit.md5;
    const h = crypto.createHash("md5");
    for await (const chunk of fs.createReadStream(abs)) h.update(chunk);
    this.reads++;
    const md5 = h.digest("hex");
    this.map.set(abs, { key, md5 });
    return md5;
  }
}
export const md5Cache = new Md5Cache();

/** { md5: [{ id, want }] } for every documented dump. */
function hashIndex(rules) {
  const index = new Map();
  for (const [id, rule] of Object.entries(rules)) {
    for (const [want, hashes] of Object.entries(rule.md5 ?? {})) for (const h of hashes) index.set(h, [...(index.get(h) ?? []), { id, want }]);
  }
  return index;
}

/**
 * Files of the system folder that the table does not know by name but whose
 * md5 is a documented dump: Map(rel → the path its core reads). Only files at
 * the top or in a system, core or "bios" folder are hashed, and each once
 * while it stays the same (Md5Cache).
 */
export async function firmwareRenames(dir, files, cache = md5Cache, rules = BIOS) {
  const names = nameIndex(rules);
  const byHash = hashIndex(rules);
  const folders = new Set(Object.keys(rules).flatMap((id) => [...homes(id)]));
  const out = new Map();
  for (const rel of files) {
    if (hidden(rel) || names.has(lower(baseOf(rel)))) continue;
    const dir1 = dirOf(rel);
    if (dir1 && !folders.has(lower(dir1.split("/")[0]))) continue;
    const md5 = await cache.md5(path.join(dir, rel));
    const hit = md5 && byHash.get(md5)?.[0];
    if (hit) out.set(rel, hit.want);
  }
  return out;
}
