/**
 * Names the admin gives retro games, kept in ${COOK_DATA_DIR}/retro-names.json
 * as { <game id>: { ko?, en? } }. A game's id comes from its system and path,
 * so the ROM file keeps its name (which its box art and per-game configs are
 * found by) while clients show this one. It wins over the built-in arcade
 * titles too.
 *
 * A Korean title guessed from the English one (ko-match.js) is a suggestion
 * until the admin decides: approving it saves it here as the game's ko name,
 * rejecting it is kept in ${COOK_DATA_DIR}/retro-name-guesses.json as
 * { <game id>: "rejected" } so it is not suggested again.
 */
import fs from "fs";
import path from "path";
import { dataDir } from "../helpers/envs.js";

const FILE = path.join(dataDir, "retro-names.json");
const GUESS_FILE = path.join(dataDir, "retro-name-guesses.json");
const ID_RE = /^[a-z0-9]{1,16}-[0-9a-f]{10}$/;
const MAX = 120;

let saved = null;
let guesses = null;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    return {};
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(value, null, 1)}\n`);
  fs.renameSync(`${file}.tmp`, file);
}

function all() {
  return (saved ??= readJson(FILE));
}

const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, MAX) || null;

/** The admin's names for a game ({ ko?, en? }), or null. */
export function get(id) {
  return all()[id] ?? null;
}

/** Sets a game's names; both empty forgets them. False for an id that isn't a game's. */
export function set(id, { ko, en } = {}) {
  if (!ID_RE.test(String(id))) return false;
  const entry = { ...(clean(ko) ? { ko: clean(ko) } : {}), ...(clean(en) ? { en: clean(en) } : {}) };
  const { [id]: _old, ...rest } = all();
  const next = Object.keys(entry).length ? { ...rest, [id]: entry } : rest;
  writeJson(FILE, next);
  saved = next;
  return true;
}

/** Whether the admin turned down the guessed Korean title of a game. */
export const guessRejected = (id) => (guesses ??= readJson(GUESS_FILE))[id] === "rejected";

/** Turns down a game's guessed Korean title for good. False for an id that isn't a game's. */
export function rejectGuess(id) {
  if (!ID_RE.test(String(id))) return false;
  const next = { ...(guesses ??= readJson(GUESS_FILE)), [id]: "rejected" };
  writeJson(GUESS_FILE, next);
  guesses = next;
  return true;
}
