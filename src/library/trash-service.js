/**
 * The shared trash (trash.js) and the operations journal (journal.js) over the
 * server's own library folders. The admin API (routes/admin/trash-api.js) and
 * the tools (capabilities/trash.js: trash_list, trash_restore, trash_journal,
 * trash_undo, trash_release; emptying is never a tool) call these and nothing
 * else, so every way in behaves the same:
 *
 *   list()                 every entry, with totals per folder
 *   trash(key, items, meta)  move into the trash (what every delete does now)
 *   restore(ids, by, opts) put entries back, never over a file
 *   empty(ids | { all, version, listedAt }, by)  the only permanent delete; a person on the admin page only
 *   journal(), undo(id, by), release(id, by)
 *   tidy()                 at start: what a stop left behind is cleaned up
 *
 * After a restore, an empty or an undo the folder it touched is read again.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import * as env from "../helpers/envs.js";
import debug from "../debug.js";
import * as trashStore from "./trash.js";
import * as journalStore from "./journal.js";
import { homebrewExtrasOf, putHomebrewExtras, putMarks } from "./trash-marks.js";
import { sweepPartials } from "./safe-move.js";

export const ROOT_KEYS = Object.freeze(["games", "incoming", "patches", "saves", "homebrew", "retro"]);
const DAY_MS = 24 * 60 * 60 * 1000;

/** The library folders as { key, dir }, each folder once (the first key that names it). */
export function libraryRoots() {
  const dirs = { games: env.romsDirPath, incoming: env.incomingDir, patches: env.patchesDir, saves: env.savesDir, homebrew: env.homebrewDir, retro: env.retroDir };
  const seen = new Set();
  const out = [];
  for (const key of ROOT_KEYS) {
    const dir = dirs[key] ? path.resolve(dirs[key]) : null;
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    out.push({ key, dir });
  }
  return out;
}

export const rootOf = (key) => libraryRoots().find((r) => r.key === key) ?? null;

/** The library folder a path is in (the deepest one), with the path relative to it, or null. */
export function locate(abs) {
  const target = path.resolve(abs);
  let best = null;
  for (const r of libraryRoots()) {
    const rel = path.relative(r.dir, target);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) continue;
    if (!best || r.dir.length > best.root.dir.length) best = { root: r, rel: rel.split(path.sep).join("/") };
  }
  return best;
}

/** Who asked, as the trash and the journal record it. */
export function actorOf(req) {
  if (req?.apiToken) return { type: "token", name: req.apiToken.label || req.apiToken.id, id: req.apiToken.id };
  const name = req?.webUser?.kind === "google" ? `google:${req.webUser.email ?? req.webUser.sub}` : req?.webUser?.name ?? req?.auth?.user ?? "admin";
  return { type: "admin", name };
}
export const job = (name) => ({ type: "job", name });

// ── reading the folders again ────────────────────────────────────────
// Imported when first needed: the routes these live in import this module.
const REFRESH = {
  games: async () => (await import("../meta/shop-cache.js")).invalidate({ rescan: true }),
  incoming: async () => {},
  patches: async () => (await import("../meta/user-patches.js")).scan(),
  saves: async () => (await import("../routes/saves.js")).savesCatalog().invalidate(),
  homebrew: async () => (await import("../routes/homebrew.js")).refreshManual(),
  retro: async () => (await import("../retro/catalog.js")).rescan(env.retroDir),
};
let refresher = (key) => REFRESH[key]?.();
/** Test-only: what runs after a folder changed (null puts the real one back). */
export function _setRefresh(fn) {
  refresher = fn ?? ((key) => REFRESH[key]?.());
}
function refresh(keys) {
  for (const key of new Set(keys)) {
    Promise.resolve().then(() => refresher(key)).catch((err) => debug.error("trash: %s not read again: %s", key, err.message));
  }
}

// ── the trash ────────────────────────────────────────────────────────
/** Moves items of library folder `key` into its trash (trash.js trashItems). */
export async function trash(key, items, meta = {}) {
  const root = rootOf(key);
  if (!root) throw trashStore.trashError("noRoot", 404);
  const out = await trashStore.trashItems(root, items, meta);
  debug.log("trash: %s %s → %s (%s, %s)", key, out.files.join(", "), out.entries.map((e) => e.entry).join(", "), meta.action ?? "-", meta.by?.name ?? "-");
  return out;
}

