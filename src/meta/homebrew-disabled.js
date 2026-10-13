/**
 * Homebrew apps the admin turned off: kept on the server (a followed
 * repository is still checked) but left out of the list clients see, and their
 * downloads answer 404. Kept in ${COOK_DATA_DIR}/homebrew/disabled.json as
 * { <id>: true }.
 */
import fs from "fs";
import path from "path";
import { dataDir } from "../helpers/envs.js";

const FILE = path.join(dataDir, "homebrew", "disabled.json");
const ID_RE = /^(gh|m)-[0-9a-f]{12}$/;

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

export const isDisabled = (id) => all()[id] === true;

/** Turns an app on or off; false for an unknown id. */
export function setEnabled(id, enabled) {
  if (!ID_RE.test(String(id))) return false;
  const { [id]: _old, ...rest } = all();
  const next = enabled ? rest : { ...rest, [id]: true };
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
