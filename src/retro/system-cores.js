/**
 * The core the admin picked for a console, kept in
 * ${COOK_DATA_DIR}/retro-system-cores.json as { <system id>: <core> } and laid
 * over the system table when the catalog scans, so the operator's
 * systems.json is never written. The pick changes every game's core, and with
 * it each HOME menu forwarder's key, so consoles fetch a new forwarder.
 */
import fs from "fs";
import path from "path";
import debug from "../debug.js";
import { dataDir } from "../helpers/envs.js";

const FILE = path.join(dataDir, "retro-system-cores.json");
export const SYSTEM_RE = /^[a-z0-9_-]{1,24}$/;
export const CORE_RE = /^[a-z0-9_]{1,64}$/;

let saved = null;

export function all() {
  if (saved) return saved;
  try {
    const read = JSON.parse(fs.readFileSync(FILE, "utf8"));
    saved = read && typeof read === "object" && !Array.isArray(read) ? read : {};
  } catch (err) {
    if (err.code !== "ENOENT") debug.error("retro: %s is unreadable, using the system table's cores: %s", FILE, err.message);
    saved = {};
  }
  return saved;
}

/** Picks a console's core; null goes back to the system table's. False for malformed ids. */
export function set(system, core) {
  if (!SYSTEM_RE.test(String(system)) || (core !== null && !CORE_RE.test(String(core)))) return false;
  const { [system]: _old, ...rest } = all();
  const next = core === null ? rest : { ...rest, [system]: core };
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(`${FILE}.tmp`, `${JSON.stringify(next, null, 1)}\n`);
  fs.renameSync(`${FILE}.tmp`, FILE);
  saved = next;
  return true;
}

/** `systems` with each picked core in place of the table's, which stays as `tableCore`. Pure. */
export function withPicks(systems, picks) {
  return Object.fromEntries(Object.entries(systems).map(([id, s]) => {
    const core = picks[id];
    return [id, core && CORE_RE.test(core) && core !== s.core ? { ...s, core, tableCore: s.core } : s];
  }));
}