/**
 * A short digest of which entries are in the trash. The page sends back the one
 * it showed when it empties everything, and the server refuses when the trash
 * changed since (an entry the person never saw would be deleted with it). Pure.
 */
export const versionOf = (ids) => crypto.createHash("sha256").update([...ids].sort().join("\n")).digest("hex").slice(0, 16);

/**
 * The entries a list made at `listedAt` showed: the ones moved into the trash
 * by then. Entries are never changed once made, so one that came in later is
 * new, not a change to what was seen. Pure.
 */
const seenBy = (items, listedAt) => items.filter((e) => (e.trashedAt ?? 0) <= listedAt);

/**
 * Every entry newest first, each with its age, and the totals:
 * { items, total, roots, noticeDays, old, version, unavailable: [{ root, home }] }.
 */
export async function list({ now = Date.now() } = {}) {
  const roots = libraryRoots();
  const items = (await trashStore.listAll(roots)).map((e) => ({ ...e, ageDays: Math.floor((now - (e.trashedAt ?? now)) / DAY_MS) }));
  // Taken once the folders are read: everything listed was moved in by then.
  const listedAt = Date.now();
  const totals = Object.fromEntries(roots.map((r) => [r.key, { bytes: 0, count: 0 }]));
  for (const e of items) {
    totals[e.root].bytes += e.size;
    totals[e.root].count++;
  }
  const noticeDays = env.trashNoticeDays;
  const old = items.filter((e) => e.ageDays >= noticeDays);
  return {
    items,
    total: { bytes: items.reduce((n, e) => n + e.size, 0), count: items.length },
    roots: totals,
    noticeDays,
    old: { count: old.length, bytes: old.reduce((n, e) => n + e.size, 0) },
    // Emptying everything sends both back: it empties what this list showed, and an entry that came in after it is left.
    version: versionOf(seenBy(items, listedAt).map((e) => e.id)),
    listedAt,
    // A disk that is not mounted: its entries are not lost, only not listed until it is back.
    unavailable: roots.flatMap((r) => trashStore.unavailableHomes(r).map((home) => ({ root: r.key, home }))),
  };
}

/** Bytes the trash of one folder holds (what emptying it would free there). */
export async function bytesOf(key) {
  const root = rootOf(key);
  return root ? (await trashStore.listRoot(root)).reduce((n, e) => n + e.size, 0) : 0;
}

/**
 * Bytes the trash holds on the filesystem `dir` is on: every library folder's
 * entries whose folder is on that disk (emptying them frees space there). An
 * entry on another disk mounted below does not count.
 */
const realDev = (p) => fs.statSync(p, { throwIfNoEntry: false })?.dev;
export async function bytesOnDisk(dir, roots = libraryRoots(), devOf = realDev) {
  const dev = devOf(path.resolve(dir));
  if (dev === undefined) return 0;
  let bytes = 0;
  for (const r of roots) {
    for (const e of await trashStore.listRoot(r)) {
      if (devOf(path.resolve(r.dir, ...e.home.split("/"), ...e.entry.split("/"))) === dev) bytes += e.size;
    }
  }
  return bytes;
}

const parse = (id) => {
  const a = trashStore.parseAddress(id);
  const root = a ? rootOf(a.rootKey) : null;
  if (!root) throw trashStore.trashError("badEntry", 404);
  return { ...a, root };
};

// What a restore puts back besides the files, by kind. Runs before the entry folder goes (its .attached is still there).
const AFTER_RESTORE = {
  // A patch's information was taken out of the patch store with it: back under the folder it now has.
  patch: async (r) => {
    const to = r.items[0]?.to;
    if (!to) return;
    const stash = r.manifest?.patchInfo;
    if (stash?.info) {
      const patchInfo = await import("../meta/patch-info.js");
      // "<title id>/<folder>" or "homebrew/<app>/<folder>", as the patch store keys it.
      const key = patchInfo.keyOf(path.posix.dirname(to), path.posix.basename(to));
      if (key && !patchInfo.has(key)) patchInfo.set(key, stash.info);
    }
    if (r.manifest?.marks) putMarks(r.manifest.marks, (await import("../meta/user-patches.js")).patchIdAt(to));
  },
  save: async (r) => {
    const to = r.items[0]?.to;
    if (to && r.manifest?.marks) putMarks(r.manifest.marks, (await import("../meta/shop-saves.js")).saveIdAt(to));
  },
  // A hand-placed app's pictures, description, choices and marks, under the id its folder now gives it.
  homebrew: async (r, base) => {
    const extras = r.manifest?.homebrewExtras;
    const to = r.items[0]?.to;
    if (!extras || !to || to.includes("/")) return;
    const { idFor } = await import("../meta/homebrew.js");
    const media = r.manifest.attached?.includes("media") ? path.join(base, trashStore.ATTACHED_DIR, "media") : null;
    await putHomebrewExtras(extras, idFor("manual", to), media);
  },
};

