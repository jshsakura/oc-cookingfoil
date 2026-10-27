/**
 * Which homebrew apps the admin has tried on a console (a port that runs, a tool
 * that works), shown in the library as a 검수됨 badge. Kept in
 * ${COOK_DATA_DIR}/homebrew/verified.json as { <id>: <ms since epoch> }; an app
 * not in it is not verified.
 */
import path from "path";
import { dataDir } from "../helpers/envs.js";
import { jsonFile } from "../helpers/json-file.js";

const FILE = path.join(dataDir, "homebrew", "verified.json");
const ID_RE = /^(gh|m)-[0-9a-f]{12}$/;

const file = jsonFile(FILE);
const all = file.read;

/** When the app was marked verified (ms), or null. */
export const verifiedAt = (id) => (Number.isFinite(all()[id]) ? all()[id] : null);

/** { verified, verified_at } for the library's list. */
export function fields(id) {
  const at = verifiedAt(id);
  return { verified: at !== null, verified_at: at === null ? null : new Date(at).toISOString() };
}

/** Marks or unmarks an app; marking one already marked keeps its date. False for an unknown id. */
export function set(id, on, now = Date.now()) {
  if (!ID_RE.test(String(id))) return false;
  const { [id]: had, ...rest } = all();
  const next = on ? { ...rest, [id]: Number.isFinite(had) ? had : now } : rest;
  file.write(next);
  return true;
}

/** For tests. */
export function reset() {
  file.forget();
}
