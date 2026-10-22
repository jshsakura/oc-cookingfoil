/**
 * Firmware a console's core needs in RetroArch's system folder before it boots
 * a game. The files are copyrighted, so the server never ships them; the admin
 * page only says which are missing, and only for consoles that have games.
 *
 *   BIOS[id] = { groups, nested? }
 *     groups    every group must be met; a group is met by any one of its files
 *               (paths relative to retroarch/system/)
 *     nested    the core searches the file's folder and every folder under it
 *               (NeoCD reads system/neocd/ and its subfolders, by content)
 *
 * A NeoCD BIOS left at the top of the system folder, where most cores look,
 * goes to the console in neocd/, where NeoCD looks (consoleFirmwarePath), so
 * it counts as being there.
 *
 * Rules are keyed by system id and only apply while that system has games.
 */
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { isGuideName } from "../helpers/guide-file.js";

// NeoCD takes any one of these (front loader, top loader, CDZ, Universe BIOS),
// from system/neocd/ only.
const NEOCD_DIR = "neocd";
const NEOCD = ["neocd_f.rom", "neocd_sf.rom", "front-sp1.bin", "neocd_t.rom", "neocd_st.rom", "top-sp1.bin",
  "neocd_z.rom", "neocd_sz.rom", "neocd.bin", "uni-bioscd.rom"];

export const BIOS = {
  col: { groups: [["colecovision.rom"]] },
  videopac: { groups: [["o2rom.bin"]] },
  msx: { groups: [["Machines/Shared Roms/MSX.rom"], ["Databases/msxromdb.xml"]] },
  neocd: { groups: [NEOCD.map((f) => `${NEOCD_DIR}/${f}`)], nested: true },
  pcecd: { groups: [["syscard3.pce"]] },
  // The core loads the BIOS of the disc's region; any one boots that region's discs.
  segacd: { groups: [["bios_CD_U.bin", "bios_CD_E.bin", "bios_CD_J.bin"]] },
};

const MAX_DEPTH = 4;

/** Where a file of the system folder goes on the console: a NeoCD BIOS at the top moves into neocd/. Pure. */
export function consoleFirmwarePath(rel) {
  return !rel.includes("/") && NEOCD.includes(rel) ? `${NEOCD_DIR}/${rel}` : rel;
}

/** retroarch/system/ (or base-pack/system/, the earlier name) under the retro folder. */
export function firmwareDir(retroDir) {
  const dirs = ["retroarch", "base-pack"].map((d) => path.join(retroDir, d, "system"));
  return dirs.find((d) => fs.existsSync(d)) ?? dirs[0];
}

/** Every file under `dir` as a "/"-separated relative path, the folder guide at its top left out; empty when it is missing. */
export async function listFirmware(dir, depth = 0, prefix = "") {
  const entries = await fsp.readdir(path.join(dir, prefix), { withFileTypes: true }).catch(() => []);
  const out = [];
  for (const e of entries) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory() && depth < MAX_DEPTH) out.push(...(await listFirmware(dir, depth + 1, rel)));
    else if (e.isFile() && !(depth === 0 && isGuideName(e.name))) out.push(rel);
  }
  return out;
}

/**
 * [{ id, missing: [[file, …], …] }] for each of `systemIds` (the consoles that
 * have games) whose rule `files` (paths under the system folder) does not meet;
 * each missing entry is one group, any one of whose files would do. Pure.
 */
export function missingBios(systemIds, files, rules = BIOS) {
  const placed = files.map(consoleFirmwarePath);
  const have = new Set(placed);
  const nameOf = (f) => f.split("/").pop();
  const inside = (f) => {
    const dir = f.slice(0, f.lastIndexOf("/") + 1);
    return placed.some((x) => x.startsWith(dir) && nameOf(x) === nameOf(f));
  };
  const found = (rule, f) => have.has(f) || (rule.nested && inside(f));
  return [...new Set(systemIds)]
    .filter((id) => Object.hasOwn(rules, id))
    .map((id) => ({ id, missing: rules[id].groups.filter((g) => !g.some((f) => found(rules[id], f))) }))
    .filter((x) => x.missing.length);
}
