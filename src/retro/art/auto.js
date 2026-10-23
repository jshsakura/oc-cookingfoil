/**
 * Box art for ROMs put in the retro folders by hand: after a scan, the games
 * without box art whose ROM is not in its system's art map start the same job
 * as the admin's "fetch all missing" button (retroAutoArt, on by default).
 *
 * Each ROM is tried once per process: the ones this watcher started a job for,
 * and the ones any job already looked up (sync.js wasMatched, an upload's or the
 * admin's), are not pending any more. That job's own rescan therefore finds
 * nothing new and starts nothing, and a miss is left to the admin. A ROM mapped
 * to null (no art) is in the map and never pending.
 *
 * A burst of scans starts one run, `delayMs` after the last scan that found
 * something. A run starts one job per system with pending ROMs, one after the
 * other, so only those systems' names and bezel lists are read from GitHub.
 * When another job is running (start answers with an error) the run stops and
 * gives those ROMs back: that job's rescan when it ends looks at them again.
 * ROM files are only read by the scan; this writes nothing itself.
 */
import debug from "../../debug.js";
import * as retroCatalog from "../catalog.js";
import { readMap, wasMatched } from "./sync.js";

export const AUTO_DELAY_MS = 30_000;
// WonderSwan maps carry a console prefix and are made by hand (sync.js NOT_MATCHED).
const HAND_MAPPED = new Set(["ws"]);

/** The map of system `id`, or null when it cannot be read (a broken file is the admin's to fix). */
function mapOf(dir, id) {
  try {
    return readMap(dir, id);
  } catch (err) {
    debug.error("retro art: art-map/%s.json unread: %s", id, err.message);
    return null;
  }
}

/** Games in `state` that have no box art, no map entry and were never tried: [{ system, key }]. */
export function pendingArt(dir, state, tried, attempted = wasMatched) {
  const maps = new Map();
  const out = [];
  for (const g of state.games) {
    const system = state.systems[g.system];
    if (g.icon || !system?.libretro || HAND_MAPPED.has(g.system)) continue;
    const rom = retroCatalog.romKey(g);
    const key = `${g.system}/${rom}`;
    if (tried.has(key) || attempted(g.system, rom)) continue;
    if (!maps.has(g.system)) maps.set(g.system, mapOf(dir, g.system));
    const map = maps.get(g.system);
    if (map && !(rom in map)) out.push({ system: g.system, key });
  }
  return out;
}

/**
 * The watcher for retro folder `dir`: onScan(state) is the catalog listener.
 * `start(system)` is retro-art-api.js startArtSync; `enabled()` reads the setting.
 */
export function autoArt({ dir, start, enabled, delayMs = AUTO_DELAY_MS, attempted = wasMatched }) {
  const tried = new Set();
  let latest = null;
  let timer = null;
  let running = null;

  function onScan(state) {
    if (state.dir !== dir) return;
    latest = state;
    if (running || !enabled() || !pendingArt(dir, state, tried, attempted).length) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      running = run().catch((err) => {
        debug.error("retro art: automatic fetch: %s", err.message);
        return false;
      }).then((again) => {
        running = null;
        // Scans that came in while this ran: what they found is looked at now.
        if (again) onScan(latest);
      });
    }, delayMs);
    timer.unref?.();
  }

  /** One run over what is pending now; true when it ended by itself (false: another job had the place). */
  async function run() {
    timer = null;
    if (!enabled()) return false;
    const pending = pendingArt(dir, latest, tried, attempted);
    for (const p of pending) tried.add(p.key);
    const systems = [...new Set(pending.map((p) => p.system))];
    if (systems.length) debug.log("retro art: %d new ROMs without box art, fetching for %s", pending.length, systems.join(", "));
    for (const [i, id] of systems.entries()) {
      const started = await start(id);
      if (started.error) {
        const left = new Set(systems.slice(i));
        for (const p of pending) if (left.has(p.system)) tried.delete(p.key);
        debug.log("retro art: automatic fetch skipped, another job is running");
        return false;
      }
      await started.done.catch((err) => debug.error("retro art: automatic fetch for %s: %s", id, err.message));
    }
    return true;
  }

  return { onScan, idle: () => running ?? Promise.resolve() };
}

const watching = new Set();

/** Registers the watcher for `opts.dir` on the catalog, once per folder. */
export function watchRetroArt(opts) {
  if (watching.has(opts.dir)) return;
  watching.add(opts.dir);
  retroCatalog.onScan(autoArt(opts).onScan);
}
