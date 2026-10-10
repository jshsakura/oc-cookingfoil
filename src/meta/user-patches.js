/**
 * User patches: mods and cheats people collect by hand and drop on the server,
 * for a client to install onto the SD card and switch on and off.
 *
 *   <patchesDir>/<base title id>/<patch folder>/<SD root layout>  (+ optional patch.json)
 *
 * Every file must sit under a path the patch's own game owns; one stray file
 * (or a symlink, or a path ustar cannot hold) drops the whole patch from the
 * list and is only logged. patch.json is metadata and never ships.
 *
 * The folder is scanned on a timer; content hashes are cached by
 * (size, mtime, inode) so a rescan only reads files that changed.
 */
import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import debug from "../debug.js";
import { patchesDir } from "../helpers/envs.js";
import { fitsUstar, MAX_FILE_SIZE } from "../helpers/ustar.js";

const TITLE_ID_RE = /^[0-9A-F]{16}$/;
const META_FILE = "patch.json";
const SCAN_INTERVAL_MS = 60_000;
const STALE_MS = 30_000;
const MAX_FILES = 20_000;
const FIELD_MAX = { name: 120, version: 40, game_version: 40, author: 120, description: 2000 };
const KIND_ORDER = ["romfs", "exefs", "cheats", "exefs_patches", "fpslocker"];
// Desktop clutter that rides along when a folder is copied by hand; never shipped.
const JUNK_RE = /^(\.DS_Store|Thumbs\.db|desktop\.ini|\._.*)$/i;

let patches = []; // sorted by title id, then name
let scannedAt = 0;
let inFlight = null;
let signature = "";
const fileHashes = new Map(); // abs path → { key, hash }

const isBase = (tid) => TITLE_ID_RE.test(tid) && (BigInt(`0x${tid}`) & 0x1fffn) === 0n;

/** "0100…000-1a2b3c4d5e6f": the title id and a hash of the folder name. Pure. */
export function patchId(titleId, folder) {
  const digest = crypto.createHash("sha256").update(folder.normalize("NFC")).digest("hex");
  return `${titleId}-${digest.slice(0, 12)}`;
}

/**
 * The kind a file adds ("cheats", …), "" for an allowed file of no listed
 * kind, or null when the path is outside what the game owns. Pure.
 */
export function kindOf(relPath, titleId) {
  const parts = relPath.split("/");
  if (parts.some((p) => !p || p === "." || p === ".." || p.includes("\\") || p.includes("\0"))) return null;
  const lower = parts.map((p) => p.toLowerCase());
  const tid = titleId.toLowerCase();
  if (lower[0] === "atmosphere" && lower[1] === "contents" && lower[2] === tid && parts.length >= 4) {
    return ["romfs", "exefs", "cheats"].includes(lower[3]) && parts.length >= 5 ? lower[3] : "";
  }
  if (lower[0] === "atmosphere" && lower[1] === "exefs_patches" && parts.length >= 4) return "exefs_patches";
  if (lower.slice(0, 4).join("/") === "saltysd/plugins/fpslocker/patches" && lower[4] === tid && parts.length >= 6) {
    return "fpslocker";
  }
  return null;
}

/** patch.json fields as trimmed, length-capped strings; anything else dropped. Pure. */
export function readMeta(raw) {
  const out = {};
  for (const [key, max] of Object.entries(FIELD_MAX)) {
    const v = raw?.[key];
    if (typeof v === "string" || typeof v === "number") {
      const s = String(v).trim().slice(0, max);
      if (s) out[key] = s;
    }
  }
  return out;
}

class Rejected extends Error {}

async function walk(root, rel = "", out = []) {
  const dir = rel ? path.join(root, rel) : root;
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    if (JUNK_RE.test(entry.name)) continue;
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    const st = await fsp.lstat(path.join(dir, entry.name));
    if (st.isSymbolicLink()) throw new Rejected(`symlink ${relPath}`);
    if (st.isDirectory()) await walk(root, relPath, out);
    else if (st.isFile()) out.push({ path: relPath, abs: path.join(dir, entry.name), size: st.size, mtimeMs: st.mtimeMs, ino: st.ino });
    else throw new Rejected(`not a regular file: ${relPath}`);
    if (out.length > MAX_FILES) throw new Rejected(`more than ${MAX_FILES} files`);
  }
  return out;
}

async function hashFile(file) {
  const key = `${file.size}:${file.mtimeMs}:${file.ino}`;
  const cached = fileHashes.get(file.abs);
  if (cached?.key === key) return cached.hash;
  const h = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file.abs)) h.update(chunk);
  const hash = h.digest("hex");
  fileHashes.set(file.abs, { key, hash });
  return hash;
}

async function readMetaFile(file, label) {
  try {
    return readMeta(JSON.parse(await fsp.readFile(file.abs, "utf8")));
  } catch (err) {
    debug.error("patches: %s: ignoring %s: %s", label, META_FILE, err.message);
    return {};
  }
}

