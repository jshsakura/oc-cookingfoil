/**
 * The RetroArch base pack: everything a console needs once before it can play,
 * as the operator lays it out under <retro dir>/base-pack/:
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
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import debug from "../debug.js";
import { fitsUstar } from "../helpers/ustar.js";

const ONCE = new Set(["retroarch/retroarch.cfg"]);
const READ_CHUNK = 1024 * 1024;

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

export class HashCache {
  constructor(file) {
    this.file = file;
    this.map = new Map();
    try {
      for (const [abs, v] of Object.entries(JSON.parse(fs.readFileSync(file, "utf8")))) this.map.set(abs, v);
    } catch (err) {
      if (err.code !== "ENOENT") debug.error("retro: ignoring %s: %s", file, err.message);
    }
  }

  async hash(f) {
    const key = `${f.size}:${f.mtimeMs}:${f.ino}`;
    const hit = this.map.get(f.abs);
    if (hit?.key === key) return hit.hash;
    const h = crypto.createHash("sha256");
    for await (const chunk of fs.createReadStream(f.abs, { highWaterMark: READ_CHUNK })) h.update(chunk);
    const hash = h.digest("hex");
    this.map.set(f.abs, { key, hash });
    this.dirty = true;
    return hash;
  }

  /** Save, keeping only the files still in the pack. */
  save(keep) {
    if (!this.dirty && this.map.size === keep.size) return;
    for (const abs of this.map.keys()) if (!keep.has(abs)) this.map.delete(abs);
    try {
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.map)));
      fs.renameSync(tmp, this.file);
      this.dirty = false;
    } catch (err) {
      debug.error("retro: could not save %s: %s", this.file, err.message);
    }
  }
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
