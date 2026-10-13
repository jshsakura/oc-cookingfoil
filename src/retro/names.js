/**
 * Names the admin gives retro games, kept in ${COOK_DATA_DIR}/retro-names.json
 * as { <game id>: { ko?, en? } }. A game's id comes from its system and path,
 * so the ROM file keeps its name (which its box art and per-game configs are
 * found by) while clients show this one. It wins over the built-in arcade
 * titles too.
 */
import fs from "fs";
import path from "path";
import { dataDir } from "../helpers/envs.js";

const FILE = path.join(dataDir, "retro-names.json");
const ID_RE = /^[a-z0-9]{1,16}-[0-9a-f]{10}$/;
const MAX = 120;

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
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(`${FILE}.tmp`, `${JSON.stringify(next, null, 1)}\n`);
  fs.renameSync(`${FILE}.tmp`, FILE);
  saved = next;
  return true;
}
