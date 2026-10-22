/**
 * Runs the pack's own upkeep after every catalog scan (pack-auto.js):
 *
 *   - ROMs for a console whose core is not in the pack: add that core
 *   - once per process, when the ledger holds files from an older lock version
 *     (the server was updated): replace the server's own untouched files
 *   - note which consoles now play with another core than their HOME menu
 *     shortcuts were built for (shortcut-stale.js)
 *
 * What it did last is in `status()` for the admin's cores tab. It never
 * throws into the scan, and a run waits for the one before it.
 */
import path from "path";
import debug from "../debug.js";
import * as env from "../helpers/envs.js";
import { packLedger } from "../db/security-stores.js";
import * as catalog from "./catalog.js";
import { autoAddCores, autoUpdate } from "./pack-auto.js";
import { ledgerRoot } from "./pack-fill.js";
import { packDirOf } from "./pack-status.js";
import { createStaleStore } from "./shortcut-stale.js";

const DEBOUNCE_MS = 10_000;

let staleStore = null;
export const shortcutStale = () => (staleStore ??= createStaleStore(path.join(env.dataDir, "retro-shortcut-cores.json")));

/** { <system id>: <core its games start with> } for the consoles that have games. Pure. */
export function coresInUse(games) {
  const out = {};
  for (const g of games) if (g.core && !(g.system in out)) out[g.system] = g.core;
  return out;
}

const settings = () => ({ auto: env.retroPackAuto, download: env.retroPackAutoDownload });

let last = { add: null, update: null, at: null };
let updateChecked = false;
let chain = Promise.resolve();

export const status = () => ({ ...last, settings: settings() });

/** One pass over `games` now. `force` repeats the update check. */
export function check(games, systems, { force = false, ledger = () => packLedger(), run = { autoAddCores, autoUpdate } } = {}) {
  chain = chain.then(async () => {
    try {
      const packDir = packDirOf(env.retroDir);
      const store = ledger().forRoot(await ledgerRoot(packDir));
      const base = { packDir, dataDir: env.dataDir, ledger: store, games, systems, settings: settings(), url: env.retroPackUrl };
      const add = await run.autoAddCores(base);
      let update = last.update;
      if (force || !updateChecked) {
        updateChecked = true;
        update = await run.autoUpdate(base);
      }
      last = { add, update, at: Date.now() };
      if (add.state === "installed") debug.log("retro: added cores %s from the cached bundle", add.cores.join(", "));
      if (add.state === "failed" || update?.state === "failed") debug.error("retro: pack upkeep failed: %s", add.error ?? update.error);
    } catch (err) {
      debug.error("retro: pack upkeep: %s", err.message);
    }
    return last;
  });
  return chain;
}

let timer = null;

/** Hooks the upkeep to the catalog's scans. Call once. */
export function startPackWatch() {
  catalog.onScan((state) => {
    try {
      shortcutStale().observe(coresInUse(state.games));
    } catch (err) {
      debug.error("retro: shortcut cores: %s", err.message);
    }
    clearTimeout(timer);
    timer = setTimeout(() => check(state.games, state.systems), DEBOUNCE_MS);
    timer.unref?.();
  });
}
