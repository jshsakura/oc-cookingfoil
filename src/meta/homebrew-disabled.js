/**
 * Homebrew apps the admin turned off: kept on the server (a followed
 * repository is still checked) but left out of the list clients see, and their
 * downloads answer 404. Kept in ${COOK_DATA_DIR}/homebrew/disabled.json as
 * { <id>: true }.
 */
import path from "path";
import { dataDir } from "../helpers/envs.js";
import { jsonFile } from "../helpers/json-file.js";

const FILE = path.join(dataDir, "homebrew", "disabled.json");
const ID_RE = /^(gh|m)-[0-9a-f]{12}$/;

const file = jsonFile(FILE);
const all = file.read;

export const isDisabled = (id) => all()[id] === true;

/** Turns an app on or off; false for an unknown id. */
export function setEnabled(id, enabled) {
  if (!ID_RE.test(String(id))) return false;
  const { [id]: _old, ...rest } = all();
  const next = enabled ? rest : { ...rest, [id]: true };
  file.write(next);
  return true;
}

/** For tests. */
export function reset() {
  file.forget();
}
