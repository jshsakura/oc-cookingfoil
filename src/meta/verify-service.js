/**
 * The server's own file check queue (verify-queue.js), wired to the games
 * folder, the index database, the download tracking of the safe restart
 * (security/drain.js), the library cache and the activity list.
 */
import path from "path";
import { createVerifyQueue } from "./verify-queue.js";
import { createVerifier } from "./file-verify.js";
import * as fileIntegrity from "./file-integrity.js";
import * as env from "../helpers/envs.js";
import * as shopCache from "./shop-cache.js";
import drainer from "../security/drain.js";
import * as activity from "../tasks/activity.js";
import { appDb } from "../db/database.js";
import { catalogStore } from "../db/stores.js";

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
  catalog: () => shopCache.files(),
  downloads: () => drainer.downloads(),
  // Games are served at their path under the games folder, on both download lanes.
  fileInUse: (rel) => drainer.pathInUse(`/${rel.split(path.sep).join("/")}`),
  // A notice appeared or went away: the shop list and the sections carry it.
  onVerdict: () => shopCache.invalidate(),
  track: (opts) => activity.begin("verify", opts),
});

fileIntegrity.provide((rel) => queue.integrityOf(rel));

let started = false;
/** Loads the records and looks at the library after each rebuild. */
export function start() {
  if (started) return;
  started = true;
  queue.init().catch(() => {});
  shopCache.onUpdate(() => queue.onLibraryUpdate());
  // The first rebuild may have happened before this subscribed.
  queue.onLibraryUpdate();
}

export default queue;
