/**
 * Save files the shop hands out (say, a save with every kart unlocked), for a
 * client to restore into a player's save on the console:
 *
 *   <savesDir>/<base title id>/<save name>/<the save folder's contents>  (+ optional meta.json)
 *
 * meta.json is metadata and never ships:
 *
 *   { name, description, gameVersion?, source?: { name, url? }, ko?: { name?, description? } }
 *
 * name and description are the default (English) text; ko holds the Korean
 * ones, and saves/localize picks by the request's language. source credits
 * where the save came from.
 * A save with a symlink, a path ustar cannot hold, too many files or too many
 * bytes is left out and only logged.
 *
 * The folder is small, so it is rescanned when the listing is older than half
 * a minute; content hashes are cached by (size, mtime, inode) on disk.
 */
import crypto from "crypto";
import fsp from "fs/promises";
import path from "path";
import debug from "../debug.js";
import { fitsUstar } from "../helpers/ustar.js";
import { HashCache } from "../helpers/hash-cache.js";

const TITLE_ID_RE = /^[0-9A-F]{16}$/;
const META_FILE = "meta.json";
const STALE_MS = 30_000;
const MAX_FILES = 5000;
const MAX_BYTES = 1024 ** 3;
const FIELD_MAX = { name: 120, description: 2000, gameVersion: 40 };
const JUNK_RE = /^(\.DS_Store|Thumbs\.db|desktop\.ini|\._.*)$/i;

class Rejected extends Error {}

const isBase = (tid) => TITLE_ID_RE.test(tid) && (BigInt(`0x${tid}`) & 0x1fffn) === 0n;

/** "0100…000-1a2b3c4d5e6f": the title id and a hash of the folder name. Pure. */
export function saveId(titleId, folder) {
  return `${titleId}-${crypto.createHash("sha256").update(folder.normalize("NFC")).digest("hex").slice(0, 12)}`;
}

const SOURCE_MAX = { name: 120, url: 500 };

/** `raw`'s fields named in `limits` as trimmed, length-capped strings. Pure. */
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

/** meta.json fields as trimmed, length-capped strings; anything else dropped. Pure. */
export function readMeta(raw) {
  const out = strings(raw, FIELD_MAX);
  const source = strings(raw?.source, SOURCE_MAX);
  if (source.url && !/^https?:\/\//i.test(source.url)) delete source.url;
  if (source.name) out.source = source;
  const ko = strings(raw?.ko, { name: FIELD_MAX.name, description: FIELD_MAX.description });
  if (Object.keys(ko).length) out.ko = ko;
  return out;
}

async function walk(root, rel = "", out = []) {
  for (const entry of await fsp.readdir(rel ? path.join(root, rel) : root, { withFileTypes: true })) {
    if (JUNK_RE.test(entry.name)) continue;
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    const abs = path.join(root, relPath);
    const st = await fsp.lstat(abs);
    if (st.isSymbolicLink()) throw new Rejected(`symlink ${relPath}`);
    if (st.isDirectory()) await walk(root, relPath, out);
    else if (st.isFile()) out.push({ path: relPath, abs, size: st.size, mtimeMs: st.mtimeMs, ino: st.ino });
    else throw new Rejected(`not a regular file: ${relPath}`);
    if (out.length > MAX_FILES) throw new Rejected(`more than ${MAX_FILES} files`);
  }
  return out;
}

/** One save folder: its listing entry plus the files to ship. Throws Rejected when it breaks a rule. */
export async function readSave(root, tidDir, folder, cache) {
  const titleId = tidDir.toUpperCase();
  const all = await walk(path.join(root, tidDir, folder));
  const metaFile = all.find((f) => f.path === META_FILE);
  const files = all.filter((f) => f !== metaFile).sort((a, b) => (a.path < b.path ? -1 : 1));
  if (!files.length) throw new Rejected("no files");
  for (const f of files) if (!fitsUstar(f.path)) throw new Rejected(`path too long for tar: ${f.path}`);
  const size = files.reduce((n, f) => n + f.size, 0);
  if (size > MAX_BYTES) throw new Rejected(`larger than ${MAX_BYTES} bytes`);
  let meta = {};
  if (metaFile) {
    try {
      meta = readMeta(JSON.parse(await fsp.readFile(metaFile.abs, "utf8")));
    } catch (err) {
      debug.error("saves: %s/%s: ignoring %s: %s", tidDir, folder, META_FILE, err.message);
    }
  }
  const content = crypto.createHash("sha256");
  for (const f of files) content.update(`${f.path}\0${await cache.hash(f)}\n`);
  return {
    save: {
      id: saveId(titleId, folder),
      titleId,
      name: meta.name ?? folder.normalize("NFC"),
      description: meta.description ?? null,
      gameVersion: meta.gameVersion ?? null,
      source: meta.source ?? null,
      ko: meta.ko ?? null,
      size,
      files: files.length,
      updatedAt: Math.floor(Math.max(...all.map((f) => f.mtimeMs)) / 1000),
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
    if (err.code !== "ENOENT") debug.error("saves: cannot read %s: %s", dir, err.message);
    return [];
  }
}

/** Every valid save under `root`, sorted by title id then name. */
export async function scanDir(root, cache) {
  const out = [];
  const seen = new Set();
  for (const tidDir of await subdirs(root)) {
    if (!isBase(tidDir.toUpperCase())) continue;
    for (const folder of await subdirs(path.join(root, tidDir))) {
      try {
        const { save, entries } = await readSave(root, tidDir, folder, cache);
        for (const e of entries) seen.add(e.abs);
        out.push({ ...save, dir: tidDir, folder });
      } catch (err) {
        if (!(err instanceof Rejected)) throw err;
        debug.error("saves: %s/%s left out: %s", tidDir, folder, err.message);
      }
    }
  }
  cache.save(seen);
  return out.sort((a, b) => a.titleId.localeCompare(b.titleId) || a.name.localeCompare(b.name));
}

export function createCatalog({ root, cacheFile }) {
  const cache = new HashCache(cacheFile);
  let saves = [];
  let scannedAt = 0;
  let inFlight = null;
  const scan = () => {
    inFlight ??= scanDir(root, cache)
      .then((next) => {
        saves = next;
        scannedAt = Date.now();
        return saves;
      })
      .finally(() => (inFlight = null));
    return inFlight;
  };
  const publicFields = ({ dir: _dir, folder: _folder, ...s }) => s;
  return {
    async list() {
      if (Date.now() - scannedAt > STALE_MS) await scan();
      return saves.map(publicFields);
    },
    /** A save read afresh for download, or null when it is gone or no longer valid. */
    async open(id) {
      await this.list();
      const known = saves.find((s) => s.id === id);
      if (!known) return null;
      try {
        return await readSave(root, known.dir, known.folder, cache);
      } catch (err) {
        if (err instanceof Rejected || err.code === "ENOENT") return null;
        throw err;
      }
    },
  };
}

const SOURCE_LABEL = { ko: "출처", en: "Source" };

/**
 * A save as one language sees it: Korean name and description for "ko" when
 * the save has them, the default (English) text otherwise, with the source
 * credited on the description's last line. Pure.
 */
export function localize(save, lang) {
  const { ko, ...rest } = save;
  const own = lang === "ko" ? ko ?? {} : {};
  const label = SOURCE_LABEL[lang === "ko" ? "ko" : "en"];
  const credit = save.source ? `${label}: ${[save.source.name, save.source.url].filter(Boolean).join(" ")}` : null;
  const text = own.description ?? save.description;
  return {
    ...rest,
    name: own.name ?? save.name,
    description: [text, credit].filter(Boolean).join("\n") || null,
  };
}
