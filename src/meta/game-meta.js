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
 * next look, whatever the times on it, and no hand-placed file stays in the
 * folder once a look or the admin dealt with its slot (game-art-files.js
 * takeSlot): the newest by mtime that reads is taken and deleted, the others move
 * to the folder's .replaced/, one that does not read to .unreadable/. A slot with
 * a file written within the watch's quiet time is left for later, even on a
 * forced look: a copy may still be going on. The admin's folder button takes
 * such a file once it holds still for a moment instead. A crash's own temp files
 * in the folders are deleted at start. An upload, a new cut or a removal
 * moves those waiting for its slot to .replaced/ first.
 * Nothing remembers what was dealt with: what is left in the folder is all there
 * is to take, so a copy with new inodes, a lost index or a touch brings nothing
 * back. A slot is never written while one of its hand files would stay (a
 * folder that cannot be written): it is left as it is then, logged once. Every
 * write into one game's slots (a conversion, an upload, a new cut, a removal,
 * the move out of custom-art/) waits for the one before it.
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
import { classify, handStamp, kindOf, moveAside, REPLACED, StuckError, takeSlot } from "./game-art-files.js";
import { QUIET_MS, watchItems } from "./folder-watch.js";
import { LANGS } from "./langs.js";

export const GAMES_DIR = path.join(dataDir, "metadata", "games");
export const THUMBS_DIR = path.join(dataDir, "thumbs", "games");
const JSON_FILE = "game.json";
const FOLDER_ID_RE = /\[([0-9A-Fa-f]{16})\]\s*$/;
// A game whose picture was found gone at a request is read again this soon after, once for a burst.
const VANISHED_MS = 1_000;
export const FIELDS = ["name", "description", "notes"];
// Bytes, not characters: most disks take 255 bytes a name, and a Korean letter is three.
const MAX_FOLDER_LABEL_BYTES = 180;

/**
 * The fields of a game.json, each as written: plain text (game-descriptions.js reads
 * it as Korean when it has Hangul, else English) or { <client language>: text } (meta/langs.js LANGS). An empty text, a language
 * key no client reads and anything else in the file are left out. Pure.
 */
