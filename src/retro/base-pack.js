/**
 * The RetroArch base pack: everything a console needs once before it can play,
 * as the operator lays it out under <retro dir>/retroarch/ (or base-pack/):
 *
 *   retroarch.nro     → sdmc:/switch/retroarch_switch.nro
 *   retroarch.cfg     → sdmc:/retroarch/retroarch.cfg   (written only if missing)
 *   anything else     → sdmc:/retroarch/<same path>      (cores/, assets/, system/, …)
 *
 * The manifest lists each file with its size and SHA-256 so a client fetches
 * only what changed. Hashes are cached by (size, mtime, inode) in
 * <data dir>/retro-hashes.json, so a restart doesn't re-read the pack.
 */
import crypto from "crypto";
import fsp from "fs/promises";
import path from "path";
import { fitsUstar } from "../helpers/ustar.js";
import { HashCache } from "../helpers/hash-cache.js";

export { HashCache };

const ONCE = new Set(["retroarch/retroarch.cfg"]);

/** Where a pack file goes on the SD card, or null to leave it out. Pure. */
export function sdPathOf(rel) {
  const parts = rel.split("/");
  if (parts.some((p) => !p || p === "." || p === ".." || p.startsWith("."))) return null;
  if (rel === "retroarch.nro") return "switch/retroarch_switch.nro";
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

/** The pack's files with their SD paths and stats (no hashing). */
export async function listPack(packDir) {
  const files = [];
  for (const rel of await walk(packDir)) {
    const sd = sdPathOf(rel);
    if (!sd || !fitsUstar(sd)) continue;
    const abs = path.join(packDir, rel);
    const st = await fsp.stat(abs);
    files.push({ path: sd, abs, size: st.size, mtimeMs: st.mtimeMs, ino: st.ino, once: ONCE.has(sd) });
  }
  return files.sort((a, b) => (a.path < b.path ? -1 : 1));
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
