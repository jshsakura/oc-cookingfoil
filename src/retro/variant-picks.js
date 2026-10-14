/**
 * The representative the admin chose for a group of versions of one game,
 * kept in ${COOK_DATA_DIR}/retro-variants.json as { <group id>: <game id> }.
 * Read on every request, so a change shows at once, without a rescan or a
 * restart. A pick whose game left the group is ignored.
 */
import fs from "fs";
import path from "path";
import { dataDir } from "../helpers/envs.js";

const FILE = path.join(dataDir, "retro-variants.json");
const GROUP_RE = /^[a-z0-9_-]{1,24}~[0-9a-f]{10}$/;
const GAME_RE = /^[a-z0-9_-]{1,24}-[0-9a-f]{10}$/;

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

/** The game the admin picked for a group, or null. */
export function get(groupId) {
  return all()[groupId] ?? null;
}

/** Picks a group's representative; null forgets the pick. False for malformed ids. */
export function set(groupId, gameId) {
  if (!GROUP_RE.test(String(groupId)) || (gameId !== null && !GAME_RE.test(String(gameId)))) return false;
  const { [groupId]: _old, ...rest } = all();
  const next = gameId === null ? rest : { ...rest, [groupId]: gameId };
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(`${FILE}.tmp`, `${JSON.stringify(next, null, 1)}\n`);
  fs.renameSync(`${FILE}.tmp`, FILE);
  saved = next;
  return true;
}
