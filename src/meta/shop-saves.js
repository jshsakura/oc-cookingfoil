/**
 * Save files the shop hands out (say, a save with every kart unlocked), for a
 * client to restore into a player's save on the console:
 *
 *   <savesDir>/<base title id>/<save name>/<the save folder's contents>  (+ optional meta.json)
 *   <savesDir>/homebrew/<app>/<save name>/<files of switch/<app>/>
 *
 * A homebrew app keeps its saves as files in its own SD folder, not in the
 * console's save data: such a save is listed with `homebrew: <app>`, titleId
 * null and `installRoot: "switch/<app>"`, the folder its files are restored into.
 *
 * meta.json is metadata and never ships:
 *
 *   { name, description, gameVersion?, saveType?, source?: { name, url? }, ko?: { name?, description? } }
 *
 * name and description are the default (English) text; ko holds the Korean
 * ones, and saves/localize picks by the request's language. source credits
 * where the save came from. saveType says which save of a game it is: "device"
 * for the console's shared save (user id 0,0), "account" for a player's. A
 * client refuses to put one kind into the other; with no saveType it applies
 * either way.
 * A save with a symlink, a path ustar cannot hold, too many files or too many
 * bytes is left out and only logged.
 *
 * The folder holds tens of thousands of small files on disks other jobs keep
 * busy, so a scan can take a minute. The last listing is kept in the index
 * (db/database.js, one row per save) and served at once, also right after a
 * restart; it is rescanned in the background when older than STALE_MS. Only a catalog with no listing yet, or
 * one told of a change made here, waits for a scan. A scan reads one entry at
 * a time so it holds one of libuv's threads, not all of them (with every
 * thread waiting on a busy disk, every other file read of the server waits
 * too). Content hashes are cached by (size, mtime, inode) in the index.
 */
import crypto from "crypto";
import fsp from "fs/promises";
import path from "path";
import debug from "../debug.js";
import { fitsUstar } from "../helpers/ustar.js";
import { HashCache } from "../helpers/hash-cache.js";
import { catalogStore, hashStore } from "../db/stores.js";
import { pathProblem } from "./console-paths.js";

const TITLE_ID_RE = /^[0-9A-F]{16}$/;
const META_FILE = "meta.json";
// The folder watch (routes/saves.js) brings changes in as they land; the full rescan is only the backstop.
const STALE_MS = 6 * 60 * 60_000;
const APP_RE = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,63}$/;
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
export const SAVE_TYPES = ["device", "account"];

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
  if (SAVE_TYPES.includes(raw?.saveType)) out.saveType = raw.saveType;
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
  const app = tidDir.startsWith("homebrew/") ? tidDir.slice("homebrew/".length) : null;
  const titleId = app ? null : tidDir.toUpperCase();
  const all = await walk(path.join(root, tidDir, folder));
  const metaFile = all.find((f) => f.path === META_FILE);
  const files = all.filter((f) => f !== metaFile).sort((a, b) => (a.path < b.path ? -1 : 1));
  if (!files.length) throw new Rejected("no files");
  for (const f of files) {
    if (!fitsUstar(f.path)) throw new Rejected(`path too long for tar: ${f.path}`);
    // A homebrew app's save is restored into switch/<app>/ on the card.
    const problem = app ? pathProblem(`switch/${app}/${f.path}`) : null;
    if (problem) throw new Rejected(`the console can't create ${f.path}: ${problem}`);
  }
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
      id: app ? `hb-${crypto.createHash("sha256").update(app.toLowerCase()).digest("hex").slice(0, 12)}-${saveId("", folder).slice(1)}` : saveId(titleId, folder),
      titleId,
      ...(app ? { homebrew: app, installRoot: `switch/${app}` } : {}),
      ...(!app && meta.saveType ? { saveType: meta.saveType } : {}),
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
  const dirs = [];
  for (const tidDir of await subdirs(root)) {
    if (tidDir === "homebrew") {
      for (const app of await subdirs(path.join(root, "homebrew"))) if (APP_RE.test(app)) dirs.push(`homebrew/${app}`);
    } else if (isBase(tidDir.toUpperCase())) dirs.push(tidDir);
  }
  for (const tidDir of dirs) {
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
  return sortSaves(out);
}

