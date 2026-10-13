/**
 * What the admin writes about each game, kept in
 * ${COOK_DATA_DIR}/game-descriptions.json, apart from titledb so no refresh
 * ever overwrites it:
 *
 *   { <base title id>: { name?: { en, ko }, description?: { en, ko }, notes?: { en, ko } } }
 *
 * name replaces the game's name everywhere it is shown (a wrong or empty one
 * from titledb or the file); one the admin cleared goes back to the usual name.
 *
 * description replaces titledb's own text (for a game it has none for, or a
 * wrong one); one the admin cleared goes back to titledb's. notes is extra
 * information only the admin writes, such as what to install with the game.
 * Korean readers get the Korean text when there is one, everyone else the
 * English one. Line breaks are kept and shown as written.
 */
import fs from "fs";
import path from "path";
import { dataDir } from "../helpers/envs.js";

const FILE = path.join(dataDir, "game-descriptions.json");
const ID_RE = /^[0-9A-F]{16}$/;
const MAX = 2000;
export const FIELDS = ["name", "description", "notes"];
// A name is one line; the other fields keep their line breaks.
const LIMIT = { name: 120 };

let saved = null;

function all() {
  if (saved) return saved;
  try {
    saved = JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    saved = {};
  }
  return saved;
}

function persist(next) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(`${FILE}.tmp`, `${JSON.stringify(next, null, 1)}\n`);
  fs.renameSync(`${FILE}.tmp`, FILE);
  saved = next;
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
  const own = all()[id];
  return own ? { name: own.name ?? null, description: own.description ?? null, notes: own.notes ?? null } : null;
}

/**
 * Save one field ("description" or "notes"); an empty language is stored as
 * none, and both empty forgets that field (and the game, when nothing is left).
 */
export function set(id, field, { en, ko }) {
  if (!ID_RE.test(String(id)) || !FIELDS.includes(field)) return false;
  const [enText, koText] = [clean(en, field), clean(ko, field)];
  const { [id]: prev = {}, ...rest } = all();
  const { [field]: _old, ...others } = prev;
  const entry = enText || koText ? { ...others, [field]: { en: enText, ko: koText } } : others;
  persist(Object.keys(entry).length ? { ...rest, [id]: entry } : rest);
  return true;
}

/** Forget one field, or everything the admin wrote about the game. */
export function reset(id, field = null) {
  const own = all()[id];
  if (!own || (field && !own[field])) return false;
  if (field) return set(id, field, {});
  const { [id]: _gone, ...rest } = all();
  persist(rest);
  return true;
}

// The reader's language, else the admin's other one (what they wrote beats nothing).
const pick = (text, lang) => (text ? (lang === "ko" ? text.ko ?? text.en : text.en ?? text.ko) ?? null : null);

/** The description a reader sees: the admin's, else `fallback` (titledb's own). */
export function describe(id, lang, fallback = null) {
  return pick(all()[id]?.description, lang) ?? fallback ?? null;
}

/** The admin's name for a game in each language they wrote ({ en?, ko? }), or null. */
export function names(id) {
  const n = all()[String(id ?? "").toUpperCase()]?.name;
  if (!n) return null;
  const out = { ...(n.en ? { en: n.en } : {}), ...(n.ko ? { ko: n.ko } : {}) };
  return Object.keys(out).length ? out : null;
}

/** What the admin adds about a game (what to install with it, space, version): never from titledb. */
export function notes(id, lang) {
  return pick(all()[id]?.notes, lang);
}
