/**
 * What the admin writes about each game, kept as plain files apart from titledb
 * so no refresh ever overwrites it and nothing of it lives only in a database:
 *
 *   ${COOK_DATA_DIR}/metadata/games/<name> [<base title id>]/game.json
 *     { id, name?, description?, notes? }
 *
 * Each field is text per client language ({ "ko": "…", "ja": "…", "zh-Hant": "…" },
 * the keys of meta/langs.js LANGS) or plain text, which counts as Korean when it
 * has Hangul and as English otherwise (other languages reach English through
 * the usual fallback, so a Korean text is never shown to a German reader).
 *
 * A game is found by the id in brackets at the end of its folder's name; the
 * name before it is for people and may be changed by hand. What is read comes
 * from meta/game-meta.js, which keeps the folders in memory: a game.json edited
 * by hand shows after its next look (once the folder's watch has seen it go
 * quiet, or at once from the admin page), with no restart. A save reads the file again first.
 *
 * name replaces the game's name everywhere it is shown (a wrong or empty one
 * from titledb or the file); one the admin cleared goes back to the usual name.
 *
 * description replaces titledb's own text (for a game it has none for, or a
 * wrong one); one the admin cleared goes back to titledb's. notes is extra
 * information only the admin writes, such as what to install with the game.
 * A reader of a language gets the admin's text in it (plain text in the one it
 * counts as); where a source has the language too (titledb's name or description) that
 * comes next, then English (title-detail.js). Line breaks are kept and shown as written.
 *
 * game-descriptions.json, where this was kept before, is moved into the folders
 * the first time they are read, and removed once every game is there.
 */
import fs from "fs";
import path from "path";
import { dataDir } from "../helpers/envs.js";
import debug from "../debug.js";
import * as gameMeta from "./game-meta.js";
import { FIELDS, readFields } from "./game-meta.js";
import { writeAtomic } from "./game-art-files.js";
import { LANGS } from "./langs.js";

export { FIELDS, GAMES_DIR, folderName, useNames } from "./game-meta.js";
const LEGACY_FILE = path.join(dataDir, "game-descriptions.json");
const FILE = "game.json";
const ID_RE = /^[0-9A-F]{16}$/;
const MAX = 2000;
// A name is one line; the other fields keep their line breaks.
const LIMIT = { name: 120 };
// What a field is called in an error the admin reads, with its particle.
const LABEL = { name: ["이름", "은"], description: ["소개", "는"], notes: ["추가 정보", "는"] };
const labelOf = (field, lang = null) => `${LABEL[field][0]}${lang ? `(${lang})` : ""}${LABEL[field][1]}`;
// What a metadata refresh must leave alone when the folder has a picture in the slot.
const ART_LOCKS = [["icon", (s) => s.icon], ["banner", (s) => s.banner], ["screenshots", (s) => s.screens.length > 0]];

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

// Entries of game-descriptions.json that could not be moved yet: still read, and moved when saved.
let leftover = new Map();

// The game.json layout; a file without one was written by version 1.
export const SCHEMA = 1;
// Keys the server owns in a game.json; every other key (one a later version or a person added) is kept as it is.
const OWN_KEYS = new Set(["id", "version", "locked", ...FIELDS]);

/**
 * A game.json: what was in it beside the server's keys, then the fields.
 * `locked` lists what the admin set by hand, which a metadata refresh will not
 * replace: the fields saved here, and anything else already listed (art). Pure.
 */
function toJson(id, fields, before = {}) {
  const kept = Object.fromEntries(Object.entries(before).filter(([k]) => !OWN_KEYS.has(k)));
  const otherLocks = [...new Set((Array.isArray(before.locked) ? before.locked : []).filter((k) => typeof k === "string" && !FIELDS.includes(k)))];
  const locked = [...FIELDS.filter((f) => fields[f]), ...otherLocks];
  // A file a later version wrote keeps its version: this one only adds what it knows.
  const version = Number.isInteger(before.version) && before.version > SCHEMA ? before.version : SCHEMA;
  const doc = { id, version, ...kept, ...fields, ...(locked.length ? { locked } : {}) };
  return { text: `${JSON.stringify(doc, null, 1)}\n`, empty: !FIELDS.some((f) => fields[f]) && !Object.keys(kept).length && !otherLocks.length };
}

/** What was read of a game's game.json: { fields, raw } or { fields: null, error }; { fields: null } when it has none. */
function readFile(id) {
  const json = gameMeta.entry(id)?.json;
  if (!json) return { fields: null };
  if (json.error) return { fields: null, error: new Error(json.error) };
  return { fields: gameMeta.entry(id).fields, raw: json.raw };
}

