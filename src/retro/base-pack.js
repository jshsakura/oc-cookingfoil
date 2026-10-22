/**
 * The RetroArch base pack: everything a console needs once before it can play,
 * as the operator lays it out under <retro dir>/retroarch/ (or base-pack/):
 *
 *   retroarch.nro     → sdmc:/switch/retroarch_switch.nro
 *   retroarch.cfg     → sdmc:/retroarch/retroarch.cfg   (written only if missing)
 *   anything else     → sdmc:/retroarch/<same path>      (cores/, assets/, system/, …)
 *
 * except a NeoCD BIOS at the top of system/, which goes into system/neocd/
 * where that core looks. A firmware file the BIOS table recognises in another
 * folder or by its md5 under another name also goes, once (never over the
 * console's own file), to the path its core reads while no file of the pack
 * has that path (bios.js firmwareDelivery).
 *
 * A config the pack sends (retroarch.cfg, config/<core>/*.cfg) goes out without
 * its cheevos_ lines: the client writes the RetroAchievements sign-in into the
 * console's own retroarch.cfg, and an override carrying them would undo it.
 * The cleaned copy lives under <data dir>/retro-pack-clean/.
 *
 * The manifest lists each file with its size and SHA-256 so a client fetches
 * only what changed. Hashes are cached by (size, mtime, inode) in the index
 * (db/stores.js hashStore), so a restart doesn't re-read the pack.
 */
import crypto from "crypto";
import fsp from "fs/promises";
import path from "path";
import { HashCache } from "../helpers/hash-cache.js";
import { BIOS, firmwareDelivery, firmwareRenames, md5Cache, packFirmwarePath } from "./bios.js";
import { isReadme } from "../helpers/readme-name.js";
import { dataDir } from "../helpers/envs.js";

export { HashCache };

const ONCE = new Set(["retroarch/retroarch.cfg"]);

/** Where a pack file goes on the SD card, or null to leave it out. Pure. */
export function sdPathOf(rel) {
  const parts = rel.split("/");
  if (parts.some((p) => !p || p === "." || p === ".." || p.startsWith("."))) return null;
  if (rel === "retroarch.nro") return "switch/retroarch_switch.nro";
  // A README.md at the top of the BIOS folder is the operator's notes, not firmware for the console.
  if (parts.length === 2 && parts[0] === "system" && isReadme(parts[1])) return null;
  if (parts[0] === "system" && parts.length > 1) return `retroarch/system/${packFirmwarePath(parts.slice(1).join("/"))}`;
  return `retroarch/${rel}`;
}

async function walk(root, rel = "", out = []) {
  let entries;
  try {
    entries = await fsp.readdir(path.join(root, rel), { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return out;
    throw err;
  }
  for (const e of entries) {
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) await walk(root, childRel, out);
    else if (e.isFile()) out.push(childRel);
  }
  return out;
}

const CHEEVOS_RE = /^[ \t]*cheevos_[^\n]*(\n|$)/gm;
const CONFIG_MAX = 256 * 1024;
const isConfig = (sd) => sd === "retroarch/retroarch.cfg" || (sd.startsWith("retroarch/config/") && sd.endsWith(".cfg"));

/** A RetroArch config without its cheevos_ lines. Pure. */
export const withoutCheevos = (text) => text.replace(CHEEVOS_RE, "");

/** `entry` itself, or a copy of it without cheevos_ lines when it is a config that has them. */
async function cleaned(entry, cleanDir) {
  if (!isConfig(entry.path) || entry.size > CONFIG_MAX) return entry;
  const text = await fsp.readFile(entry.abs, "utf8");
  const clean = withoutCheevos(text);
  if (clean === text) return entry;
  const out = path.join(cleanDir, entry.path);
  const old = await fsp.readFile(out, "utf8").catch(() => null);
  if (old !== clean) {
    await fsp.mkdir(path.dirname(out), { recursive: true });
    await fsp.writeFile(out, clean);
  }
  const st = await fsp.stat(out);
  return { ...entry, abs: out, size: st.size, mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs, ino: st.ino };
}

/** The pack's files with their SD paths and stats (no SHA-256; only small unknown firmware files get an md5). */
export async function listPack(packDir, { cleanDir = path.join(dataDir, "retro-pack-clean"), firmware = {} } = {}) {
  const rels = await walk(packDir);
  const rules = firmware.rules ?? BIOS;
  // sdPathOf is the one gate: an operator's system/README.md never reaches the console.
  const system = rels.filter((r) => r.startsWith("system/") && sdPathOf(r)).map((r) => r.slice("system/".length));
  const renames = await firmwareRenames(path.join(packDir, "system"), system, firmware.cache ?? md5Cache, rules);
  const sources = [
    ...rels.filter((r) => !r.startsWith("system/")).map((rel) => ({ rel, sd: sdPathOf(rel), copy: false })),
    ...[...firmwareDelivery(system, renames, rules).values()].map((f) => ({ rel: `system/${f.rel}`, sd: `retroarch/system/${f.path}`, copy: f.copy })),
  ];
  const out = [];
  for (const { rel, sd, copy } of sources) {
    if (!sd) continue;
    const abs = path.join(packDir, rel);
    const st = await fsp.stat(abs);
    out.push(await cleaned({ path: sd, abs, size: st.size, mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs, ino: st.ino, once: ONCE.has(sd) || copy }, cleanDir));
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : 1));
}

/** { version, files: [{ path, size, sha256, once? }] } for the pack. */
export async function buildManifest(packDir, cache) {
  const files = await listPack(packDir);
  const out = [];
  for (const f of files) {
    const entry = { path: f.path, size: f.size, sha256: await cache.hash(f) };
    if (f.once) entry.once = true;
    out.push(entry);
  }
  cache.save(new Set(files.map((f) => f.abs)));
  const version = crypto.createHash("sha256").update(out.map((f) => `${f.path}\0${f.sha256}`).join("\n")).digest("hex").slice(0, 16);
  return { version, files: out, sources: new Map(files.map((f) => [f.path, f])) };
}