/**
 * Reads one patch folder: its listing entry plus `entries`, the files to ship
 * (absolute path, SD path, size, mtime). Throws Rejected when it breaks a rule.
 */
export async function readPatch(root, tidDir, folder) {
  const titleId = tidDir.toUpperCase();
  const label = `${tidDir}/${folder}`;
  const all = await walk(path.join(root, tidDir, folder));
  const metaFile = all.find((f) => f.path === META_FILE);
  const files = all.filter((f) => f !== metaFile).sort((a, b) => (a.path < b.path ? -1 : 1));
  if (!files.length) throw new Rejected("no files");
  const kinds = new Set();
  for (const f of files) {
    const kind = kindOf(f.path, titleId);
    if (kind === null) throw new Rejected(`outside the allowed folders: ${f.path}`);
    if (!fitsUstar(f.path)) throw new Rejected(`path too long for tar: ${f.path}`);
    if (f.size > MAX_FILE_SIZE) throw new Rejected(`file too large: ${f.path}`);
    if (kind) kinds.add(kind);
  }
  const meta = metaFile ? await readMetaFile(metaFile, label) : {};
  const content = crypto.createHash("sha256");
  for (const f of files) content.update(`${f.path}\0${await hashFile(f)}\n`);
  const updated = Math.max(...all.map((f) => f.mtimeMs));
  return {
    patch: {
      id: patchId(titleId, folder),
      title_id: titleId,
      name: meta.name ?? folder.normalize("NFC"),
      version: meta.version ?? null,
      game_version: meta.game_version ?? null,
      author: meta.author ?? null,
      description: meta.description ?? null,
      kinds: KIND_ORDER.filter((k) => kinds.has(k)),
      files: files.length,
      size: files.reduce((n, f) => n + f.size, 0),
      updated_at: Math.floor(updated / 1000),
      hash: content.digest("hex"),
    },
    dir: tidDir,
    folder,
    entries: files.map((f) => ({ abs: f.abs, path: f.path, size: f.size, mtime: f.mtimeMs / 1000 })),
  };
}

async function subdirs(dir) {
  try {
    return (await fsp.readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (err) {
    if (err.code !== "ENOENT") debug.error("patches: cannot read %s: %s", dir, err.message);
    return [];
  }
}

/** Every valid patch under `root`, sorted by title id then name. */
export async function scanDir(root) {
  const out = [];
  for (const tidDir of await subdirs(root)) {
    if (!isBase(tidDir.toUpperCase())) {
      debug.log("patches: skipping %s (not a base title id)", tidDir);
      continue;
    }
    for (const folder of await subdirs(path.join(root, tidDir))) {
      try {
        out.push({ ...(await readPatch(root, tidDir, folder)).patch, dir: tidDir, folder });
      } catch (err) {
        if (!(err instanceof Rejected)) throw err;
        debug.error("patches: %s/%s left out: %s", tidDir, folder, err.message);
      }
    }
  }
  return out.sort((a, b) => a.title_id.localeCompare(b.title_id) || a.name.localeCompare(b.name));
}

/** Rescans now (one scan at a time); `onChange` runs when the set or a hash changed. */
export function scan({ root = patchesDir, onChange } = {}) {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const next = await scanDir(root);
      const sig = next.map((p) => `${p.id}:${p.hash}:${p.name}:${p.updated_at}`).join("|");
      patches = next;
      scannedAt = Date.now();
      if (sig !== signature) {
        signature = sig;
        debug.log("patches: %d patches", next.length);
        onChange?.();
      }
      return patches;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** First scan, then one every minute. */
export function start({ onChange } = {}) {
  const run = () => scan({ onChange }).catch((err) => debug.error("patches: scan failed: %s", err.message));
  run();
  setInterval(run, SCAN_INTERVAL_MS).unref();
}

/** The listing, rescanned first when it is older than half a minute. */
export async function list() {
  if (Date.now() - scannedAt > STALE_MS) await scan();
  return patches.map(publicFields);
}

function publicFields({ dir: _dir, folder: _folder, ...p }) {
  return p;
}

export function forTitle(titleId) {
  const tid = String(titleId ?? "").toUpperCase();
  return patches.filter((p) => p.title_id === tid).map(publicFields);
}

export function countFor(titleId) {
  const tid = String(titleId ?? "").toUpperCase();
  return patches.reduce((n, p) => n + (p.title_id === tid), 0);
}

/** A patch read afresh from disk for download, or null when it is gone or no longer valid. */
export async function openForDownload(id, root = patchesDir) {
  const known = patches.find((p) => p.id === id);
  if (!known) return null;
  try {
    return await readPatch(root, known.dir, known.folder);
  } catch (err) {
    if (err instanceof Rejected || err.code === "ENOENT") return null;
    throw err;
  }
}

/** For tests. */
export function reset() {
  patches = [];
  scannedAt = 0;
  signature = "";
  fileHashes.clear();
}
