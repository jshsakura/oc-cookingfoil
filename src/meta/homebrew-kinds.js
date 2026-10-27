/**
 * What each homebrew app is, set by the admin: "tool" (the default: file
 * managers, save tools …) or "port" (a program brought over from another
 * system, which usually comes with its own saves and mods). Kept in
 * ${COOK_DATA_DIR}/homebrew/kinds.json as { <id>: "port" }; tools are not stored.
 */
import path from "path";
import { dataDir } from "../helpers/envs.js";
import { jsonFile } from "../helpers/json-file.js";

const FILE = path.join(dataDir, "homebrew", "kinds.json");
const ID_RE = /^(gh|m)-[0-9a-f]{12}$/;
export const KINDS = ["tool", "port"];

const file = jsonFile(FILE);
const all = file.read;

/** "tool" or "port". */
export const kindOf = (id) => (all()[id] === "port" ? "port" : "tool");

/** Sets an app's kind; false for an unknown id or kind. */
export function set(id, kind) {
  if (!ID_RE.test(String(id)) || !KINDS.includes(kind)) return false;
  const { [id]: _old, ...rest } = all();
  const next = kind === "port" ? { ...rest, [id]: "port" } : rest;
  file.write(next);
  return true;
}
