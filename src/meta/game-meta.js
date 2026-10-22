/**
 * Every game folder the admin keeps, as the server last read it:
 *
 *   ${COOK_DATA_DIR}/metadata/games/<name> [<base title id>]/
 *     game.json                                    what the admin wrote (meta/game-descriptions.js)
 *     icon.webp  banner.webp  screenshot-01.webp … the game's own pictures (meta/game-art-files.js)
 *
 * The folders are the truth; what was read of them is kept in memory and in the
 * index (catalog "game-meta", one row per folder), so a request never waits on
 * the disk and a restart does not read every folder again. A folder is listed
 * again only when its mtime changed, its game.json read again only when its
 * stamp did; its pictures are looked at each time, as an editor saves over one
 * in place. The games folder is read at start, in the full folder sync, from the
 * admin page, and right after the server writes into a folder; in between, a
 * watch (meta/folder-watch.js) reads again the one folder that changed, once its
 * writes have been quiet for a while, so a long copy is never read half done.
 *
 * A picture put into a folder by hand as icon.jpg, banner.png, screenshot-02.jpeg
 * and so on is made into the slot's .webp (and an original to cut again) by the
 * next look; the hand-placed file goes once both are written. When the slot has
 * a .webp already, the newer of the two wins: the hand file by the later of its
 * mtime and ctime, as a copy that keeps the old mtime (cp -p, unzip) is still
 * new. One that cannot be read is left as it is and tried again only once it
 * changes. Every write into one game's slots (a conversion, an upload, a new
 * cut, a removal, the move out of custom-art/) waits for the one before it.
 *
 * Small copies of the pictures are kept apart, in thumbs/games/<id>/, named
 * after the picture's stamp: a new picture gets new ones without a look at the disk.
 */
import fs from "fs";
import path from "path";
import { dataDir } from "../helpers/envs.js";
import debug from "../debug.js";
import { appDb } from "../db/database.js";
import { catalogStore } from "../db/stores.js";
import { forget } from "./image-cache.js";
import { classify, convertHand, kindOf } from "./game-art-files.js";
import { watchItems } from "./folder-watch.js";

export const GAMES_DIR = path.join(dataDir, "metadata", "games");
export const THUMBS_DIR = path.join(dataDir, "thumbs", "games");
const JSON_FILE = "game.json";
const FOLDER_ID_RE = /\[([0-9A-Fa-f]{16})\]\s*$/;
// A game whose picture was found gone at a request is read again this soon after, once for a burst.
const VANISHED_MS = 1_000;
export const FIELDS = ["name", "description", "notes"];
// Bytes, not characters: most disks take 255 bytes a name, and a Korean letter is three.
const MAX_FOLDER_LABEL_BYTES = 180;
const HANGUL_RE = /[가-힣]/;

/**
 * The fields of a game.json that are text in English or Korean; anything else in the file is left out.
 * A field written by hand as plain text counts as Korean when it has Hangul, else English. Pure.
 */
export function readFields(json) {
  const out = {};
  for (const field of FIELDS) {
    let v = json?.[field];
    if (typeof v === "string") v = HANGUL_RE.test(v) ? { ko: v } : { en: v };
    if (!v || typeof v !== "object") continue;
    const en = typeof v.en === "string" && v.en.trim() ? v.en : null;
    const ko = typeof v.ko === "string" && v.ko.trim() ? v.ko : null;
    if (en || ko) out[field] = { en, ko };
  }
  return out;
}

