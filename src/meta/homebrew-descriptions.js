/**
 * What the admin writes about each homebrew app, kept in
 * ${COOK_DATA_DIR}/homebrew/descriptions.json as { <id>: { en, ko } }.
 *
 * English is the default for every language; Korean readers get the Korean
 * text when there is one. An app the admin never edited shows its GitHub
 * repository's description; one the admin cleared shows none (null).
 */
import fs from "fs";
import path from "path";
import { dataDir } from "../helpers/envs.js";

const FILE = path.join(dataDir, "homebrew", "descriptions.json");
const ID_RE = /^(gh|m)-[0-9a-f]{12}$/;
const MAX = 2000;

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

const clean = (v) => {
  const s = String(v ?? "").replace(/\r\n/g, "\n").trim().slice(0, MAX);
  return s || null;
};

/** The admin's text for an app ({ en, ko }), or null when it was never edited. */
export function get(id) {
  return all()[id] ?? null;
}

/** Save the admin's text; empty fields are stored as null (no description). */
export function set(id, { en, ko }) {
  if (!ID_RE.test(String(id))) return false;
  persist({ ...all(), [id]: { en: clean(en), ko: clean(ko) } });
  return true;
}

/** Forget the admin's text, so the GitHub description shows again. */
export function reset(id) {
  if (!(id in all())) return false;
  const { [id]: _gone, ...rest } = all();
  persist(rest);
  return true;
}

/** The description a reader sees: the admin's (Korean for Korean readers), else `fallback`. Pure over the saved text. */
export function describe(id, lang, fallback = null) {
  const own = get(id);
  if (!own) return fallback ?? null;
  return (lang === "ko" && own.ko) || own.en || null;
}
