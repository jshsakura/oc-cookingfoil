/**
 * Watches a folder of item folders (a save per <title id>/<name>/, an app per
 * <app>/) and says which item changed once it has been quiet for a while, so
 * the caller reads that one item again instead of the whole tree.
 *
 * Every add, change or removal under an item restarts its own quiet timer; the
 * item is reported QUIET_MS after its last event, so a copy that is still
 * writing (events keep coming) is never read half done. A copy that pauses
 * longer than that is read early and read again when it goes on. Names that
 * start with a dot are ignored (work folders, editor files).
 *
 * The watch is only a shortcut: the catalogs still rescan in full on their own
 * long schedule, for anything the watch missed (a mount that drops events).
 */
import path from "path";
import chokidar from "chokidar";
import debug from "../debug.js";

export const QUIET_MS = 30_000;

/** The item an event under `root` belongs to: its first `depth` path parts, or null. Pure. */
export function itemOf(root, file, depth) {
  const rel = path.relative(root, file);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  const parts = rel.split(path.sep);
  if (parts.length < depth) return null;
  return parts.slice(0, depth).join("/");
}

/**
 * Starts watching `root`. `depth` is how many path parts name an item (2 for
 * <title id>/<save>, 1 for <app>); `onItem(item)` is called after the quiet
 * time. Returns { close }.
 */
export function watchItems(root, { depth, onItem, quietMs = QUIET_MS, label = "watch" }) {
  const timers = new Map();
  const fire = (item) => {
    timers.delete(item);
    Promise.resolve()
      .then(() => onItem(item))
      .catch((err) => debug.error("%s: %s failed: %s", label, item, err.message));
  };
  const touch = (file) => {
    const item = itemOf(root, file, depth);
    if (!item) return;
    clearTimeout(timers.get(item));
    const t = setTimeout(fire, quietMs, item);
    t.unref?.();
    timers.set(item, t);
  };
  const watcher = chokidar.watch(root, {
    // The server's own timers and sockets keep it running; the watch alone never should.
    persistent: false,
    ignoreInitial: true,
    ignored: (p) => path.basename(p).startsWith("."),
  });
  watcher
    .on("all", (_event, p) => touch(p))
    .on("error", (err) => debug.error("%s: watch error: %s", label, err.message));
  watcher.once("ready", () => debug.log("%s: watching %s for changes", label, root));
  return {
    async close() {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      await watcher.close();
    },
    /** Resolves once the watch is set up (tests wait for it). */
    ready: new Promise((resolve) => watcher.once("ready", resolve)),
  };
}