/**
 * Puts entries back. `exactName` refuses an entry whose place is taken (it stays
 * in the trash) instead of numbering it. Returns { restored: [{ id, name, items,
 * renamed }], failed: [{ id, error }] }.
 */
export async function restore(ids, by = null, { exactName = false, lang = "ko" } = {}) {
  const restored = [];
  const failed = [];
  for (const id of ids) {
    try {
      const { root, home, entry } = parse(id);
      const after = (r, base) => AFTER_RESTORE[r.kind]?.(r, base)?.catch?.((err) => debug.error("trash: after restoring %s: %s", id, err.message));
      const { manifest: _m, ...r } = await trashStore.restoreEntry(root, home, entry, { exactName, after });
      restored.push(r);
      debug.log("trash: %s restored by %s%s", id, by?.name ?? "-", r.renamed.length ? ` (${r.renamed.map((x) => `${x.rel} → ${x.to}`).join(", ")})` : "");
    } catch (err) {
      if (!(err instanceof trashStore.TrashError)) throw err;
      failed.push({ id, error: err.textIn(lang) });
    }
  }
  refresh(restored.map((r) => r.root));
  return { restored, failed };
}

/**
 * Deletes entries for good: a list of ids, or { all: true, version, listedAt }
 * for every entry the person saw (both from list()). Entries moved in after
 * `listedAt` are left alone, not a conflict; it is refused only when what the
 * person saw changed (an entry restored or emptied meanwhile, or one older
 * than the list that it did not show). Without `listedAt` every entry counts
 * as seen. Every id is checked before anything is deleted. Returns { removed,
 * bytes }. Only a person on the admin page may.
 */
export async function empty(target, by = null) {
  let ids;
  if (Array.isArray(target)) ids = target;
  else if (target?.all === true) {
    const at = target.listedAt ?? Number.POSITIVE_INFINITY;
    if (typeof at !== "number" || Number.isNaN(at)) throw trashStore.trashError("badListedAt", 400);
    const seen = seenBy(await trashStore.listAll(libraryRoots()), at).map((e) => e.id);
    if (typeof target.version !== "string" || target.version !== versionOf(seen)) {
      throw trashStore.trashError("changedSince", 409);
    }
    ids = seen;
  } else throw trashStore.trashError("pickEmpty", 400);
  const targets = ids.map(parse);
  for (const t of targets) {
    if (!(await trashStore.hasEntry(t.root, t.home, t.entry))) throw trashStore.trashError("missingSome", 404);
  }
  let removed = 0;
  let bytes = 0;
  for (const { root, home, entry } of targets) {
    bytes += await trashStore.emptyEntry(root, home, entry);
    removed++;
  }
  debug.log("trash: %d entries (%d bytes) deleted for good by %s", removed, bytes, by?.name ?? "-");
  return { removed, bytes };
}

/**
 * Keeps a hand-placed homebrew app's extras with its trash entry (`out` from
 * trash()), so a restore brings them back. Throws when they could not be kept:
 * the caller then leaves them where they are instead of forgetting them.
 */
export async function keepHomebrewExtras(out, appId) {
  const root = rootOf("homebrew");
  const at = out.entries[0];
  const { fields, mediaDir } = await homebrewExtrasOf(appId);
  await trashStore.attach(root, at.home, at.entry, { name: mediaDir ? "media" : null, fromDir: mediaDir, fields: { homebrewExtras: fields } });
}