/** A folder name for a game: its name, then its id in brackets. Pure. */
export function folderName(id, name) {
  const clean = String(name ?? "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  let label = "";
  for (const ch of clean) {
    if (Buffer.byteLength(label + ch) > MAX_FOLDER_LABEL_BYTES) break;
    label += ch;
  }
  label = label.replace(/[ .]+$/, "");
  return `${label || "Game"} [${id}]`;
}

// Where a game's usual name comes from when the admin gave none (meta/titledb-store.js sets it).
let nameOf = () => null;
/** Lets the folder of a game the admin named nothing for carry its usual name. */
export function useNames(fn) {
  nameOf = fn;
}

// ctime too: a copy that keeps the old mtime and size (cp -p, rsync, a restore) still changes it.
const jsonStamp = (st) => `${st.mtimeMs}:${st.ctimeMs}:${st.size}`;
// A picture's stamp goes into the names of its small copies: letters, digits and a dash.
const artStamp = (st) => `${Math.round(st.mtimeMs * 1000).toString(36)}-${st.size.toString(36)}`;

/*
 * A row, as kept in memory and in the index:
 *   { id, folder, mtimeMs, json: null | { stamp, raw } | { stamp, error },
 *     art: { <slot>: { file, stamp } }, hand: [{ slot, file, stamp }], failed: { <file>: stamp } }
 * hand: pictures put there by hand still to be made into their slot's .webp;
 * failed: the ones that could not be, by the stamp they had then.
 */
const games = new Map(); // id → { row, fields }
let topMtime = null;
let loaded = false;
let indexed = false; // the index holds a full look already
let store;
let changedHook = () => {};
let pruning = Promise.resolve();

function index() {
  if (store === undefined) {
    try {
      store = catalogStore(appDb(), "game-meta");
    } catch (err) {
      debug.error("game meta: the index cannot be opened: %s", err.message);
      store = null;
    }
  }
  return store;
}

// The index is only a cache: a write it refuses is logged and the folders are read again next start.
function toIndex(fn) {
  const s = index();
  if (!s) return;
  try {
    fn(s);
  } catch (err) {
    debug.error("game meta: writing the index: %s", err.message);
  }
}

function remember(row) {
  games.set(row.id, { row, fields: row.json?.raw ? readFields(row.json.raw) : null });
}

/** The small copies of `slot` of game `id`, all but those of `keep` (a stamp), deleted in the background. */
function pruneThumbs(id, slot, keep = null) {
  const dir = path.join(THUMBS_DIR, id);
  pruning = pruning.then(async () => {
    let names;
    try {
      names = await fs.promises.readdir(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (!name.startsWith(`${slot}.`) || (keep && name.startsWith(`${slot}.${keep}.`))) continue;
      forget(path.join(dir, name));
      await fs.promises.rm(path.join(dir, name), { force: true }).catch(() => {});
    }
  });
}

/** Takes `row` in place of `prev`: the pictures that changed or went lose their small copies. */
function replaceRow(prev, row) {
  for (const [slot, was] of Object.entries(prev?.art ?? {})) {
    const now = row?.art[slot];
    if (now?.stamp === was.stamp && row.folder === prev.folder) continue;
    forget(path.join(GAMES_DIR, prev.folder, was.file));
    if (now?.stamp !== was.stamp) pruneThumbs(prev.id, slot, now?.stamp);
  }
  if (row) remember(row);
  else games.delete(prev.id);
}

/** The game folders by name: [[id, folder]], the first of two for one id kept; null when it cannot be read. */
function listTop() {
  let names;
  try {
    names = fs.readdirSync(GAMES_DIR, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return [];
    debug.error("game meta: reading %s: %s", GAMES_DIR, err.message);
    return null;
  }
  const byId = new Map();
  for (const d of names.sort((a, b) => a.name.localeCompare(b.name))) {
    const m = d.isDirectory() && FOLDER_ID_RE.exec(d.name);
    if (!m) continue;
    const id = m[1].toUpperCase();
    if (byId.has(id)) {
      debug.error("game meta: %s and %s are both for %s; using the first", byId.get(id), d.name, id);
      continue;
    }
    byId.set(id, d.name);
  }
  return [...byId];
}

const loserLogged = new Set();
/** Says once that a hand-placed picture is left alone, as `than` in its slot is newer. */
function logLoser(dir, h, than) {
  const key = `${dir}/${h.file}/${h.stamp}`;
  if (loserLogged.has(key)) return;
  loserLogged.add(key);
  debug.log("game meta: %s is left as it is: %s is newer", path.join(dir, h.file), than);
}

/**
 * The pictures in one folder: { art, hand }, a hand-placed one only when it is
 * newer than the slot's .webp. A hand file counts by the later of its mtime and
 * ctime; a .webp by its mtime, which a conversion sets to the time of what it read.
 */
function listFolder(dir) {
  const art = {};
  const hands = new Map();
  for (const name of fs.readdirSync(dir)) {
    const c = classify(name);
    if (!c || c.role === "orig") continue;
    let st;
    try {
      st = fs.statSync(path.join(dir, name));
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    const found = { file: name, stamp: artStamp(st) };
    if (c.role === "art") {
      art[c.slot] = { ...found, at: st.mtimeMs };
      continue;
    }
    const h = { slot: c.slot, ...found, at: Math.max(st.mtimeMs, st.ctimeMs) };
    const had = hands.get(c.slot);
    if (had && had.at >= h.at) logLoser(dir, h, had.file);
    else {
      if (had) logLoser(dir, had, h.file);
      hands.set(c.slot, h);
    }
  }
  const hand = [];
  for (const h of hands.values()) {
    if (art[h.slot] && h.at <= art[h.slot].at) logLoser(dir, h, art[h.slot].file);
    else hand.push({ slot: h.slot, file: h.file, stamp: h.stamp });
  }
  return { art: Object.fromEntries(Object.entries(art).map(([slot, { file, stamp }]) => [slot, { file, stamp }])), hand };
}

/** A game.json: `prev` again when its stamp is the same, else read anew (a broken one as an error). */
function readJson(file, prev) {
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    return null;
  }
  const stamp = jsonStamp(st);
  if (prev?.stamp === stamp) return prev;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    // Anything but an object is a file someone else put here: read as broken, so it is never written over.
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("not a JSON object");
    return { stamp, raw };
  } catch (err) {
    const error = `${file} cannot be read: ${err.message}`;
    debug.error("game meta: %s", error);
    return { stamp, error };
  }
}

// A picture saved over in place leaves its folder's mtime as it was: the few in a folder are looked at each time.
const picturesMoved = (dir, row) => [...Object.values(row.art), ...row.hand].some((p) => {
  try {
    return artStamp(fs.statSync(path.join(dir, p.file))) !== p.stamp;
  } catch {
    return true;
  }
});

/** One folder read again where it changed (all of it with `force`); null when it is gone. */
function readFolder(id, folder, prev, force) {
  const dir = path.join(GAMES_DIR, folder);
  let st;
  try {
    st = fs.statSync(dir);
  } catch {
    return null;
  }
  if (!st.isDirectory()) return null;
  const same = !force && prev?.folder === folder;
  let listed;
  try {
    listed = same && prev.mtimeMs === st.mtimeMs && !picturesMoved(dir, prev) ? prev : listFolder(dir);
  } catch (err) {
    debug.error("game meta: reading %s: %s", dir, err.message);
    return prev ?? null;
  }
  const failed = Object.fromEntries(Object.entries(prev?.failed ?? {}).filter(([file]) => listed.hand.some((h) => h.file === file)));
  // The stamp has the ctime: a game.json with the same one is the same file, even on a full look.
  const json = readJson(path.join(dir, JSON_FILE), prev?.folder === folder ? prev.json : null);
  return { id, folder, mtimeMs: st.mtimeMs, json, art: listed.art, hand: listed.hand, failed };
}

/**
 * Reads what changed in the games folder: every folder (`force`: all of each),
 * or only game `only`, always in full. The ids whose row changed.
 */
function read({ force = false, only = null } = {}) {
  let st = null;
  try {
    st = fs.statSync(GAMES_DIR);
  } catch (err) {
    if (err.code !== "ENOENT") {
      debug.error("game meta: reading %s: %s", GAMES_DIR, err.message);
      return [];
    }
  }
  const list = !st ? [] : only || force || st.mtimeMs !== topMtime ? listTop() : [...games.values()].map(({ row }) => [row.id, row.folder]);
  if (!list) return [];
  // Only a full look settles the folder's mtime: one game read alone may leave new folders beside it unread.
  if (!only) topMtime = st?.mtimeMs ?? null;
  const changed = [];
  const seen = new Set();
  for (const [id, folder] of list) {
    seen.add(id);
    if (only && id !== only) continue;
    const prev = games.get(id)?.row;
    const row = readFolder(id, folder, prev, force || Boolean(only));
    if (prev && row && JSON.stringify(prev) === JSON.stringify(row)) continue;
    if (!prev && !row) continue;
    replaceRow(prev, row);
    changed.push(id);
  }
  for (const id of [...games.keys()]) {
    if (seen.has(id) || (only && id !== only)) continue;
    replaceRow(games.get(id).row, null);
    changed.push(id);
  }
  if (!only && !indexed) {
    toIndex((s) => s.replace([...games.values()].map((g) => g.row), Date.now()));
    indexed = true;
  } else {
    // Only the rows that changed: one folder edited is not every row written again.
    const ids = only ? [only] : changed;
    if (ids.length) toIndex((s) => {
      for (const id of ids) if (games.has(id)) s.put(games.get(id).row);
      const gone = ids.filter((id) => !games.has(id));
      if (gone.length) s.remove(...gone);
    });
  }
  return changed;
}

/** The rows the index kept, then a look at what changed since; once, on first use. The ids that changed. */
function load() {
  if (loaded) return [];
  loaded = true;
  toIndex((s) => {
    const kept = s.load();
    indexed = Boolean(kept);
    // In the order a look writes them, so an unchanged folder compares equal.
    for (const r of kept?.items ?? []) {
      if (r?.id && r.folder && r.art) remember({ id: r.id, folder: r.folder, mtimeMs: r.mtimeMs, json: r.json ?? null, art: r.art, hand: r.hand ?? [], failed: r.failed ?? {} });
    }
  });
  return read();
}

const queues = new Map(); // id → the last write into that game's slots, done or not
/**
 * Runs `fn` once every write into game `id`'s slots started before it is done,
 * so two never interleave (a conversion and an upload, say). What `fn` returns.
 */
export function withGame(id, fn) {
  const run = (queues.get(id) ?? Promise.resolve()).then(fn);
  const tail = run.catch(() => {});
  queues.set(id, tail);
  tail.then(() => { if (queues.get(id) === tail) queues.delete(id); });
  return run;
}

/** The stamp of slot `slot`'s .webp in `dir` as it is now, or null when it has none. */
function slotStampNow(dir, slot) {
  const st = fs.statSync(path.join(dir, `${slot}.webp`), { throwIfNoEntry: false });
  return st ? artStamp(st) : null;
}

/**
 * One hand-placed picture made into its slot, once the game's other writes are
 * done: its folder read again first, and nothing done when the picture or the
 * slot changed meanwhile (the next look decides then). How many rows changed.
 */
function convertOne(id, h) {
  return withGame(id, async () => {
    let changed = read({ only: id }).length;
    const row = games.get(id)?.row;
    if (!row?.hand.some((x) => x.file === h.file && x.stamp === h.stamp)) return changed;
    const dir = path.join(GAMES_DIR, row.folder);
    const seen = row.art[h.slot]?.stamp ?? null;
    try {
      const made = await convertHand(dir, h.slot, h.file, { ready: () => slotStampNow(dir, h.slot) === seen });
      if (made) debug.log("game meta: %s/%s is now %s.webp", row.folder, h.file, h.slot);
      else debug.log("game meta: %s/%s or its slot changed while it was read; left for the next look", row.folder, h.file);
    } catch (err) {
      debug.error("game meta: %s cannot be made into %s.webp: %s", `${row.folder}/${h.file}`, h.slot, err.message);
      const now = games.get(id)?.row;
      if (!now) return changed;
      remember({ ...now, failed: { ...now.failed, [h.file]: h.stamp } });
      toIndex((s) => s.put(games.get(id).row));
      return changed;
    }
    return changed + read({ only: id }).length;
  });
}

let converting = null;
/** Makes every hand-placed picture waiting into its slot's .webp, one at a time. How many rows changed. */
function convertWaiting() {
  converting ??= (async () => {
    let changed = 0;
    const tried = new Set();
    for (;;) {
      const next = [...games.values()].flatMap(({ row }) => row.hand
        .filter((h) => row.failed[h.file] !== h.stamp && !tried.has(`${row.id}/${h.file}/${h.stamp}`))
        .map((h) => [row.id, h]));
      if (!next.length) return changed;
      for (const [id, h] of next) {
        tried.add(`${id}/${h.file}/${h.stamp}`);
        changed += await convertOne(id, h);
      }
    }
  })().finally(() => { converting = null; });
  return converting;
}

/**
 * Looks at the games folder now: what changed (`force`: every folder in full),
 * then the hand-placed pictures made into WebP. Tells `onChange` (start) when
 * anything a list shows changed. { games, changed, converted }
 */
export async function scan({ force = false } = {}) {
  const changed = [...load(), ...read({ force })];
  const converted = await convertWaiting();
  await pruning;
  if (changed.length || converted) changedHook();
  return { games: games.size, changed: changed.length, converted };
}

/** Reads game `id`'s folder again in full now, its hand-placed pictures made into WebP. */
export async function rescan(id) {
  load();
  const changed = await withGame(id, () => read({ only: id }));
  const converted = await convertWaiting();
  await pruning;
  if (changed.length || converted) changedHook();
  return { changed: changed.length > 0, converted };
}

/** Reads game `id`'s folder again at once, after the server wrote into it (or before it writes). */
export function refresh(id) {
  load();
  read({ only: id });
}

const vanishing = new Set();
/** A picture of game `id` was found gone at a request (a folder renamed or deleted by hand): its folder is read again soon. */
export function vanished(id) {
  if (vanishing.has(id)) return;
  vanishing.add(id);
  setTimeout(() => {
    vanishing.delete(id);
    rescan(id).catch((err) => debug.error("game meta: reading %s again failed: %s", id, err.message));
  }, VANISHED_MS).unref?.();
}

let watch = null;
/**
 * Reads the folders now, then watches them: a folder that changed is read
 * again once it has been quiet (`quietMs`, `cooldownMs`: folder-watch's, for
 * tests). `onChange` is told when a list needs building again.
 */
export function start({ onChange, quietMs, cooldownMs } = {}) {
  if (onChange) changedHook = onChange;
  if (watch) return;
  // Made first: a folder that is not there yet cannot be watched.
  try {
    fs.mkdirSync(GAMES_DIR, { recursive: true });
  } catch (err) {
    debug.error("game meta: making %s: %s", GAMES_DIR, err.message);
  }
  scan().catch((err) => debug.error("game meta: scan failed: %s", err.message));
  // One watch per folder, not per file: thousands of games cost megabytes.
  // A rename reports the old name and the new: both read the game again, and both find the new one.
  watch = watchItems(GAMES_DIR, {
    depth: 1, deep: true, label: "game meta", quietMs, cooldownMs,
    onItem: (item) => {
      const m = FOLDER_ID_RE.exec(item);
      return m ? rescan(m[1].toUpperCase()) : null;
    },
  });
}

/** Resolves once the watch is set up (tests wait for it). */
export function watching() {
  return watch?.ready ?? Promise.resolve();
}

/** Stops the watch. */
export function stop() {
  const w = watch;
  watch = null;
  return w?.close();
}

/** What was read of game `id`: { folder, dir, json, fields }, or null when it has no folder. */
export function entry(id) {
  load();
  const g = games.get(id);
  return g ? { folder: g.row.folder, dir: path.join(GAMES_DIR, g.row.folder), json: g.row.json, fields: g.fields } : null;
}

/** Every game with a folder. */
export function ids() {
  load();
  return [...games.keys()];
}

/** The folder of game `id`, or null. */
export function folderOf(id) {
  return entry(id)?.dir ?? null;
}

/** The folder of game `id`, made when missing and named `label` (else its usual name). Read again first: it may have been renamed. */
export function ensureFolder(id, label = null) {
  refresh(id);
  const have = folderOf(id);
  if (have) return have;
  const dir = path.join(GAMES_DIR, folderName(id, label ?? nameOf(id)));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Slot `slot` of game `id`: { path, stamp }, or null when it has no picture there. */
export function art(id, slot) {
  load();
  const g = games.get(id);
  const a = slot && g?.row.art[slot];
  return a ? { path: path.join(GAMES_DIR, g.row.folder, a.file), stamp: a.stamp } : null;
}

/** Which slots of game `id` have a picture: { icon, banner, screens: [idx] }. */
export function slots(id) {
  load();
  const filled = Object.keys(games.get(id)?.row.art ?? {});
  return {
    icon: filled.includes("icon"),
    banner: filled.includes("banner"),
    screens: filled.map(kindOf).filter((k) => k?.[0] === "screenshot").map((k) => k[1]).sort((a, b) => a - b),
  };
}

/** The name the small copies of a slot's picture are drawn after: they are its variants (meta/image-cache.js). */
export function thumbBase(id, slot, stamp) {
  return path.join(THUMBS_DIR, id, `${slot}.${stamp}.webp`);
}