export function readFields(json) {
  const out = {};
  for (const field of FIELDS) {
    const v = json?.[field];
    if (typeof v === "string") {
      if (v.trim()) out[field] = v;
      continue;
    }
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const kept = Object.fromEntries(LANGS.filter((l) => typeof v[l] === "string" && v[l].trim()).map((l) => [l, v[l]]));
    if (Object.keys(kept).length) out[field] = kept;
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
 *     art: { <slot>: { file, stamp } }, hand: [{ slot, file, stamp, at }] }
 * hand: every picture put there by hand, still to be made into its slot (at: its mtime).
 */
const games = new Map(); // id → { row, fields }
let revisionCount = 0; // goes up whenever what was read of any game changes
let topMtime = null;
let loaded = false;
let indexed = false; // the index holds a full look already
let store;
let changedHook = () => {};
let pruning = Promise.resolve();
// How long a hand file must have been left alone before it is read: the watch's quiet time.
let quietMs = QUIET_MS;

// How long a hand file written within the quiet time must hold still to be read anyway, when the admin asks (rescan's `settle`).
const SETTLE_MS = 1_500;

/** Sets how long a hand file must have been left alone before a look reads it (start() sets it to the watch's; tests). */
export function setQuiet(ms) {
  quietMs = ms;
}

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
  revisionCount++;
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
  else if (games.delete(prev.id)) revisionCount++;
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

/** The pictures in one folder: { art, hand }, every hand-placed file in `hand`. */
function listFolder(dir) {
  const art = {};
  const hand = [];
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
    if (c.role === "art") art[c.slot] = { file: name, stamp: artStamp(st) };
    else hand.push({ slot: c.slot, file: name, stamp: handStamp(st), at: st.mtimeMs });
  }
  return { art, hand };
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
const picturesMoved = (dir, row) => [
  ...Object.values(row.art).map((p) => [p.file, p.stamp, artStamp]),
  ...row.hand.map((h) => [h.file, h.stamp, handStamp]),
].some(([file, stamp, stampOf]) => {
  try {
    return stampOf(fs.statSync(path.join(dir, file))) !== stamp;
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
  // The stamp has the ctime: a game.json with the same one is the same file, even on a full look.
  const json = readJson(path.join(dir, JSON_FILE), prev?.folder === folder ? prev.json : null);
  return { id, folder, mtimeMs: st.mtimeMs, json, art: listed.art, hand: listed.hand };
}

/**
 * Where game `id`'s folder is, from its known folder and `hint` (a name the
 * watch gave), a stat each and no look at the whole games folder: [[id, folder]],
 * or null when only that look can tell (none of them there, or two for one id).
 */
function locate(id, hint) {
  const hinted = hint && FOLDER_ID_RE.exec(hint)?.[1].toUpperCase() === id ? hint : null;
  const there = [...new Set([hinted, games.get(id)?.row.folder].filter(Boolean))].filter((name) => {
    try {
      return fs.statSync(path.join(GAMES_DIR, name), { throwIfNoEntry: false })?.isDirectory();
    } catch {
      return false;
    }
  });
  return there.length === 1 ? [[id, there[0]]] : null;
}

/**
 * Reads what changed in the games folder: every folder (`force`: all of each),
 * or only game `only`, always in full, found where it was or in `folder` (a name
 * the watch gave). The ids whose row changed.
 */
function read({ force = false, only = null, folder = null } = {}) {
  let st = null;
  try {
    st = fs.statSync(GAMES_DIR);
  } catch (err) {
    if (err.code !== "ENOENT") {
      debug.error("game meta: reading %s: %s", GAMES_DIR, err.message);
      return [];
    }
  }
  // One game is looked for where it is known to be: thousands of folders put in at once are thousands of these.
  const list = !st ? [] : only ? locate(only, folder) ?? listTop() : force || st.mtimeMs !== topMtime ? listTop() : [...games.values()].map(({ row }) => [row.id, row.folder]);
  if (!list) return [];
  // Only a full look settles the folder's mtime: one game read alone may leave new folders beside it unread.
  if (!only) topMtime = st?.mtimeMs ?? null;
  const changed = [];
  const found = new Set();
  for (const [id, folder] of list) {
    found.add(id);
    if (only && id !== only) continue;
    const prev = games.get(id)?.row;
    const row = readFolder(id, folder, prev, force || Boolean(only));
    if (prev && row && JSON.stringify(prev) === JSON.stringify(row)) continue;
    if (!prev && !row) continue;
    replaceRow(prev, row);
    changed.push(id);
  }
  for (const id of only ? [only].filter((id) => games.has(id)) : [...games.keys()]) {
    if (found.has(id)) continue;
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
      if (r?.id && r.folder && r.art) remember({ id: r.id, folder: r.folder, mtimeMs: r.mtimeMs, json: r.json ?? null, art: r.art, hand: r.hand ?? [] });
    }
  });
  return read();
}

const queues = new Map(); // id → the last write into that game's slots, done or not
/**
 * Runs `fn(held)` once every write into game `id`'s slots started before it is
 * done, so two never interleave (a conversion and an upload, say). What `fn`
 * returns. `held` names the queues the caller is inside: `fn` passes on the one
 * it is given to whatever it calls that takes a queue, and a call for a game
 * already in it fails at once, as it would wait on itself forever. The code here
 * that holds a game's queue calls only what does not take it (read, refresh,
 * clearSlot); work a queued `fn` leaves behind (a timer, a promise not waited
 * for) passes nothing and queues like any other.
 */
export function withGame(id, fn, held = null) {
  if (held?.has(id)) return Promise.reject(new Error(`game ${id}: its own queue was entered again from inside; it would wait on itself`));
  const holding = new Set(held ?? []).add(id);
  const run = (queues.get(id) ?? Promise.resolve()).then(() => fn(holding));
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

const stuckLogged = new Set(); // what a move failed for, logged once a process
function stuck(err) {
  if (stuckLogged.has(err.message)) return;
  stuckLogged.add(err.message);
  debug.error("game meta: %s; the slot is left as it is", err.message);
}

const later = new Map(); // id → the timer that reads a game again once its hand files are quiet
/** Game `id` read again in `ms`, while the watch runs: the watch alone may report a folder a moment early. */
function lookLater(id, ms) {
  if (!watch || later.has(id)) return;
  const t = setTimeout(() => {
    later.delete(id);
    rescan(id).catch((err) => debug.error("game meta: reading %s again failed: %s", id, err.message));
  }, ms + VANISHED_MS);
  t.unref?.();
  later.set(id, t);
}

/**
 * Slot `slot` of game `id` made from the hand-placed files there, once the
 * game's other writes are done: its folder read again first, and nothing done
 * when the slot changed meanwhile or a file there is still fresh (a later look
 * decides). `settle`: one still fresh is read when it holds still for a moment
 * (takeSlot's settleMs). { changed: how many rows changed, waitMs: how long
 * until the one left fresh is quiet, 0 when none was }
 */
function convertSlot(id, slot, held = null, settle = false) {
  return withGame(id, async () => {
    let changed = read({ only: id }).length;
    const row = games.get(id)?.row;
    const files = (row?.hand ?? [])
      .filter((h) => h.slot === slot)
      .sort((a, b) => b.at - a.at || a.file.localeCompare(b.file))
      .map((h) => h.file);
    if (!files.length) return { changed, waitMs: 0 };
    const dir = path.join(GAMES_DIR, row.folder);
    const slotWas = row.art[slot]?.stamp ?? null;
    let waitMs = 0;
    try {
      const made = await takeSlot(dir, slot, files, { ready: () => slotStampNow(dir, slot) === slotWas, quietMs, settleMs: settle ? SETTLE_MS : 0 });
      if (!made) debug.log("game meta: %s/%s changed while it was read; left for the next look", row.folder, slot);
      else if (made.waitMs) {
        debug.log("game meta: %s/%s was written just now; left until it has been quiet", row.folder, slot);
        lookLater(id, made.waitMs);
        ({ waitMs } = made);
      } else if (made.taken) debug.log("game meta: %s/%s is now %s.webp", row.folder, made.taken, slot);
    } catch (err) {
      if (err instanceof StuckError) stuck(err);
      else debug.error("game meta: %s/%s cannot be made from %s: %s", row.folder, slot, files[0], err.message);
    }
    return { changed: changed + read({ only: id }).length, waitMs };
  }, held);
}

/** The slots of game `id` with hand-placed files waiting, as last read. */
const waitingSlots = (id) => [...new Set((games.get(id)?.row.hand ?? []).map((h) => h.slot))];

/**
 * Makes the hand-placed pictures of game `id` into its slots (`settle`: convertSlot's).
 * { changed: how many rows changed, pending: how many slots were left fresh, retryInMs: when the next look takes them }
 */
async function convertGame(id, held = null, settle = false) {
  let changed = 0;
  let pending = 0;
  let wait = 0;
  for (const slot of waitingSlots(id)) {
    const made = await convertSlot(id, slot, held, settle);
    changed += made.changed;
    if (made.waitMs) {
      pending++;
      wait = Math.max(wait, made.waitMs);
    }
  }
  return { changed, pending, retryInMs: pending ? wait + VANISHED_MS : 0 };
}

let converting = null;
/** Makes every hand-placed picture waiting into its slot's .webp, one slot at a time. How many rows changed. */
function convertAll() {
  converting ??= (async () => {
    let changed = 0;
    const tried = new Set();
    for (;;) {
      const next = [...games.values()].flatMap(({ row }) => waitingSlots(row.id)
        .map((slot) => [row.id, slot, row.hand.filter((h) => h.slot === slot).map((h) => `${h.file}/${h.stamp}`).sort().join("|")])
        .filter(([id, slot, key]) => !tried.has(`${id}/${slot}/${key}`)));
      if (!next.length) return changed;
      for (const [id, slot, key] of next) {
        tried.add(`${id}/${slot}/${key}`);
        changed += (await convertSlot(id, slot)).changed;
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
  const converted = await convertAll();
  await pruning;
  if (changed.length || converted) changedHook();
  return { games: games.size, changed: changed.length, converted };
}

/**
 * Reads game `id`'s folder again in full now, its hand-placed pictures made into
 * WebP. `folder` is the folder's name when the watch gave it: a game new or
 * renamed is found there without a look at the whole games folder. `held`:
 * withGame's, when called from inside a queue. `settle`: the admin asked (the
 * folder button), so a picture copied just now is read once it holds still
 * for a moment instead of after the quiet time.
 * { changed, converted, pending: how many slots wait for a picture still
 * changing, retryInMs: when the look that takes them runs }
 */
export async function rescan(id, folder = null, held = null, { settle = false } = {}) {
  load();
  const changed = await withGame(id, () => read({ only: id, folder }), held);
  const { changed: converted, pending, retryInMs } = await convertGame(id, held, settle);
  await pruning;
  if (changed.length || converted) changedHook();
  return { changed: changed.length > 0, converted, pending, retryInMs };
}

/** Reads game `id`'s folder again at once, after the server wrote into it (or before it writes). */
export function refresh(id) {
  load();
  read({ only: id });
}

/**
 * Moves the hand-placed files waiting for slot `slot` of game `id` to its
 * folder's .replaced/, read again first: called from inside the game's queue
 * right before the server sets the slot (an upload, a new cut, a removal), so
 * one put there before never comes back over what the admin chose. Throws
 * StuckError, nothing written, when one cannot be moved.
 */
export function clearSlot(id, slot) {
  refresh(id);
  const row = games.get(id)?.row;
  if (!row) return;
  const dir = path.join(GAMES_DIR, row.folder);
  const waiting = row.hand.filter((h) => h.slot === slot);
  for (const h of waiting) {
    moveAside(dir, h.file, REPLACED);
    debug.log("game meta: %s is moved to %s/: %s was set from the admin page", path.join(dir, h.file), REPLACED, slot);
  }
  if (waiting.length) refresh(id);
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

// What writeAtomic names a file of a game folder while it writes it, and how old one must be to be a crash's.
const TEMP_RE = /^\.(.+)\.(\d+)\.tmp$/;
const TEMP_STALE_MS = 3_600_000;
const serverTemp = (name) => {
  const m = TEMP_RE.exec(name);
  if (!m || m[1] !== m[1].toLowerCase()) return false;
  return m[1] === JSON_FILE || ["art", "orig"].includes(classify(m[1])?.role);
};

/**
 * Deletes what a crash of the server left in the game folders: its own temp
 * files (`.icon.webp.<pid>.tmp`, `.game.json.<pid>.tmp` and so on), untouched
 * for over an hour. Nothing else, and nowhere else (not .replaced/).
 */
async function sweepTemps() {
  const now = Date.now();
  let dirs;
  try {
    dirs = await fs.promises.readdir(GAMES_DIR, { withFileTypes: true });
  } catch {
    return;
  }
  for (const d of dirs) {
    if (!d.isDirectory() || !FOLDER_ID_RE.test(d.name)) continue;
    const dir = path.join(GAMES_DIR, d.name);
    const names = await fs.promises.readdir(dir).catch(() => []);
    for (const name of names.filter(serverTemp)) {
      const file = path.join(dir, name);
      try {
        const st = await fs.promises.lstat(file);
        if (!st.isFile() || now - st.mtimeMs < TEMP_STALE_MS) continue;
        await fs.promises.rm(file);
        debug.log("game meta: %s was left by a stop while it was written; deleted", file);
      } catch (err) {
        debug.error("game meta: %s cannot be deleted: %s", file, err.message);
      }
    }
  }
}

let watch = null;
let watchTurn = Promise.resolve();
// Folders the watch reports together (thousands copied in at once) are read one a turn of the
// event loop, so requests are answered in between instead of after them all.
function nextTurn(fn) {
  const run = watchTurn.then(() => new Promise((resolve) => setImmediate(resolve))).then(fn);
  watchTurn = run.catch(() => {});
  return run;
}

/**
 * Reads the folders now, then watches them: a folder that changed is read
 * again once it has been quiet (`quietMs`, `cooldownMs`: folder-watch's, for
 * tests). `onChange` is told when a list needs building again.
 */
export function start({ onChange, quietMs: quiet, cooldownMs } = {}) {
  if (onChange) changedHook = onChange;
  if (watch) return;
  if (quiet !== undefined) quietMs = quiet;
  // Made first: a folder that is not there yet cannot be watched.
  try {
    fs.mkdirSync(GAMES_DIR, { recursive: true });
  } catch (err) {
    debug.error("game meta: making %s: %s", GAMES_DIR, err.message);
  }
  // A crash's temp files go first, at start only: no write of this process can be under way yet.
  sweepTemps().then(() => scan()).catch((err) => debug.error("game meta: scan failed: %s", err.message));
  // One watch per folder, not per file: thousands of games cost megabytes.
  // A rename reports the old name and the new: both read the game again, and both find the new one.
  watch = watchItems(GAMES_DIR, {
    depth: 1, deep: true, label: "game meta", quietMs: quiet, cooldownMs,
    onItem: (item) => {
      const m = FOLDER_ID_RE.exec(item);
      // A name with no id may be a game's folder renamed: only a look at them all tells.
      return nextTurn(() => (m ? rescan(m[1].toUpperCase(), item) : scan()));
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
  for (const t of later.values()) clearTimeout(t);
  later.clear();
  return w?.close();
}

/** What was read of game `id`: { folder, dir, json, fields }, or null when it has no folder. */
export function entry(id) {
  load();
  const g = games.get(id);
  return g ? { folder: g.row.folder, dir: path.join(GAMES_DIR, g.row.folder), json: g.row.json, fields: g.fields } : null;
}

/** A number that changes whenever any game's folder is read differently: for caches built from it. */
export function revision() {
  load();
  return revisionCount;
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
