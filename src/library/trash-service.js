/**
 * The shared trash (trash.js) and the operations journal (journal.js) over the
 * server's own library folders. The admin API (routes/admin/trash-api.js) and,
 * later, the MCP tools (trash_list, trash_restore, trash_empty) call these and
 * nothing else, so every way in behaves the same:
 *
 *   list()                 every entry, with totals per folder
 *   trash(key, items, meta)  move into the trash (what every delete does now)
 *   restore(ids, by)       put entries back, never over a file
 *   empty(ids | "all", by) the only permanent delete; a person on the admin page only
 *   journal(), undo(id, by)
 *
 * After a restore, an empty or an undo the folder it touched is read again.
 */
import path from "path";
import * as env from "../helpers/envs.js";
import debug from "../debug.js";
import * as trashStore from "./trash.js";
import * as journalStore from "./journal.js";

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
  if (!root) throw new trashStore.TrashError("그 폴더가 없습니다", 404);
  const out = await trashStore.trashItems(root, items, meta);
  debug.log("trash: %s %s → %s (%s, %s)", key, out.files.join(", "), out.entries.map((e) => e.entry).join(", "), meta.action ?? "-", meta.by?.name ?? "-");
  return out;
}

/** Every entry newest first, each with its age, and the totals: { items, total, roots, noticeDays, old }. */
export async function list({ now = Date.now() } = {}) {
  const roots = libraryRoots();
  const items = (await trashStore.listAll(roots)).map((e) => ({ ...e, ageDays: Math.floor((now - (e.trashedAt ?? now)) / DAY_MS) }));
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
  };
}

/** Bytes the trash of one folder holds (what emptying it would free there). */
export async function bytesOf(key) {
  const root = rootOf(key);
  return root ? (await trashStore.listRoot(root)).reduce((n, e) => n + e.size, 0) : 0;
}

const parse = (id) => {
  const a = trashStore.parseAddress(id);
  const root = a ? rootOf(a.rootKey) : null;
  if (!root) throw new trashStore.TrashError("휴지통 항목이 맞지 않습니다", 404);
  return { ...a, root };
};

// What a restore puts back besides the files, by kind.
const AFTER_RESTORE = {
  // A patch's information was taken out of the patch store with it: back under the folder it now has.
  patch: async (r) => {
    const stash = r.manifest?.patchInfo;
    const to = r.items[0]?.to;
    if (!stash?.info || !to) return;
    const patchInfo = await import("../meta/patch-info.js");
    // "<title id>/<folder>" or "homebrew/<app>/<folder>", as the patch store keys it.
    const key = patchInfo.keyOf(path.posix.dirname(to), path.posix.basename(to));
    if (key && !patchInfo.has(key)) patchInfo.set(key, stash.info);
  },
};

/** Puts entries back. Returns { restored: [{ id, name, items, renamed }], failed: [{ id, error }] }. */
export async function restore(ids, by = null) {
  const restored = [];
  const failed = [];
  for (const id of ids) {
    try {
      const { root, home, entry } = parse(id);
      const { manifest, ...r } = await trashStore.restoreEntry(root, home, entry);
      await AFTER_RESTORE[r.kind]?.({ ...r, manifest })?.catch?.((err) => debug.error("trash: after restoring %s: %s", id, err.message));
      restored.push(r);
      debug.log("trash: %s restored by %s%s", id, by?.name ?? "-", r.renamed.length ? ` (${r.renamed.map((x) => `${x.rel} → ${x.to}`).join(", ")})` : "");
    } catch (err) {
      if (!(err instanceof trashStore.TrashError)) throw err;
      failed.push({ id, error: err.message });
    }
  }
  refresh(restored.map((r) => r.root));
  return { restored, failed };
}

/** Deletes entries for good ("all": every one). Returns { removed, bytes }. Only a person on the admin page may. */
export async function empty(ids, by = null) {
  const targets = ids === "all" ? (await trashStore.listAll(libraryRoots())).map((e) => e.id) : ids;
  let removed = 0;
  let bytes = 0;
  for (const id of targets) {
    const { root, home, entry } = parse(id);
    bytes += await trashStore.emptyEntry(root, home, entry);
    removed++;
  }
  debug.log("trash: %d entries (%d bytes) deleted for good by %s", removed, bytes, by?.name ?? "-");
  return { removed, bytes };
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

export async function undo(id, by = null) {
  const after = (op, abs) => UNDO_REWRITE[op.rewrite?.type]?.(op, abs);
  const out = await journalStore.undoMove(libraryRoots(), id, { by, after });
  debug.log("journal: %s undone by %s: %s/%s → %s/%s", out.id, by?.name ?? "-", out.toRoot, out.to, out.fromRoot, out.from);
  refresh([out.fromRoot, out.toRoot]);
  return out;
}

/** At start: retro's old .trash entries move into the shared trash folder (a rename in place). */
export async function migrate() {
  const retro = rootOf("retro");
  if (!retro) return 0;
  const n = await trashStore.migrateLegacy(retro);
  if (n) debug.log("trash: %d retro trash entries moved from %s to %s", n, trashStore.LEGACY_TRASH, trashStore.TRASH_DIR);
  return n;
}

export const { TrashError, TRASH_DIR } = trashStore;
