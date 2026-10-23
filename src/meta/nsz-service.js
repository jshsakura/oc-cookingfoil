/**
 * The server's own NSZ conversion queue (nsz-queue.js), wired to the games
 * folder, the live settings, the download tracking of the safe restart
 * (security/drain.js), the library cache and the Telegram alerts.
 */
import path from "path";
import { createNszQueue } from "./nsz-queue.js";
import * as env from "../helpers/envs.js";
import * as shopCache from "./shop-cache.js";
import drainer from "../security/drain.js";
import { alert } from "../helpers/alerts.js";
import { activityText } from "./meta-messages.js";
import * as activity from "../tasks/activity.js";

/** The queue's settings as they are right now (envs.js live bindings). */
export const currentSettings = () => ({
  enabled: env.nszEnabled,
  autoQueue: env.nszAutoQueue,
  level: env.nszLevel,
  threads: env.nszThreads,
  workers: env.nszWorkers,
  minSizeMb: env.nszMinSizeMb,
  diskFloorGb: env.nszDiskFloorGb,
  keepHours: env.nszKeepHours,
  keepGb: env.nszKeepGb,
  block: env.nszBlock,
  xci: env.nszXci,
});

const queue = createNszQueue({
  gamesDir: env.romsDirPath,
  stateFile: path.join(env.dataDir, "nsz-queue.json"),
  logFile: path.join(env.dataDir, "nsz-log.jsonl"),
  logKeepMs: () => env.logKeepDays * 24 * 60 * 60 * 1000,
  settings: currentSettings,
  downloads: () => drainer.downloads(),
  // Games are served at their path under the games folder, on both download lanes.
  fileInUse: (rel) => drainer.pathInUse(`/${rel.split(path.sep).join("/")}`),
  catalog: () => shopCache.files(),
  onSwapped: (changes) => shopCache.noteFileChanges(changes),
  alert: (text, subject) => alert("nsz", text, { subject }),
  track: (item, probe) => {
    // The output leaves the work folder just before the run ends: keep the last size read, not 0.
    let last = 0;
    const steady = () => {
      const p = probe();
      last = p.current || last;
      return { ...p, current: last };
    };
    // Stopping one conversion from the activity menu pauses the queue, like the 변환 tab's pause:
    // the running files wait again and nothing starts until the admin starts it.
    const cancel = () => queue.pause().catch(() => {});
    return activity.begin("nsz", { title: activityText("act.nsz"), detail: item.name || path.basename(item.rel), probe: steady, cancel });
  },
});

let started = false;
/** Cleans the work folder, resumes a run left going, and queues new files after each library rebuild. */
export function start() {
  if (started) return;
  started = true;
  queue.init().catch(() => {});
  shopCache.onUpdate(() => queue.onLibraryUpdate());
}

export default queue;
