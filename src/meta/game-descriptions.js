/**
 * What the admin writes about each game, kept as plain files apart from titledb
 * so no refresh ever overwrites it and nothing of it lives only in a database:
 *
 *   ${COOK_DATA_DIR}/metadata/games/<name> [<base title id>]/game.json
 *     { id, name?: { en, ko }, description?: { en, ko }, notes?: { en, ko } }
 *
 * A game is found by the id in brackets at the end of its folder's name; the
 * name before it is for people and may be changed by hand. A game.json edited
 * by hand is read again the next time it is asked for, with no restart.
 *
 * name replaces the game's name everywhere it is shown (a wrong or empty one
 * from titledb or the file); one the admin cleared goes back to the usual name.
 *
 * description replaces titledb's own text (for a game it has none for, or a
 * wrong one); one the admin cleared goes back to titledb's. notes is extra
 * information only the admin writes, such as what to install with the game.
 * Korean readers get the Korean text when there is one, everyone else the
 * English one. Line breaks are kept and shown as written.
 *
 * game-descriptions.json, where this was kept before, is moved into the folders
 * the first time they are read, and removed once every game is there.
 */
import fs from "fs";
import path from "path";
import { dataDir } from "../helpers/envs.js";
import debug from "../debug.js";

export const GAMES_DIR = path.join(dataDir, "metadata", "games");
const LEGACY_FILE = path.join(dataDir, "game-descriptions.json");
const FILE = "game.json";
const ID_RE = /^[0-9A-F]{16}$/;
const FOLDER_ID_RE = /\[([0-9A-Fa-f]{16})\]\s*$/;
const MAX = 2000;
export const FIELDS = ["name", "description", "notes"];
// A name is one line; the other fields keep their line breaks.
const LIMIT = { name: 120 };
// Bytes, not characters: most disks take 255 bytes a name, and a Korean letter is three.
const MAX_FOLDER_LABEL_BYTES = 180;

/**
 * An entry written by an older version kept the description's languages at the
 * top ({ en, ko }); read it as { description: { en, ko } }. Pure.
 */
export function normalize(raw) {
  const out = {};
  for (const [id, entry] of Object.entries(raw ?? {})) {
    if (!entry || typeof entry !== "object") continue;
    const { en, ko, ...rest } = entry;
    const legacy = (typeof en === "string" || typeof ko === "string") && !rest.description;
    out[id] = legacy ? { ...rest, description: { en: en ?? null, ko: ko ?? null } } : rest;
  }
  return out;
}

/** The fields of a game.json that are text in English or Korean; anything else in the file is left out. Pure. */
function readFields(json) {
  const out = {};
  for (const field of FIELDS) {
    const v = json?.[field];
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

let index = null; // { mtimeMs, byId: Map id → folder }
const read = new Map(); // game.json → { stamp, fields }
// Entries of game-descriptions.json that could not be moved yet: still read, and moved when saved.
let leftover = new Map();

// ctime too: a copy that keeps the old mtime and size (cp -p, rsync, a restore) still changes it.
const stampOf = (st) => `${st.mtimeMs}:${st.ctimeMs}:${st.size}`;

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // A dot name, so one left behind by a crash is not mistaken for anything.
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

const toJson = (id, fields) => `${JSON.stringify({ id, ...fields }, null, 1)}\n`;

/** Reads one game.json: its fields, or an error saying the file cannot be read. Cached by its stamp. */
function readFile(file) {
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    return { fields: null };
  }
  const stamp = stampOf(st);
  const seen = read.get(file);
  if (seen?.stamp === stamp) return seen;
  let out;
  try {
    out = { stamp, fields: readFields(JSON.parse(fs.readFileSync(file, "utf8"))) };
  } catch (err) {
    out = { stamp, fields: null, error: new Error(`${file} cannot be read: ${err.message}`) };
    debug.error("game descriptions: %s", out.error.message);
  }
  read.set(file, out);
  return out;
}

/** Keeps the entries not moved yet in game-descriptions.json, or removes it when none are left. */
function writeLeftover() {
  if (leftover.size) writeAtomic(LEGACY_FILE, `${JSON.stringify(Object.fromEntries(leftover), null, 1)}\n`);
  else fs.rmSync(LEGACY_FILE, { force: true });
}

/**
 * Moves game-descriptions.json into the folders. A game whose folder already
 * has a game.json gets only the fields it lacks. An entry that cannot be moved
 * (its game.json is broken, the disk refuses) stays in the old file and is still
 * read from there; the old file goes once nothing is left in it.
 */
function migrateLegacy() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(LEGACY_FILE, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") debug.error("game descriptions: reading %s: %s", LEGACY_FILE, err.message);
    return;
  }
  const left = new Map();
  for (const [key, entry] of Object.entries(normalize(raw))) {
    const id = key.toUpperCase();
    const fields = readFields(entry);
    if (!Object.keys(fields).length) continue;
    if (!ID_RE.test(id)) {
      left.set(key, fields);
      continue;
    }
    try {
      const dir = folders().get(id);
      const there = dir ? readFile(path.join(dir, FILE)) : { fields: null };
      if (there.error) throw there.error;
      persist(id, { ...fields, ...there.fields });
    } catch (err) {
      debug.error("game descriptions: %s stays in %s: %s", id, LEGACY_FILE, err.message);
      left.set(id, fields);
    }
  }
  leftover = left;
  try {
    writeLeftover();
    debug.log("game descriptions: moved %s into %s%s", LEGACY_FILE, GAMES_DIR, left.size ? ` (${left.size} left there)` : "");
  } catch (err) {
    debug.error("game descriptions: updating %s: %s", LEGACY_FILE, err.message);
  }
}

