/**
 * Every capability, checked together: no two share an id, no two claim one route.
 *
 * To add one: write it with defineCapability() in src/capabilities/<area>.js, import the module here
 * and spread it into ENTRIES. Then take its route out of LEGACY_UNREGISTERED in opt-out.js.
 *
 * Each area module exports one array named `<area>Capabilities` (gamesCapabilities from games.js,
 * retroCapabilities from retro.js, libraryCapabilities from library.js), so ENTRIES reads the same
 * however many areas join.
 */
import { routeKey, ACCESS } from "./define.js";
import { gamesCapabilities } from "./games.js";
import { libraryCapabilities } from "./library.js";
import { retroCapabilities } from "./retro.js";
import { serverCapabilities } from "./server.js";
import { trashCapabilities } from "./trash.js";

// Area modules, each exporting an array of defineCapability() results.
const ENTRIES = [...serverCapabilities, ...gamesCapabilities, ...libraryCapabilities, ...retroCapabilities, ...trashCapabilities];

/** A registry over checked capabilities. Throws listing every duplicate. */
export function buildRegistry(entries) {
  const byId = new Map();
  const byRoute = new Map();
  const problems = [];
  for (const cap of entries) {
    if (byId.has(cap.id)) problems.push(`duplicate id ${cap.id}`);
    else byId.set(cap.id, cap);
    if (!cap.http) continue;
    const key = routeKey(cap.http);
    if (byRoute.has(key)) problems.push(`${key} is claimed by ${byRoute.get(key).id} and ${cap.id}`);
    else byRoute.set(key, cap);
  }
  if (problems.length) throw new Error(`capability registry: ${problems.join("; ")}`);
  const all = Object.freeze([...entries]);
  return Object.freeze({
    all,
    byId: (id) => byId.get(id),
    byRoute: (key) => byRoute.get(key),
    /** What a token of this level may see and call, in registry order. */
    toolsFor: (level) => all.filter((c) => c.token && ACCESS.indexOf(c.access) <= ACCESS.indexOf(level)),
  });
}

export const registry = buildRegistry(ENTRIES);