/** Keeps `left` (the entries not moved yet) in game-descriptions.json, or removes it when none are left. */
function writeLeftover(left) {
  if (left.size) writeAtomic(LEGACY_FILE, `${JSON.stringify(Object.fromEntries(left), null, 1)}\n`);
  else fs.rmSync(LEGACY_FILE, { force: true });
  // Only once the disk agrees: otherwise what the admin removed would come back on the next start.
  leftover = left;
}

const HANGUL_RE = /[가-힣]/;

/** A field as text per language: plain text is Korean when it has Hangul, else English. Pure. */
const asLangs = (v) => (typeof v === "string" ? { [HANGUL_RE.test(v) ? "ko" : "en"]: v } : { ...(v ?? {}) });

/** A field's text in `lang` (plain text only in the language it counts as). Pure. */
const textIn = (v, lang) => asLangs(v)[lang] || null;

/**
 * Text per language back to what is kept, null when none has any. Never plain text:
 * that would read as Korean or English only, not as the languages sent. Pure.
 */
function gather(byLang) {
  const kept = Object.fromEntries(LANGS.filter((l) => byLang[l]).map((l) => [l, byLang[l]]));
  return Object.keys(kept).length ? kept : null;
}

/** Two sets of fields, `mine` winning language by language (plain text in `mine` wins whole). Pure. */
function mergeFields(old, mine) {
  const out = { ...old };
  for (const [field, text] of Object.entries(mine ?? {})) {
    const next = typeof text === "string" ? text : gather({ ...asLangs(old?.[field]), ...Object.fromEntries(Object.entries(text).filter(([, v]) => v)) });
    if (next) out[field] = next;
  }
  return out;
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
      gameMeta.refresh(id);
      const there = readFile(id);
      if (there.error) throw there.error;
      persist(id, mergeFields(fields, there.fields));
    } catch (err) {
      debug.error("game descriptions: %s stays in %s: %s", id, LEGACY_FILE, err.message);
      left.set(id, fields);
    }
  }
  try {
    writeLeftover(left);
    debug.log("game descriptions: moved %s into %s%s", LEGACY_FILE, gameMeta.GAMES_DIR, left.size ? ` (${left.size} left there)` : "");
  } catch (err) {
    debug.error("game descriptions: updating %s: %s", LEGACY_FILE, err.message);
    // The old file is still whole on disk: keep reading every entry from it.
    leftover = new Map(Object.entries(normalize(raw)).map(([k, e]) => [k.toUpperCase(), readFields(e)]));
  }
}

let migrated = false;
/** What the admin wrote about a game, or null; a game.json that cannot be read throws when `strict`. */
function fieldsOf(id, { strict = false } = {}) {
  if (!migrated) {
    migrated = true;
    migrateLegacy();
  }
  const got = readFile(id);
  if (got.error && strict) throw got.error;
  const old = leftover.get(id);
  if (got.error) return old ?? null;
  return old || got.fields ? mergeFields(old, got.fields) : null;
}

function all() {
  fieldsOf(null);
  const out = {};
  for (const id of new Set([...gameMeta.ids(), ...leftover.keys()])) {
    const fields = fieldsOf(id);
    if (fields && Object.keys(fields).length) out[id] = fields;
  }
  return out;
}

/** Writes a game's fields into its folder (made when missing); none left removes its game.json. */
function persist(id, fields) {
  const { text, empty } = toJson(id, fields, readFile(id).raw);
  const label = textIn(fields.name, "ko") ?? textIn(fields.name, "en") ?? Object.values(asLangs(fields.name))[0] ?? null;
  if (!empty) writeAtomic(path.join(gameMeta.ensureFolder(id, label), FILE), text);
  else if (gameMeta.folderOf(id)) {
    const dir = gameMeta.folderOf(id);
    fs.rmSync(path.join(dir, FILE), { force: true });
    // The folder goes too when nothing else (a picture) is in it.
    try {
      fs.rmdirSync(dir);
    } catch { /* not empty */ }
  }
  gameMeta.refresh(id);
  if (leftover.has(id)) writeLeftover(new Map([...leftover].filter(([k]) => k !== id)));
}

const clean = (v, field, limit = LIMIT[field] ?? MAX) => {
  let s = String(v ?? "").replace(/\r\n/g, "\n").trim();
  if (field === "name") s = s.replace(/\s+/g, " ");
  s = s.slice(0, limit);
  return s || null;
};

/** Every game the admin wrote about, by base title id. */
export function edited() {
  return Object.keys(all());
}

/**
 * What a metadata refresh must leave alone for a game: the fields and art the
 * admin set by hand, and the slots with a picture in its folder (icon, banner, screenshots).
 */
