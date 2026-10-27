/**
 * Box art for ROMs put in the retro folders by hand: after a scan, the games
 * without box art whose ROM is not in its system's art map start the same job
 * as the admin's "fetch all missing" button (retroAutoArt, on by default).
 *
 * A ROM is looked up once, and that is remembered across restarts in `file`
 * (the data dir's retro-auto-art.json): { "<system>/<ROM>": { at, sig } }, hit
 * or miss, with `sig` the ROM file's size and mtime. It is looked up again only
 * when its file changed or RETRY_MS went by; a miss before that is the admin's
 * (the button still tries everything). ROMs no longer in the catalog are dropped
 * from the file when it is next written. A system whose lookup failed (GitHub
 * unreachable) is not written, so a restart tries it again; in this process the
 * ROMs this watcher started a job for, and the ones any job already looked up
 * (sync.js wasMatched), are not pending, so a job's own rescan starts nothing.
 * A ROM mapped to null (no art) is in the map and never pending.
 *
 * A burst of scans starts one run, `delayMs` after the last scan that found
 * something. A run is one job over every system with pending ROMs, so only
 * those systems' names and bezel lists are read from GitHub and the activity
 * list shows one entry. When another job is running (start answers with an
 * error) the run gives those ROMs back: that job's rescan when it ends looks at
 * them again. ROM files are only read by the scan.
 */
import debug from "../../debug.js";
import * as retroCatalog from "../catalog.js";
import { jsonFile } from "../../helpers/json-file.js";
import { readMap, wasMatched } from "./sync.js";

export const AUTO_DELAY_MS = 30_000;
export const RETRY_MS = 30 * 24 * 60 * 60 * 1000;
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

/** What tells a ROM file changed since it was looked up. */
const sigOf = (g) => `${g.size}:${Math.round(g.mtimeMs)}`;

/** Games in `state` that have no box art, no map entry and are not `skip(key, game, rom)`: [{ system, key, sig }]. */
export function pendingArt(dir, state, skip) {
  const maps = new Map();
  const out = [];
  for (const g of state.games) {
    const system = state.systems[g.system];
    if (g.icon || !system?.libretro || HAND_MAPPED.has(g.system)) continue;
    const rom = retroCatalog.romKey(g);
    const key = `${g.system}/${rom}`;
    if (skip(key, g, rom)) continue;
    if (!maps.has(g.system)) maps.set(g.system, mapOf(dir, g.system));
    const map = maps.get(g.system);
    if (map && !(rom in map)) out.push({ system: g.system, key, sig: sigOf(g) });
  }
  return out;
}

/**
 * The watcher for retro folder `dir`: onScan(state) is the catalog listener.
 * `start(systems)` is retro-art-api.js startArtSync; `enabled()` reads the setting;
 * `file` keeps what was looked up.
 */
export function autoArt({ dir, file, start, enabled, delayMs = AUTO_DELAY_MS, attempted = wasMatched, now = Date.now, retryMs = RETRY_MS }) {
  const looked = jsonFile(file, { label: "retro auto art", indent: 0 });
  const tried = new Set();
  let latest = null;
  let timer = null;
  let running = null;

  /** skip() for pendingArt over the file as it is now. */
  function skipper() {
    const seen = looked.read();
    const t = now();
    return (key, g, rom) => {
      if (tried.has(key) || attempted(g.system, rom)) return true;
      const e = seen[key];
      return Boolean(e) && e.sig === sigOf(g) && t - e.at < retryMs;
    };
  }

  /** Writes the lookups of `pending` that ended (not a system's failure), dropping ROMs gone from the catalog. */
  function remember(pending, summary) {
    const t = now();
    const here = new Set(latest.games.map((g) => `${g.system}/${retroCatalog.romKey(g)}`));
    const next = Object.fromEntries(Object.entries(looked.read()).filter(([key]) => here.has(key)));
    for (const p of pending) if (!summary?.[p.system]?.error) next[p.key] = { at: t, sig: p.sig };
    looked.write(next);
  }

  function onScan(state) {
    if (state.dir !== dir) return;
    latest = state;
    if (running || !enabled() || !pendingArt(dir, state, skipper()).length) return;
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
    const pending = pendingArt(dir, latest, skipper());
    if (!pending.length) return true;
    for (const p of pending) tried.add(p.key);
    const systems = [...new Set(pending.map((p) => p.system))];
    debug.log("retro art: %d new ROMs without box art, fetching for %s", pending.length, systems.join(", "));
    const started = await start(systems);
    if (started.error) {
      for (const p of pending) tried.delete(p.key);
      debug.log("retro art: automatic fetch skipped, another job is running");
      return false;
    }
    const summary = await started.done.catch((err) => {
      debug.error("retro art: automatic fetch for %s: %s", systems.join(", "), err.message);
      return null;
    });
    if (summary) remember(pending, summary);
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
