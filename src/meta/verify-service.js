/**
 * The server's own file check queue (verify-queue.js), wired to the games
 * folder, the index database, the download tracking of the safe restart
 * (security/drain.js), the library cache and the activity list.
 */
import path from "path";
import { createVerifyQueue, msUntilHours } from "./verify-queue.js";
import { createVerifier } from "./file-verify.js";
import * as fileIntegrity from "./file-integrity.js";
import { provideKnown } from "./file-identity.js";
import * as env from "../helpers/envs.js";
import * as libraryCache from "./library-cache.js";
import drainer from "../security/drain.js";
import * as activity from "../tasks/activity.js";
import { appDb } from "../db/database.js";
import { catalogStore } from "../db/stores.js";
import { alert } from "../helpers/alerts.js";

const TOLD_MAX = 10;

/** The admin's alert for files found damaged in one run: one line each, the first TOLD_MAX. */
export function tellDamaged(list) {
  alert("damaged", (t) => {
    const why = (f) => (f.reason === "truncated" && f.detail?.present != null
      ? t("damaged.truncated", { p: Math.round(f.detail.present * 100) })
      : t(`damaged.${f.reason}`));
    const lines = list.slice(0, TOLD_MAX).map((f) => `- ${path.basename(f.path)}: ${why(f)}`);
    if (list.length > TOLD_MAX) lines.push(t("andMore", { n: list.length - TOLD_MAX }));
    return t("damagedFound", { n: list.length, lines: lines.join("\n") });
  }, { subject: list.map((f) => f.path).sort().join("|") });
}

// Opened on first use, so importing this module does not open the database.
// The second catalog keeps records of files that went away, for a rename that brings them back.
function lazyStore(name) {
  let opened = null;
  const records = () => (opened ??= catalogStore(appDb(), name, { idOf: (v) => v.path }));
  return {
    load: () => records().load(),
    replace: (items, at) => records().replace(items, at),
    put: (item) => records().put(item),
    remove: (...ids) => records().remove(...ids),
  };
}

const queue = createVerifyQueue({
  gamesDir: env.romsDirPath,
  store: lazyStore("file-verdicts"),
  goneStore: lazyStore("file-verdicts-gone"),
  verifier: createVerifier(),
  catalog: () => libraryCache.files(),
  downloads: () => drainer.downloads(),
  // Games are served at their path under the games folder, on both download lanes.
  fileInUse: (rel) => drainer.pathInUse(`/${rel.split(path.sep).join("/")}`),
  // A notice appeared or went away: the library list and the sections carry it.
  onVerdict: () => libraryCache.invalidate({ background: true }),
  onDamaged: tellDamaged,
  track: (opts) => activity.begin("verify", opts),
  msUntilAllowed: () => msUntilHours(env.verifyHours),
});

fileIntegrity.provide((rel) => queue.findingOf(rel));
fileIntegrity.provideSigned((rel) => queue.signedOf(rel));
provideKnown((abs, st) => queue.identityOf(path.relative(env.romsDirPath, abs), st));

let started = false;
/** Loads the records and looks at the library after each rebuild. */
export function start() {
  if (started) return;
  started = true;
  queue.init().catch(() => {});
  libraryCache.onUpdate(() => queue.onLibraryUpdate());
  // The first rebuild may have happened before this subscribed.
  queue.onLibraryUpdate();
}

export default queue;
