/**
 * User patches: mods and cheats people collect by hand and drop on the server,
 * for a client to install onto the SD card and switch on and off.
 *
 *   <patchesDir>/<base title id>/<patch folder>/<SD root layout>  (+ optional patch.json)
 *   <patchesDir>/homebrew/<app>/<patch folder>/<files of switch/<app>/>
 *
 * A homebrew app's patch (a port's mods, say) holds files relative to its
 * switch/<app>/ folder; it is listed with `homebrew: <app>` and no title id,
 * and its archive puts every file under switch/<app>/.
 *
 * Every file must sit under a path the patch's own game owns; one stray file
 * (or a symlink, or a path ustar cannot hold) drops the whole patch from the
 * list and is only logged. patch.json is metadata and never ships.
 *
 * The folder is scanned on a timer; content hashes are cached by
 * (size, mtime, inode) so a rescan only reads files that changed. The cache
 * and the last listing are saved under the data dir, so a restart neither
 * re-reads gigabytes of patches nor makes a request wait for a fresh scan.
 */
import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import debug from "../debug.js";
import { patchesDir, dataDir } from "../helpers/envs.js";
import { fitsUstar, MAX_FILE_SIZE } from "../helpers/ustar.js";
import { pathProblem } from "./console-paths.js";

const TITLE_ID_RE = /^[0-9A-F]{16}$/;
const META_FILE = "patch.json";
const SCAN_INTERVAL_MS = 60_000;
const CACHE_SAVE_MS = 30_000;
const CACHE_PATH = path.join(dataDir, "patches-cache.json");
const READ_CHUNK = 1024 * 1024; // big sequential reads; the patches live on spinning disks
const STALE_MS = 30_000;
const MAX_FILES = 20_000;
const FIELD_MAX = { name: 120, version: 40, game_version: 40, author: 120, description: 2000 };
const KIND_ORDER = ["romfs", "exefs", "cheats", "exefs_patches", "fpslocker"];
// Desktop clutter that rides along when a folder is copied by hand; never shipped.
const JUNK_RE = /^(\.DS_Store|Thumbs\.db|desktop\.ini|\._.*)$/i;

let patches = []; // sorted by title id, then name
let provisional = null; // during the first scan: the patches read so far
let scannedAt = 0;
let inFlight = null;
let signature = "";
const fileHashes = new Map(); // abs path → { key, hash }
let touched = null; // abs paths hashed by the scan in progress

const isBase = (tid) => TITLE_ID_RE.test(tid) && (BigInt(`0x${tid}`) & 0x1fffn) === 0n;

const HOMEBREW_DIR = "homebrew";
const APP_RE = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,63}$/;
const short = (s) => crypto.createHash("sha256").update(s.normalize("NFC")).digest("hex").slice(0, 12);

/** "hb-<app hash>-<folder hash>" for a homebrew app's patch. Pure. */
export function homebrewPatchId(app, folder) {
  return `hb-${short(app.toLowerCase())}-${short(folder)}`;
}

/** "0100…000-1a2b3c4d5e6f": the title id and a hash of the folder name. Pure. */
export function patchId(titleId, folder) {
  const digest = crypto.createHash("sha256").update(folder.normalize("NFC")).digest("hex");
  return `${titleId}-${digest.slice(0, 12)}`;
}

/**
 * The ids a game's patch may install under: its own title id, its other
 * programs (program index 1-F, e.g. the second game of a collection), its
 * update (+0x800) and its add-on content such as a language pack (+0x1000 and
 * up). A base id has its low 13 bits clear and every id of the game shares the
 * rest, so another game never matches. Pure.
 */
function ownsProgram(dir, tid) {
  return /^[0-9a-f]{16}$/.test(dir) && BigInt(`0x${dir}`) >> 13n === BigInt(`0x${tid}`) >> 13n;
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
  if (lower[0] === "atmosphere" && lower[1] === "contents" && ownsProgram(lower[2], tid) && parts.length >= 4) {
    return ["romfs", "exefs", "cheats"].includes(lower[3]) && parts.length >= 5 ? lower[3] : "";
  }
  if (lower[0] === "atmosphere" && lower[1] === "exefs_patches" && parts.length >= 4) return "exefs_patches";
  if (lower.slice(0, 4).join("/") === "saltysd/plugins/fpslocker/patches" && lower[4] === tid && parts.length >= 6) {
    return "fpslocker";
  }
  return null;
}

/**
 * patch.json fields as trimmed, length-capped strings; anything else dropped.
 * `required: true` marks a patch the game does not start without (its data
 * shipped apart from the package). `ko` holds the Korean name and description
 * when they differ from the default text (localizePatch picks by language). Pure.
 */
export function readMeta(raw) {
  const out = strings(raw, FIELD_MAX);
  if (raw?.required === true) out.required = true;
  const ko = strings(raw?.ko, { name: FIELD_MAX.name, description: FIELD_MAX.description });
  if (Object.keys(ko).length) out.ko = ko;
  return out;
}