/** Every game folder, by id: Map id → folder. Read again when the games folder changes; none when it cannot be read. */
function folders() {
  let st;
  try {
    st = fs.statSync(GAMES_DIR, { throwIfNoEntry: false });
    if (!st) return new Map();
    if (index?.mtimeMs === st.mtimeMs) return index.byId;
    const byId = new Map();
    for (const d of fs.readdirSync(GAMES_DIR, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const m = d.isDirectory() && FOLDER_ID_RE.exec(d.name);
      if (!m) continue;
      const id = m[1].toUpperCase();
      if (byId.has(id)) {
        debug.error("game descriptions: %s and %s are both for %s; using the first", byId.get(id), d.name, id);
        continue;
      }
      byId.set(id, path.join(GAMES_DIR, d.name));
    }
    index = { mtimeMs: st.mtimeMs, byId };
    return byId;
  } catch (err) {
    debug.error("game descriptions: reading %s: %s", GAMES_DIR, err.message);
    return new Map();
  }
}

let migrated = false;
/** What the admin wrote about a game, or null; a game.json that cannot be read throws when `strict`. */
function fieldsOf(id, { strict = false } = {}) {
  if (!migrated) {
    migrated = true;
    migrateLegacy();
  }
  const dir = folders().get(id);
  const got = dir ? readFile(path.join(dir, FILE)) : { fields: null };
  if (got.error && strict) throw got.error;
  if (got.error) return null;
  const old = leftover.get(id);
  return old || got.fields ? { ...old, ...got.fields } : null;
}

function all() {
  fieldsOf(null);
  const out = {};
  for (const id of new Set([...folders().keys(), ...leftover.keys()])) {
    const fields = fieldsOf(id);
    if (fields && Object.keys(fields).length) out[id] = fields;
  }
  return out;
}

/** Writes a game's fields into its folder (made when missing); none left removes its game.json. */
function persist(id, fields) {
  const dir = folders().get(id) ?? path.join(GAMES_DIR, folderName(id, fields.name?.ko ?? fields.name?.en ?? nameOf(id)));
  const file = path.join(dir, FILE);
  if (Object.keys(fields).length) writeAtomic(file, toJson(id, fields));
  else {
    fs.rmSync(file, { force: true });
    // The folder goes too when nothing else (a picture) is in it.
    try {
      fs.rmdirSync(dir);
    } catch { /* not empty */ }
  }
  read.delete(file);
  index = null;
  if (leftover.delete(id)) writeLeftover();
}

const clean = (v, field) => {
  let s = String(v ?? "").replace(/\r\n/g, "\n").trim();
  if (field === "name") s = s.replace(/\s+/g, " ");
  s = s.slice(0, LIMIT[field] ?? MAX);
  return s || null;
};

/** Every game the admin wrote about, by base title id. */
export function edited() {
  return Object.keys(all());
}

/** The admin's text for a game ({ description, notes }, each { en, ko } or null), or null. */
export function get(id) {
  const own = ID_RE.test(String(id)) ? fieldsOf(id) : null;
  return own && Object.keys(own).length ? { name: own.name ?? null, description: own.description ?? null, notes: own.notes ?? null } : null;
}

/**
 * Save one field ("description" or "notes"); an empty language is stored as
 * none, and both empty forgets that field (and the game, when nothing is left).
 */
export function set(id, field, { en, ko }) {
  if (!ID_RE.test(String(id)) || !FIELDS.includes(field)) return false;
  const [enText, koText] = [clean(en, field), clean(ko, field)];
  // A game.json that cannot be read (a hand edit gone wrong) is not written over: the error says which.
  const { [field]: _old, ...others } = fieldsOf(id, { strict: true }) ?? {};
  persist(id, enText || koText ? { ...others, [field]: { en: enText, ko: koText } } : others);
  return true;
}

/** Forget one field, or everything the admin wrote about the game. */
export function reset(id, field = null) {
  const own = ID_RE.test(String(id)) ? fieldsOf(id, { strict: true }) : null;
  if (!own || !Object.keys(own).length || (field && !own[field])) return false;
  if (field) return set(id, field, {});
  persist(id, {});
  return true;
}

// The reader's language, else the admin's other one (what they wrote beats nothing).
const pick = (text, lang) => (text ? (lang === "ko" ? text.ko ?? text.en : text.en ?? text.ko) ?? null : null);

/** The description a reader sees: the admin's, else `fallback` (titledb's own). */
export function describe(id, lang, fallback = null) {
  return pick(get(id)?.description, lang) ?? fallback ?? null;
}

/** The admin's name for a game in each language they wrote ({ en?, ko? }), or null. */
export function names(id) {
  const n = get(String(id ?? "").toUpperCase())?.name;
  if (!n) return null;
  const out = { ...(n.en ? { en: n.en } : {}), ...(n.ko ? { ko: n.ko } : {}) };
  return Object.keys(out).length ? out : null;
}

/** What the admin adds about a game (what to install with it, space, version): never from titledb. */
export function notes(id, lang) {
  return pick(get(id)?.notes, lang);
}
