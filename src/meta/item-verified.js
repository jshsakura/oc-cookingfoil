/**
 * Which retro games, library games, patches and saves the admin has tried on a
 * console, shown as a 검수됨 badge like homebrew-verified.js does for homebrew. Kept in
 * ${COOK_DATA_DIR}/verified-items.json as { "<kind>:<id>": <ms since epoch> };
 * an item not in it is not verified. Callers check that the item exists.
 * A patch's or save's id carries its game's title id: moving one to another
 * game or deleting it forgets the mark (routes/admin/content-api.js).
 */
import path from "path";
import { jsonFile } from "../helpers/json-file.js";
import { dataDir } from "../helpers/envs.js";

const FILE = path.join(dataDir, "verified-items.json");
export const KINDS = ["retro", "game", "patch", "save"];
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const file = jsonFile(FILE);

/** Changes when the stored values do, by the server or by hand. */
export const fileStamp = () => file.stamp();
const all = file.read;

const keyOf = (kind, id) => `${kind}:${id}`;

/** When the item was marked verified (ms), or null. */
export const verifiedAt = (kind, id) => {
  const at = all()[keyOf(kind, id)];
  return Number.isFinite(at) ? at : null;
};

/** { verified, verified_at } for a public listing. */
export function fields(kind, id) {
  const at = verifiedAt(kind, id);
  return { verified: at !== null, verified_at: at === null ? null : new Date(at).toISOString() };
}

/** Marks or unmarks an item; marking one already marked keeps its date. False for an unknown kind or malformed id. */
export function set(kind, id, on, now = Date.now()) {
  if (!KINDS.includes(kind) || !ID_RE.test(String(id))) return false;
  const { [keyOf(kind, id)]: had, ...rest } = all();
  const next = on ? { ...rest, [keyOf(kind, id)]: Number.isFinite(had) ? had : now } : rest;
  file.write(next);
  return true;
}

/** For tests. */
export function reset() {
  file.forget();
}