function strings(raw, limits) {
  const out = {};
  for (const [key, max] of Object.entries(limits)) {
    const v = raw?.[key];
    if (typeof v === "string" || typeof v === "number") {
      const s = String(v).trim().slice(0, max);
      if (s) out[key] = s;
    }
  }
  return out;
}

/** A patch as one language sees it: the Korean name and description for "ko" when it has them. Pure. */
export function localizePatch(patch, lang) {
  const { ko, ...rest } = patch;
  if (lang !== "ko" || !ko) return rest;
  return { ...rest, name: ko.name ?? rest.name, description: ko.description ?? rest.description };
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
  touched?.add(file.abs);
  const cached = fileHashes.get(file.abs);
  if (cached?.key === key) return cached.hash;
  const h = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file.abs, { highWaterMark: READ_CHUNK })) h.update(chunk);
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
/** A homebrew app's patch: every file goes under switch/<app>/. */
async function readHomebrewPatch(root, app, folder) {
  const label = `${HOMEBREW_DIR}/${app}/${folder}`;
  const all = await walk(path.join(root, HOMEBREW_DIR, app, folder));
  const metaFile = all.find((f) => f.path === META_FILE);
  const files = all.filter((f) => f !== metaFile).map((f) => ({ ...f, path: `switch/${app}/${f.path}` })).sort((a, b) => (a.path < b.path ? -1 : 1));
  if (!files.length) throw new Rejected("no files");
  for (const f of files) {
    if (f.path.split("/").some((p) => !p || p === "." || p === "..")) throw new Rejected(`bad path: ${f.path}`);
    if (!fitsUstar(f.path)) throw new Rejected(`path too long for tar: ${f.path}`);
    const problem = pathProblem(f.path);
    if (problem) throw new Rejected(`the console can't create ${f.path}: ${problem}`);
    if (f.size > MAX_FILE_SIZE) throw new Rejected(`file too large: ${f.path}`);
  }
  const meta = metaFile ? await readMetaFile(metaFile, label) : {};
  const content = crypto.createHash("sha256");
  for (const f of files) content.update(`${f.path}\0${await hashFile(f)}\n`);
  return {
    patch: {
      id: homebrewPatchId(app, folder),
      title_id: null,
      homebrew: app,
      name: meta.name ?? folder.normalize("NFC"),
      version: meta.version ?? null,
      game_version: meta.game_version ?? null,
      author: meta.author ?? null,
      description: meta.description ?? null,
      required: meta.required === true,
      ...(meta.ko ? { ko: meta.ko } : {}),
      kinds: ["homebrew"],
      files: files.length,
      size: files.reduce((n, f) => n + f.size, 0),
      updated_at: Math.floor(Math.max(...all.map((f) => f.mtimeMs)) / 1000),
      hash: content.digest("hex"),
    },
    dir: `${HOMEBREW_DIR}/${app}`,
    folder,
    entries: files.map((f) => ({ abs: f.abs, path: f.path, size: f.size, mtime: f.mtimeMs / 1000 })),
  };
}

export async function readPatch(root, tidDir, folder) {
  if (tidDir.startsWith(`${HOMEBREW_DIR}/`)) return readHomebrewPatch(root, tidDir.slice(HOMEBREW_DIR.length + 1), folder);
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
    const problem = pathProblem(f.path);
    if (problem) throw new Rejected(`the console can't create ${f.path}: ${problem}`);
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
      required: meta.required === true,
      ...(meta.ko ? { ko: meta.ko } : {}),
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

const sortPatches = (list) => list.sort((a, b) => (a.title_id ?? `~${a.homebrew}`).localeCompare(b.title_id ?? `~${b.homebrew}`) || a.name.localeCompare(b.name));
// Test-only: a pause per patch, to make a scan last long enough to watch requests during it.
const SLOW_SCAN_MS = Number(process.env.COOK_TEST_SLOW_SCAN_MS) || 0;

/** Every valid patch under `root`, sorted by title id then name. `onFound(list)` sees the ones read so far. */
export async function scanDir(root, { onFound = null } = {}) {
  const out = [];
  const found = (p) => {
    out.push(p);
    onFound?.(sortPatches([...out]));
  };
  for (const tidDir of await subdirs(root)) {
    if (tidDir === HOMEBREW_DIR) {
      for (const app of (await subdirs(path.join(root, HOMEBREW_DIR))).filter((a) => APP_RE.test(a))) {
        for (const folder of await subdirs(path.join(root, HOMEBREW_DIR, app))) {
          try {
            found({ ...(await readHomebrewPatch(root, app, folder)).patch, dir: `${HOMEBREW_DIR}/${app}`, folder });
          } catch (err) {
            if (!(err instanceof Rejected)) throw err;
            debug.error("patches: homebrew/%s/%s left out: %s", app, folder, err.message);
          }
        }
      }
      continue;
    }
    if (!isBase(tidDir.toUpperCase())) {
      debug.log("patches: skipping %s (not a base title id)", tidDir);
      continue;
    }
    for (const folder of await subdirs(path.join(root, tidDir))) {
      try {
        if (SLOW_SCAN_MS) await new Promise((r) => setTimeout(r, SLOW_SCAN_MS));
        found({ ...(await readPatch(root, tidDir, folder)).patch, dir: tidDir, folder });
      } catch (err) {
        if (!(err instanceof Rejected)) throw err;
        debug.error("patches: %s/%s left out: %s", tidDir, folder, err.message);
      }
    }
  }
  return sortPatches(out);
}

const signatureOf = (list) => list.map((p) => `${p.id}:${p.hash}:${p.name}:${p.updated_at}`).join("|");

/** Restore the last listing and the hash cache, so the first request is answered at once. */
export function loadCache(file = CACHE_PATH) {
  try {
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const [abs, entry] of Object.entries(saved?.hashes ?? {})) {
      if (typeof entry?.key === "string" && typeof entry?.hash === "string") fileHashes.set(abs, entry);
    }
    // A cache saved halfway through the first scan has hashes but no listing yet.
    if (!Array.isArray(saved?.patches)) return false;
    patches = saved.patches;
    signature = signatureOf(patches);
    return true;
  } catch (err) {
    if (err.code !== "ENOENT") debug.error("patches: ignoring %s: %s", file, err.message);
    return false;
  }
}

