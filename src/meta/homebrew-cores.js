/**
 * How many CPU cores an app's HOME-menu shortcut may use, set by the admin:
 * 3 (the default, cores 0 to 2) or 4 (core 3 too, for an app that starts a
 * thread there; core 3 is shared with system services). Kept in
 * ${COOK_DATA_DIR}/homebrew/cores.json as { <id>: 4 }; the default is not stored.
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
export const coresOf = (id) => (all()[id] === 4 ? 4 : 3);

/** Sets an app's cores; false for an unknown id or count. */
export function set(id, cores) {
  if (!ID_RE.test(String(id)) || !CORES.includes(cores)) return false;
  const { [id]: _old, ...rest } = all();
  const next = cores === 4 ? { ...rest, [id]: 4 } : rest;
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
