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
  // config/<Core>/ carries the core's own <Core>.cfg and <Core>.opt; a file named for a game is that game's, and goes with its bundle.
  if (parts[0] === "config" && parts.length >= 3 && (parts.length > 3 || parts[2].replace(/\.[^.]*$/, "") !== parts[1])) return null;
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

/**
 * The pack's files with their SD paths and stats (no SHA-256; only small unknown firmware files get an md5).
 * The .nro and .info of a core in `off` are left out.
 */
export async function listPack(packDir, { cleanDir = path.join(dataDir, "retro-pack-clean"), firmware = {}, off = new Set() } = {}) {
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
    if (!sd || off.has(coreOfPath(sd))) continue;
    const abs = path.join(packDir, rel);
    const st = await fsp.stat(abs);
    out.push(await cleaned({ path: sd, abs, size: st.size, mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs, ino: st.ino, once: ONCE.has(sd) || copy }, cleanDir));
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : 1));
}

/** { version, files: [{ path, size, sha256, once? }] } for the pack. */
export async function buildManifest(packDir, cache, { off } = {}) {
  const files = await listPack(packDir, { off });
  const out = [];
  for (const f of files) {
    const entry = { path: f.path, size: f.size, sha256: await cache.hash(f) };
    if (f.once) entry.once = true;
    out.push(entry);
  }
  cache.save(new Set(files.map((f) => f.abs)));
  const version = versionOf(out);
  return { version, files: out, sources: new Map(files.map((f) => [f.path, f])) };
}

const CORE_NRO_RE = /^retroarch\/cores\/([a-z0-9_]+)_libretro_libnx\.nro$/;
const CORE_INFO_RE = /^retroarch\/info\/([a-z0-9_]+)_libretro\.info$/;

/** The core an SD path belongs to (its .nro or its .info), or null. Pure. */
export const coreOfPath = (sd) => sd.match(CORE_NRO_RE)?.[1] ?? sd.match(CORE_INFO_RE)?.[1] ?? null;

const versionOf = (files, salt = "") => crypto.createHash("sha256").update(files.map((f) => `${f.path}\0${f.sha256}`).join("\n") + salt).digest("hex").slice(0, 16);

/**
 * What one console is sent of the manifest `m` ({ version, files }). Pure.
 *
 *   onDemand false   a client that takes every file (all clients before cores=ondemand): `m` itself,
 *                    the same bytes and version as before cores could be taken on demand
 *   onDemand true    every file; a core's .nro and .info carry `core`, and the .nro `onDemand: true`:
 *                    the client fetches it by its url when a game needs it, not with the rest
 */
export function manifestView(m, { onDemand }) {
  if (!onDemand) return m;
  const files = m.files.map((f) => {
    const core = coreOfPath(f.path);
    if (!core) return f;
    return CORE_NRO_RE.test(f.path) ? { ...f, core, onDemand: true } : { ...f, core };
  });
  return { version: versionOf(m.files, "\nondemand"), files };
}

/** One core's files in the manifest `m`: its .nro and .info, or [] when the pack has no .nro for it. Pure. */
export function coreFiles(m, core) {
  const files = m.files.filter((f) => coreOfPath(f.path) === core);
  return files.some((f) => CORE_NRO_RE.test(f.path)) ? files.map((f) => ({ ...f, core })) : [];
}

/** Whether a console that takes cores on demand asked so: ?cores=ondemand or the X-Retro-Cores header. Pure. */
export const wantsOnDemand = (req) => String(req.query?.cores ?? req.get?.("x-retro-cores") ?? "").toLowerCase() === "ondemand";