// ── the journal ──────────────────────────────────────────────────────
/** Notes a move between (or inside) library folders; absolute paths. Never throws. */
export async function recordMove({ action, by, from, to, extra = {} }) {
  const a = locate(from);
  const b = locate(to);
  if (!a || !b) return null;
  return journalStore.recordMove({ action, by, fromRoot: a.root, from: a.rel, toRoot: b.root, to: b.rel, extra });
}

// What an undo changes back besides the place, by the move's `rewrite`.
const UNDO_REWRITE = {
  // A patch moved to another game had the paths that name the game renamed, and its store entry moved.
  "patch-title": async (op, abs) => {
    const { rewritePatchPaths } = await import("../routes/admin/content-api.js");
    const patchInfo = await import("../meta/patch-info.js");
    const { from, to, folder } = op.rewrite;
    await rewritePatchPaths(abs, to, from);
    const back = path.basename(abs);
    if (patchInfo.has(patchInfo.keyOf(to, folder))) patchInfo.move(patchInfo.keyOf(to, folder), patchInfo.keyOf(from, back));
  },
};

export const journal = (opts) => journalStore.listJournal(libraryRoots(), opts);

// The marks a move dropped (a patch's or save's votes), back on the id the item has where it returns.
const MARK_ID = {
  patch: async (rel) => (await import("../meta/user-patches.js")).patchIdAt(rel),
  save: async (rel) => (await import("../meta/shop-saves.js")).saveIdAt(rel),
};

export async function undo(id, by = null, { lang = "ko" } = {}) {
  const after = async (op, abs) => {
    await UNDO_REWRITE[op.rewrite?.type]?.(op, abs);
    if (op.marks) putMarks(op.marks, await MARK_ID[op.marks.kind]?.(op.from));
  };
  const out = await journalStore.undoMove(libraryRoots(), id, { by, after, lang });
  debug.log("journal: %s undone by %s: %s/%s → %s/%s", out.id, by?.name ?? "-", out.toRoot, out.to, out.fromRoot, out.from);
  if (out.warning) debug.error("journal: %s: %s", out.id, out.warning);
  refresh([out.fromRoot, out.toRoot]);
  return out;
}

/** Lets the drop box sort a file it put back by an undo again. */
export async function release(id, by = null) {
  const out = await journalStore.releaseUndone(libraryRoots(), id, { by });
  debug.log("journal: %s released by %s", out.id, by?.name ?? "-");
  return out;
}

/** The files undone back into the drop box that it must leave where they are: [{ id, rel, size, mtimeMs }]. */
export const undoneInDropBox = () => journalStore.undoneHeld(libraryRoots(), "incoming");

/** At start: retro's old .trash entries move into the shared trash folder (a rename in place). */
export async function migrate() {
  const retro = rootOf("retro");
  if (!retro) return 0;
  const n = await trashStore.migrateLegacy(retro);
  if (n) debug.log("trash: %d retro trash entries moved from %s to %s", n, trashStore.LEGACY_TRASH, trashStore.TRASH_DIR);
  return n;
}

/**
 * At start, before anything else moves: retro's old trash is migrated, partial
 * copies a stop left in any library folder are removed (safe-move.js
 * sweepPartials), and a file a stopped restore left both in the library and in
 * the trash keeps only its library name (trash.js dropTwins). Never throws.
 */
export async function tidy() {
  const out = { migrated: 0, partials: 0, left: 0, twins: 0 };
  const before = Date.now();
  out.migrated = await migrate().catch((err) => { debug.error("trash: retro trash not moved: %s", err.message); return 0; });
  for (const r of libraryRoots()) {
    const swept = await sweepPartials([r.dir], { recursive: true, before }).catch((err) => { debug.error("trash: partials in %s not swept: %s", r.key, err.message); return { removed: 0, left: [] }; });
    out.partials += swept.removed;
    out.left += swept.left.length;
    out.twins += await trashStore.dropTwins(r).catch((err) => { debug.error("trash: %s not checked for twins: %s", r.key, err.message); return 0; });
  }
  if (out.partials || out.left || out.twins) debug.log("trash: at start %d partial copies removed, %d kept, %d files left in both library and trash dropped from the trash", out.partials, out.left, out.twins);
  return out;
}

export const { TrashError, TRASH_DIR, trashError } = trashStore;
