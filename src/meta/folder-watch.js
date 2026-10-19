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
 * Only the item folders and what sits right in them are watched, not the whole
 * tree: a ported game holds thousands of files, and watching each one walked the
 * whole folder on every start. A copy deep inside an item still writes, so before
 * an item is reported its folder is looked over once, and a file written within
 * the quiet time puts the report off again.
 *
 * With `deep`, every folder under the root is watched instead (one inotify watch
 * per folder, not per file: a few thousand folders cost megabytes, where chokidar
 * watching each file of the same tree cost hundreds), so a file replaced deep
 * inside an app is seen too.
 *
 * The watch is only a shortcut: the catalogs still rescan in full on their own
 * long schedule, for anything the watch missed (a mount that drops events).
 */
import fs from "fs";
import path from "path";
import fsp from "fs/promises";
import chokidar from "chokidar";
import debug from "../debug.js";

export const QUIET_MS = 30_000;
// An item is read again at most this often: a folder that keeps changing (a log, a big copy
// pausing now and then) is not read over and over.
export const COOLDOWN_MS = 2 * 60_000;

/** The item an event under `root` belongs to: its first `depth` path parts, or null. Pure. */
export function itemOf(root, file, depth) {
  const rel = path.relative(root, file);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  const parts = rel.split(path.sep);
  if (parts.length < depth) return null;
  return parts.slice(0, depth).join("/");
}

/** The newest mtime of any file under `dir` (ms), 0 when there is none or it is gone. */
export async function newestUnder(dir) {
  let newest = 0;
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) newest = Math.max(newest, await newestUnder(p));
    else if (e.isFile()) newest = Math.max(newest, (await fsp.stat(p).catch(() => null))?.mtimeMs ?? 0);
  }
  return newest;
}

/**
 * Watches every folder under `root` (dot names skipped), new ones as they appear,
 * and calls `onPath(path)` for what changed in any of them. Returns { close, ready }.
 */
function watchFolders(root, onPath, label) {
  const watchers = new Map();
  let closed = false;
  const add = async (dir) => {
    if (closed || watchers.has(dir)) return;
    let w;
    try {
      w = fs.watch(dir, { persistent: false }, (_event, name) => {
        if (!name || String(name).startsWith(".")) return;
        const p = path.join(dir, String(name));
        onPath(p);
        // A folder made or moved in: watch it and what is under it.
        fsp.stat(p).then((st) => { if (st.isDirectory()) return add(p); }).catch(() => {});
      });
    } catch {
      return;
    }
    w.on("error", () => { w.close(); watchers.delete(dir); });
    watchers.set(dir, w);
    let entries = [];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (dir === root) debug.error("%s: watch error: %s", label, err.message);
    }
    for (const e of entries) if (e.isDirectory() && !e.name.startsWith(".")) await add(path.join(dir, e.name));
  };
  const ready = add(root);
  return {
    ready,
    close: async () => {
      closed = true;
      await ready.catch(() => {});
      for (const w of watchers.values()) w.close();
      watchers.clear();
    },
  };
}

/**
 * Starts watching `root`. `depth` is how many path parts name an item (2 for
 * <title id>/<save>, 1 for <app>); `onItem(item)` is called after the quiet
 * time; `deep` watches every folder below the items too. Returns { close }.
 */
export function watchItems(root, { depth, deep = false, onItem, quietMs = QUIET_MS, cooldownMs = COOLDOWN_MS, label = "watch" }) {
  const timers = new Map();
  const lastRead = new Map(); // item → when it was last reported
  const arm = (item, ms) => {
    clearTimeout(timers.get(item));
    const t = setTimeout(fire, ms, item);
    t.unref?.();
    timers.set(item, t);
  };
  const fire = async (item) => {
    timers.delete(item);
    // Still being written somewhere below what the watch sees: look again once it has been quiet.
    const age = Date.now() - (await newestUnder(path.join(root, ...item.split("/"))));
    if (age < quietMs) {
      if (!timers.has(item)) arm(item, quietMs - age);
      return;
    }
    const wait = (lastRead.get(item) ?? -Infinity) + cooldownMs - Date.now();
    if (wait > 0) {
      if (!timers.has(item)) arm(item, wait);
      return;
    }
    lastRead.set(item, Date.now());
    Promise.resolve()
      .then(() => onItem(item))
      .catch((err) => debug.error("%s: %s failed: %s", label, item, err.message));
  };
  const touch = (file) => {
    const item = itemOf(root, file, depth);
    if (!item) return;
    arm(item, quietMs);
  };
  if (deep) {
    const folders = watchFolders(root, touch, label);
    folders.ready.then(() => debug.log("%s: watching %s for changes, every folder", label, root));
    return {
      async close() {
        for (const t of timers.values()) clearTimeout(t);
        timers.clear();
        await folders.close();
      },
      ready: folders.ready,
    };
  }
  const watcher = chokidar.watch(root, {
    // The server's own timers and sockets keep it running; the watch alone never should.
    persistent: false,
    ignoreInitial: true,
    // The item folders and the files right in them: `depth` levels below the root.
    depth,
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
