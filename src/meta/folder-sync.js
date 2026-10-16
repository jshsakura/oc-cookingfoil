/**
 * Every library folder read again in full: games, hand-placed homebrew, saves,
 * patches and retro. The folder watches catch a change as it lands; this is
 * the backstop for anything they miss (a mount that drops events, a copy made
 * while the server was off), run every `syncHours` hours or from the admin page.
 *
 * The folders are read one after another, never at once: they share disks that
 * other jobs keep busy, and parallel scans there are slower than one by one.
 * A sync asked for while one runs joins it.
 */
import debug from "../debug.js";
import * as env from "../helpers/envs.js";
import * as shopCache from "./shop-cache.js";
import * as userPatches from "./user-patches.js";
import * as retroCatalog from "../retro/catalog.js";
import { refreshManual } from "../routes/homebrew.js";
import { savesCatalog } from "../routes/saves.js";

// How often the schedule looks whether a sync is due (the setting can change any time).
const CHECK_MS = 5 * 60_000;

/** What one sync reads, in order. Each part resolves once its folder is read. */
const PARTS = [
  // The game library rebuilds behind its own debounce; it is only asked to read every file again.
  ["games", async () => shopCache.invalidate({ rescan: true })],
  ["homebrew", () => refreshManual()],
  ["saves", async () => {
    const saves = savesCatalog();
    saves.invalidate();
    await saves.list();
  }],
  ["patches", () => userPatches.scan({ onChange: () => shopCache.invalidate() })],
  ["retro", () => retroCatalog.rescan(env.retroDir)],
];

let running = null;
let last = null; // { at, ms, parts: [{ name, ms, error? }] }

async function run(reason) {
  const started = Date.now();
  const parts = [];
  debug.log("sync: reading every folder again (%s)", reason);
  for (const [name, read] of PARTS) {
    const t = Date.now();
    try {
      await read();
      parts.push({ name, ms: Date.now() - t });
    } catch (err) {
      debug.error("sync: %s failed: %s", name, err.message);
      parts.push({ name, ms: Date.now() - t, error: err.message });
    }
  }
  last = { at: Date.now(), ms: Date.now() - started, parts };
  debug.log("sync: done in %d ms", last.ms);
  return last;
}

/** Reads every folder again now; asked while a sync runs, it waits for that one. */
export function syncNow(reason = "requested") {
  running ??= run(reason).finally(() => { running = null; });
  return running;
}

/** What the admin page shows. */
export function status() {
  const next = env.syncHours > 0 && last ? last.at + env.syncHours * 3_600_000 : null;
  return { hours: env.syncHours, running: Boolean(running), last, next };
}

let timer = null;
let startedAt = null;
/** Starts the schedule: the first sync `syncHours` after the start (the start reads every folder already). */
export function start() {
  if (timer) return;
  startedAt = Date.now();
  timer = setInterval(() => {
    if (env.syncHours <= 0 || running) return;
    const since = last?.at ?? startedAt;
    if (Date.now() - since >= env.syncHours * 3_600_000) syncNow("schedule").catch(() => {});
  }, CHECK_MS);
  timer.unref?.();
}