function saveCache(file, seen) {
  try {
    // Only hashes of files the scan still found, so the cache can't grow without bound.
    // Mid-scan (no `seen` yet) every hash so far is kept, and no listing unless a whole scan made one.
    const hashes = Object.fromEntries(seen ? [...fileHashes].filter(([abs]) => seen.has(abs)) : fileHashes);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, patches: seen || signature ? patches : null, hashes }));
    fs.renameSync(tmp, file);
  } catch (err) {
    debug.error("patches: could not save %s: %s", file, err.message);
  }
}

/** Rescans now (one scan at a time); `onChange` runs when the set or a hash changed. */
export function scan({ root = patchesDir, onChange, cacheFile = root === patchesDir ? CACHE_PATH : null } = {}) {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const hashedBefore = fileHashes.size;
      touched = new Set();
      const cold = !scannedAt && !signature;
      // Hashes are saved as the scan goes, so a restart halfway through a big folder doesn't start over.
      const saver = cacheFile ? setInterval(() => saveCache(cacheFile, null), CACHE_SAVE_MS) : null;
      saver?.unref();
      let next;
      try {
        // With nothing listed yet, what has been read so far is shown while the rest is read.
        next = await scanDir(root, { onFound: cold ? (soFar) => { provisional = soFar; } : null });
      } finally {
        if (saver) clearInterval(saver);
      }
      provisional = null;
      const seen = touched;
      const sig = signatureOf(next);
      patches = next;
      scannedAt = Date.now();
      if (cacheFile && (sig !== signature || fileHashes.size !== hashedBefore || !fs.existsSync(cacheFile))) {
        saveCache(cacheFile, seen);
      }
      if (sig !== signature) {
        signature = sig;
        debug.log("patches: %d patches", next.length);
        onChange?.();
      }
      return patches;
    } finally {
      touched = null;
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Restore the saved listing, then scan now and every minute. */
export function start({ onChange } = {}) {
  if (loadCache()) debug.log("patches: %d patches from the saved listing", patches.length);
  const run = () => scan({ onChange }).catch((err) => debug.error("patches: scan failed: %s", err.message));
  run();
  setInterval(run, SCAN_INTERVAL_MS).unref();
}

/**
 * The listing, without ever making a request wait for a scan: a stale one is
 * refreshed in the background, and before the first scan has finished it is
 * what has been read so far, with `scanning: true`.
 */
export async function list(scanOptions = {}) {
  if (Date.now() - scannedAt > STALE_MS) scan(scanOptions).catch((err) => debug.error("patches: scan failed: %s", err.message));
  const scanning = !scannedAt && !signature;
  return Object.assign((scanning ? provisional ?? [] : patches).map(publicFields), { scanning });
}

function publicFields({ dir: _dir, folder: _folder, ...p }) {
  // A listing cached before `required` existed reads as not required.
  return { ...p, required: p.required === true };
}

export function forTitle(titleId) {
  const tid = String(titleId ?? "").toUpperCase();
  return patches.filter((p) => p.title_id === tid).map(publicFields);
}

export function countFor(titleId) {
  const tid = String(titleId ?? "").toUpperCase();
  return patches.reduce((n, p) => n + (p.title_id === tid), 0);
}

/** Where a listed patch sits under the root ({ dir, folder }), or null. */
export function locate(id) {
  const known = patches.find((p) => p.id === id);
  return known ? { dir: known.dir, folder: known.folder } : null;
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
