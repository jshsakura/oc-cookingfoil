/**
 * The cores the admin switched off, kept in ${COOK_DATA_DIR}/retro-cores-off.json as a sorted
 * array of core ids. A core that is off leaves the console's base pack (its .nro and .info),
 * the upkeep stops fetching it, and the games that start with it stay listed but can't be taken.
 * Consoles that already have the core keep it: the pack only stops sending it.
 */
import fs from "fs";
import path from "path";
import debug from "../debug.js";
import { dataDir } from "../helpers/envs.js";
import { CORE_RE } from "./system-cores.js";

const FILE = path.join(dataDir, "retro-cores-off.json");

let saved = null;

/** The switched-off cores as a Set. */
export function off() {
  if (saved) return saved;
  try {
    const read = JSON.parse(fs.readFileSync(FILE, "utf8"));
    saved = new Set(Array.isArray(read) ? read.filter((c) => typeof c === "string" && CORE_RE.test(c)) : []);
  } catch (err) {
    if (err.code !== "ENOENT") debug.error("retro: %s is unreadable, every core is on: %s", FILE, err.message);
    saved = new Set();
  }
  return saved;
}

/** A key that changes whenever the set does, for caches built from it. */
export const offKey = () => [...off()].sort().join(",");

/** Switches a core on or off. False for a malformed id. */
export function setEnabled(core, enabled) {
  if (!CORE_RE.test(String(core))) return false;
  const next = new Set(off());
  if (enabled) next.delete(core);
  else next.add(core);
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(`${FILE}.tmp`, `${JSON.stringify([...next].sort())}\n`);
  fs.renameSync(`${FILE}.tmp`, FILE);
  saved = next;
  return true;
}
