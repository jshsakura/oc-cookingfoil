/**
 * Every library folder read again in full: games, hand-placed homebrew, saves,
 * patches, retro and the game folders the admin keeps (metadata/games). The folder watches catch a change as it lands; this is
 * the backstop for anything they miss (a mount that drops events, a copy made
 * while the server was off), run every `syncHours` hours or from the admin page.
 *
 * The folders are read one after another, never at once: they share disks that
 * other jobs keep busy, and parallel scans there are slower than one by one.
 * A sync asked for while one runs joins it.
 */
import debug from "../debug.js";
import * as env from "../helpers/envs.js";
import * as libraryCache from "./library-cache.js";
import * as userPatches from "./user-patches.js";
import * as gameMeta from "./game-meta.js";
import * as retroCatalog from "../retro/catalog.js";
import { refreshManual } from "../routes/homebrew.js";
import { savesCatalog } from "../routes/saves.js";
import * as activity from "../tasks/activity.js";
import { activityText } from "./meta-messages.js";

// How often the schedule looks whether a sync is due (the setting can change any time).
const CHECK_MS = 5 * 60_000;

/** What one sync reads, in order. Each part resolves once its folder is read. */
const PARTS = [
  // The game library rebuilds behind its own debounce; it is only asked to read every file again.
  ["games", async () => libraryCache.invalidate({ rescan: true })],
  ["homebrew", () => refreshManual()],
  ["saves", async () => {
    const saves = savesCatalog();
    saves.invalidate();
    await saves.list();
  }],
  // Patches are read every minute and retro on its own changes: only this full read shows up as a job.
  ["patches", () => activity.track("scan:patches", { title: activityText("act.scanPatches") }, () => userPatches.scan({ onChange: () => libraryCache.invalidate() }))],
  ["retro", () => activity.track("scan:retro", { title: activityText("act.scanRetro") }, () => retroCatalog.rescan(env.retroDir))],
  // The game folders are read again one by one as the watch sees them change; this reads every one in full.
  ["gameMeta", () => activity.track("scan:game-meta", { title: activityText("act.scanGameMeta") }, () => gameMeta.scan({ force: true }))],
];

const PART_KEYS = { games: "act.partGames", homebrew: "act.partHomebrew", saves: "act.partSaves", patches: "act.partPatches", retro: "act.partRetro", gameMeta: "act.partGameMeta" };
const partTitle = (name) => activityText(PART_KEYS[name]);

let running = null;
let last = null; // { at, ms, parts: [{ name, ms, error? }] }

async function run(reason) {
  const started = Date.now();
  const parts = [];
  debug.log("sync: reading every folder again (%s)", reason);
  const job = activity.begin("sync", { title: activityText("act.sync"), total: PARTS.length });
  for (const [name, read] of PARTS) {
    if (job.stopped) break;
    job.step(parts.length, partTitle(name));
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
  const failed = parts.filter((p) => p.error);
  if (failed.length) job.fail(failed.map((p) => `${partTitle(p.name)}: ${p.error}`).join(", "));
  else job.done(activityText("act.places", { n: parts.length }));
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
