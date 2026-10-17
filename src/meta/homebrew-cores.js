/**
 * How many CPU cores an app's HOME-menu shortcut may use, set by the admin:
 * 4 (the default: cores 0 to 3, as Sphaira's shortcuts have, for ports that
 * start a thread on core 3) or 3 (cores 0 to 2 only). Kept in
 * ${COOK_DATA_DIR}/homebrew/cores.json as { <id>: 3 }; the default is not stored.
 */
import fs from "fs";
import path from "path";
import { dataDir } from "../helpers/envs.js";

const FILE = path.join(dataDir, "homebrew", "cores.json");
const ID_RE = /^(gh|m)-[0-9a-f]{12}$/;
export const CORES = [3, 4];

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

/** 3 or 4. */
export const coresOf = (id) => (all()[id] === 3 ? 3 : 4);

/** Sets an app's cores; false for an unknown id or count. */
export function set(id, cores) {
  if (!ID_RE.test(String(id)) || !CORES.includes(cores)) return false;
  const { [id]: _old, ...rest } = all();
  const next = cores === 3 ? { ...rest, [id]: 3 } : rest;
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(`${FILE}.tmp`, `${JSON.stringify(next, null, 1)}\n`);
  fs.renameSync(`${FILE}.tmp`, FILE);
  saved = next;
  return true;
}

/** For tests. */
export function reset() {
  saved = null;
}
