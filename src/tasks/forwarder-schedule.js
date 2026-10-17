/**
 * HOME-menu shortcuts built ahead of time, once a day inside the admin's hours
 * (the same setting as the game-file check, env.verifyHours). A download still
 * builds its own shortcut at once; this only fills in the ones nobody asked
 * for yet and drops the ones no app or game uses any more.
 *
 * Each route that serves shortcuts adds a source: { dir, keysDir, apps() },
 * apps() giving what retro/forwarder.js needs per shortcut (with `icon`).
 * The pass shows in the activity list and can be stopped there.
 */
import * as env from "../helpers/envs.js";
import debug from "../debug.js";
import * as activity from "./activity.js";
import { msUntilHours } from "../meta/verify-queue.js";
import { forwardersAvailable, missingForwarders, prewarmForwarders } from "../retro/forwarder.js";

const HOUR_MS = 3_600_000;
// At most one pass a day: a window of several hours still runs it once.
const MIN_GAP_MS = 20 * HOUR_MS;
// Hours set to "off" (or unreadable): look again later, the setting may change.
const RECHECK_MS = 6 * HOUR_MS;
// The first look waits out the boot scans.
const BOOT_DELAY_MS = 10 * 60_000;

export function createForwarderSchedule({
  hours = () => env.verifyHours,
  now = Date.now,
  setTimer = (fn, ms) => setTimeout(fn, ms).unref?.(),
  track = activity.begin,
  bootDelayMs = BOOT_DELAY_MS,
} = {}) {
  const sources = new Map();
  let lastRun = 0;
  let started = false;
  let running = null;

  /** One pass over every source. Resolves to the shortcuts it made, or null when there was nothing to do. */
  async function runOnce() {
    const lists = [];
    for (const [name, src] of sources) {
      if (!forwardersAvailable(src.keysDir)) continue;
      try {
        const apps = await src.apps();
        lists.push({ name, src, apps, missing: missingForwarders(src.dir, apps).length });
      } catch (err) {
        debug.error("forwarders: %s list failed: %s", name, err.message);
      }
    }
    const total = lists.reduce((n, l) => n + l.missing, 0);
    if (!total) {
      // Nothing to build: still drop the shortcuts no one uses, without a trace in the activity list.
      for (const l of lists) await prewarmForwarders(l.src.dir, l.apps, l.src.keysDir).catch(() => null);
      return null;
    }
    const job = track("prewarm", { title: "홈 메뉴 바로가기를 미리 만듭니다", total });
    let done = 0, made = 0, failed = 0;
    try {
      for (const l of lists) {
        if (job.stopped) break;
        const r = await prewarmForwarders(l.src.dir, l.apps, l.src.keysDir, {
          stopped: () => job.stopped,
          onBuilt: () => job.step(++done),
        });
        made += r.made;
        failed += r.failed;
      }
    } catch (err) {
      job.fail(err);
      throw err;
    }
    job.done(`새로 ${made}개${failed ? ` · 실패 ${failed}개` : ""}`);
    return made;
  }

  function schedule(ms) {
    setTimer(tick, ms);
  }

  function tick() {
    const wait = msUntilHours(hours(), new Date(now()));
    if (!Number.isFinite(wait)) return schedule(RECHECK_MS);
    if (wait > 0) return schedule(wait);
    if (now() - lastRun < MIN_GAP_MS) return schedule(HOUR_MS);
    lastRun = now();
    running = runOnce()
      .catch((err) => debug.error("forwarders: nightly pass failed: %s", err.message))
      .finally(() => { running = null; schedule(HOUR_MS); });
  }

  return {
    /** Adds (or replaces) a source; the first one starts the schedule. */
    add(name, source) {
      sources.set(name, source);
      if (!started) {
        started = true;
        schedule(bootDelayMs);
      }
    },
    runOnce,
    tick,
    /** The pass in progress, for tests. */
    get running() { return running; },
  };
}

const shared = createForwarderSchedule();
export const addForwarderSource = shared.add;
