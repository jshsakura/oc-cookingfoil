/**
 * The representative the admin chose for a group of versions of one game,
 * kept in ${COOK_DATA_DIR}/retro-variants.json as { <group id>: <game id> }.
 * Read on every request, so a change shows at once, without a rescan or a
 * restart. A pick whose game left the group is ignored.
 */
import path from "path";
import debug from "../debug.js";
import { jsonFile } from "../helpers/json-file.js";
import { dataDir } from "../helpers/envs.js";

const FILE = path.join(dataDir, "retro-variants.json");
const GROUP_RE = /^[a-z0-9_-]{1,24}~[0-9a-f]{10}$/;
const GAME_RE = /^[a-z0-9_-]{1,24}-[0-9a-f]{10}$/;

const file = jsonFile(FILE);

/** Changes when the stored values do, by the server or by hand. */
export const fileStamp = () => file.stamp();
const all = file.read;

/** Reads the file again on the next use. */
export function reload() {
  file.forget();
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
  file.write(next);
  return true;
}