/** By title id (homebrew apps last), then name. Pure. */
const sortSaves = (list) => list.sort((a, b) => (a.titleId ?? `~${a.homebrew}`).localeCompare(b.titleId ?? `~${b.homebrew}`) || a.name.localeCompare(b.name));

/** The saves under `root`, kept in the index `db` (db/database.js). */
export function createCatalog({ root, db }) {
  const cache = new HashCache(hashStore(db, "saves"));
  const store = catalogStore(db, "saves");
  const kept = store.load();
  let saves = kept ? sortSaves(kept.items) : [];
  let scannedAt = kept?.at ?? 0;
  let current = Boolean(kept); // false with no listing yet, and after a change made here
  let changes = 0; // bumped by invalidate(): a scan that began before a change does not make the listing current
  let inFlight = null;
  const scan = () => {
    const seen = changes;
    inFlight ??= scanDir(root, cache)
      .then((next) => {
        saves = next;
        scannedAt = Date.now();
        current = seen === changes;
        keep(() => store.replace(saves, scannedAt));
        return saves;
      })
      .finally(() => (inFlight = null));
    return inFlight;
  };
  const keep = (write) => {
    try {
      write();
    } catch (err) {
      debug.error("saves: could not keep the listing: %s", err.message);
    }
  };
  const publicFields = ({ dir: _dir, folder: _folder, ...s }) => s;
  return {
    async list() {
      // A scan already running when a change was made is waited out, then a fresh one runs.
      if (!current) for (let i = 0; !current && i < 3; i++) await scan();
      else if (Date.now() - scannedAt > STALE_MS) scan().catch((err) => debug.error("saves: rescan failed: %s", err.message));
      return saves.map(publicFields);
    },
    /** On start: scans when there is no kept listing or it is stale, in the background. */
    warm() {
      if (current && Date.now() - scannedAt <= STALE_MS) return Promise.resolve();
      return scan().catch((err) => debug.error("saves: scan failed: %s", err.message));
    },
    /** Where a listed save sits under the root ({ dir, folder }), or null. */
    async locate(id) {
      await this.list();
      const known = saves.find((s) => s.id === id);
      return known ? { dir: known.dir, folder: known.folder } : null;
    },
    /**
     * One item changed on disk (the folder watch): "<title id>/<save>" is read
     * again alone, "homebrew/<app>" with every save of that app. Without a
     * listing yet, the first scan covers it.
     */
    async refreshItem(item) {
      if (inFlight) await inFlight.catch(() => {});
      if (!current) return;
      const [top, name] = String(item).split("/");
      let targets;
      let isOld;
      if (top === "homebrew") {
        if (!APP_RE.test(name ?? "")) return;
        const dir = `homebrew/${name}`;
        targets = (await subdirs(path.join(root, dir))).map((folder) => [dir, folder]);
        isOld = (s) => s.dir === dir;
      } else {
        if (!isBase(String(top).toUpperCase()) || !name) return;
        targets = [[top, name]];
        isOld = (s) => s.dir === top && s.folder === name;
      }
      const fresh = [];
      for (const [dir, folder] of targets) {
        try {
          const { save } = await readSave(root, dir, folder, cache);
          fresh.push({ ...save, dir, folder });
        } catch (err) {
          if (err.code === "ENOENT") continue;
          if (!(err instanceof Rejected)) throw err;
          debug.error("saves: %s/%s left out: %s", dir, folder, err.message);
        }
      }
      const old = saves.filter(isOld);
      saves = sortSaves([...saves.filter((s) => !isOld(s)), ...fresh]);
      keep(() => {
        store.remove(...old.map((s) => s.id).filter((id) => !fresh.some((s) => s.id === id)));
        for (const s of fresh) store.put(s);
      });
      debug.log("saves: %s read again", item);
    },
    /** Read the folder again on the next list (after a change made here). */
    invalidate() {
      current = false;
      changes++;
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