export function locked(id) {
  if (!ID_RE.test(String(id))) return [];
  fieldsOf(id);
  const got = readFile(id);
  const list = got.raw?.locked;
  // A file from before the list (0.9.4) holds only what the admin wrote: all of it is theirs.
  const fromFile = Array.isArray(list) ? list.filter((k) => typeof k === "string") : Object.keys(got.fields ?? {});
  const slots = gameMeta.slots(id);
  // Text still in the old file was written by the admin too.
  return [...new Set([...fromFile, ...Object.keys(leftover.get(id) ?? {}), ...ART_LOCKS.filter(([, has]) => has(slots)).map(([k]) => k)])];
}

/**
 * Why `value`, sent for a field, cannot be saved, in words for the admin; null when it can.
 * It is plain text (Korean when it has Hangul, else English) or { <client language>: text | null }; too long is refused, not cut. Pure.
 */
export function checkInput(field, value) {
  if (value == null) return null;
  const tooLong = (text, lang) => {
    const limit = LIMIT[field] ?? MAX;
    return (clean(text, field, Infinity) ?? "").length > limit ? `${labelOf(field, lang)} ${limit}자를 넘을 수 없습니다` : null;
  };
  if (typeof value === "string") return tooLong(value, null);
  if (typeof value !== "object" || Array.isArray(value)) return `${labelOf(field)} 글자나 언어별 글자({ "ko": "…" })로 보냅니다`;
  const unknown = Object.keys(value).find((l) => !LANGS.includes(l));
  if (unknown) return `알 수 없는 언어 키입니다: ${unknown}. 쓸 수 있는 키는 ${LANGS.join(", ")} 입니다`;
  for (const [lang, text] of Object.entries(value)) {
    if (text != null && typeof text !== "string") return `${labelOf(field, lang)} 글자로 보냅니다`;
    const problem = text ? tooLong(text, lang) : null;
    if (problem) return problem;
  }
  return null;
}

/**
 * The admin's text for a game, or null: { name, description, notes }, each null or
 * { <language>: text } with en and ko always there (null when not written). Plain
 * text is given in the language it counts as.
 */
export function get(id) {
  const own = ID_RE.test(String(id)) ? fieldsOf(id) : null;
  if (!own || !Object.keys(own).length) return null;
  const shown = (v) => (v ? { en: null, ko: null, ...asLangs(v) } : null);
  return { name: shown(own.name), description: shown(own.description), notes: shown(own.notes) };
}

/**
 * Save one field. Plain text is kept as sent and read as Korean when it has Hangul,
 * else English. Text per language changes only the languages sent: one sent empty is
 * forgotten, one not sent is kept (plain text already there counts in its one language). Nothing left forgets the field (and the
 * game, when nothing is left). Languages no client reads are ignored: checkInput refuses them first.
 */
export function set(id, field, value) {
  if (!ID_RE.test(String(id)) || !FIELDS.includes(field)) return false;
  // A hand edit since the last look is read before it is written over (or refused, when broken).
  gameMeta.refresh(id);
  // A game.json that cannot be read (a hand edit gone wrong) is not written over: the error says which.
  const { [field]: old, ...others } = fieldsOf(id, { strict: true }) ?? {};
  let next;
  if (typeof value === "string") next = clean(value, field);
  else {
    const byLang = asLangs(old);
    for (const lang of LANGS) if (Object.hasOwn(value ?? {}, lang)) byLang[lang] = clean(value[lang], field);
    next = gather(byLang);
  }
  persist(id, next ? { ...others, [field]: next } : others);
  return true;
}

/** Forget one field, or everything the admin wrote about the game. */
export function reset(id, field = null) {
  if (ID_RE.test(String(id))) gameMeta.refresh(id);
  const own = ID_RE.test(String(id)) ? fieldsOf(id, { strict: true }) : null;
  if (!own || !Object.keys(own).length || (field && !own[field])) return false;
  if (field) return set(id, field, "");
  persist(id, {});
  return true;
}

// The reader's language, else English, else Korean (what the admin wrote beats nothing).
const pick = (text, lang) => textIn(text, lang) ?? textIn(text, "en") ?? textIn(text, "ko");

/** The description a reader sees: the admin's, else `fallback` (titledb's own). */
export function describe(id, lang, fallback = null) {
  return pick(get(id)?.description, lang) ?? fallback ?? null;
}

/** The admin's name for a game in each language it has one in ({ <language>: name }, plain text in the one it counts as), or null. */
export function names(id) {
  const n = get(String(id ?? "").toUpperCase())?.name;
  if (!n) return null;
  const out = Object.fromEntries(Object.entries(n).filter(([, v]) => v));
  return Object.keys(out).length ? out : null;
}

/** What the admin adds about a game (what to install with it, space, version): never from titledb. */
export function notes(id, lang) {
  return pick(get(id)?.notes, lang);
}
