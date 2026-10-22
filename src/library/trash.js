/**
 * The shared trash: nothing the server removes from a library folder (games,
 * incoming, patches, saves, homebrew, retro) is deleted. It is moved, with one
 * rename, into a dot folder of that folder:
 *
 *   <root>/.cookingfoil-trash/<YYYY-MM-DD>/<slug>-<10 hex>/
 *     manifest.json      what was moved and why: { version, root, kind, action, by, name, trashedAt,
 *                        items: [{ rel, type, size, mtimeMs, files }], restoreKeys }
 *     <rel>              each item under its path relative to the root
 *
 * The folders are the truth: the list is read from the manifests on disk each
 * time, so a lost database or a restart loses nothing. Only emptyEntry() deletes,
 * and only a person emptying the trash on the admin page calls it.
 *
 * A file on another filesystem than its root (a disk mounted under the games
 * folder) cannot be renamed into <root>/.cookingfoil-trash. Its trash is then
 * the one of the top-most folder above it inside the root that shares its
 * filesystem (<root>/<that folder>/.cookingfoil-trash), recorded in the root's
 * homes.json so the list finds it. Only when no such folder takes it are the
 * bytes copied into the root's trash, checked, and the original removed.
 *
 * Why not ".trash": that name is the retro folder's old trash and a name people
 * and file managers use for their own. A namespaced name is never someone
 * else's folder, so emptying it can only touch what the server put there. The
 * retro folder's old .trash entries are renamed into the new folder at start
 * (migrateLegacy), within the same folder, so no bytes move; one that cannot be
 * renamed stays and is still listed from where it is.
 *
 * Every scanner skips dot folders; the ones that walk into an item's own folder
 * skip TRASH_DIR by name (isTrashName).
 *
 * Nothing here ever lands on a taken name (library/safe-move.js): moves into
 * the trash go to a fresh entry, and restores and put-backs claim the target
 * in the same step that fills it. Moves of one folder run one at a time
 * (withLocks on the root), so the server's own restores, undos and removes
 * never race each other for a name. A copy across disks is made under a dot
 * name, checked, and only then given its real name; an item whose bytes do
 * not match its manifest is listed as incomplete and never restored.
 */
import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import debug from "../debug.js";
import { trashText } from "./trash-messages.js";
import { copyChecked, moveAcross, moveNoClobber, realInside, sameBytes, sweepPartials, withLocks, withPartial } from "./safe-move.js";

export const TRASH_DIR = ".cookingfoil-trash";
export const LEGACY_TRASH = ".trash";
const HOMES_FILE = "homes.json";
const MANIFEST = "manifest.json";
const ENTRY_RE = /^\d{4}-\d{2}-\d{2}\/[a-z0-9_-]{1,24}-[0-9a-f]{10}(?:-\d{1,3})?$/;
const SLUG_RE = /^[a-z0-9_-]{1,24}-[0-9a-f]{10}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Files kept with an entry that are not library items (a homebrew app's pictures and the like). */
export const ATTACHED_DIR = ".attached";
// Restore keys may only go back into these files (a retro system's art map).
const KEY_FILE_RE = /^art-map\/[^/]+\.json$/i;
const MAX_NUMBER = 999;

/** True for a name a scanner must not walk into. Pure. */
export const isTrashName = (name) => name === TRASH_DIR;

export class TrashError extends Error {
  constructor(message, status = 409, { key = null, vars = {} } = {}) {
    super(message);
    this.status = status;
    this.key = key;
    this.vars = vars;
  }

  /** The message in `lang` when it is one of the trash's own (trash-messages.js), else as thrown. */
  textIn(lang) {
    return this.key ? trashText(lang, this.key, this.vars) : this.message;
  }
}

/** A TrashError from a trash-messages.js key: its message is the Korean text, textIn() any admin language. */
export const trashError = (key, status = 409, vars = {}) => new TrashError(trashText("ko", key, vars), status, { key, vars });

// The calls that touch the disk, replaceable by tests that stand in for a second filesystem.
const realIo = { rename: (a, b) => fsp.rename(a, b), stat: (p) => fsp.lstat(p) };
let io = realIo;
/** Test-only: replace rename and lstat (null puts the real ones back). */
export function _setIo(next) {
  io = next ? { ...realIo, ...next } : realIo;
}

const exists = (abs) => fsp.lstat(abs).then(() => true, () => false);
const inside = (base, abs) => {
  const rel = path.relative(path.resolve(base), path.resolve(abs));
  return Boolean(rel) && !rel.startsWith("..") && !path.isAbsolute(rel);
};

/** A path relative to a root as the trash keeps it ("a/b.nsp"), or null when it leaves the root or is the trash. Pure. */
export function cleanRel(rel) {
  const parts = String(rel ?? "").split(/[\\/]+/).filter((p) => p && p !== ".");
  if (!parts.length || parts.some((p) => p === ".." || p.includes("\0")) || isTrashName(parts[0])) return null;
  return parts.join("/");
}

/** YYYY-MM-DD in local time. Pure. */
const day = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 1)}\n`);
  fs.renameSync(tmp, file);
}

/** { type, size, files, mtimeMs } of a file, or of a folder's regular files (links not followed). */
export async function measure(abs) {
  const st = await fsp.lstat(abs);
  if (!st.isDirectory()) return { type: "file", size: st.size, files: 1, mtimeMs: st.mtimeMs };
  let size = 0;
  let files = 0;
  for (const e of await fsp.readdir(abs, { withFileTypes: true, recursive: true })) {
    if (!e.isFile()) continue;
    size += (await fsp.lstat(path.join(e.parentPath ?? e.path, e.name))).size;
    files++;
  }
  return { type: "dir", size, files, mtimeMs: st.mtimeMs };
}

/**
 * Into a fresh place in the trash from another filesystem: a checked copy under
 * a dot name, then its real name, then the original goes. A stop at any point
 * leaves the original whole; at worst a dot-named partial waits in the entry
 * until the trash is emptied.
 */
async function copyIn(from, to) {
  const placed = await withPartial(from, to, async (part) => {
    await copyChecked(from, part);
    return moveNoClobber(part, to);
  });
  if (!placed) throw trashError("slotTaken", 409, { name: path.basename(to) });
  // The copy is whole and in place; an original that will not go entirely is reported, not undone.
  await fsp.rm(from, { recursive: true, force: true }).catch((err) => debug.error("trash: %s copied to the trash but not all of it removed: %s", from, err.message));
}

/** A rename into a fresh place in the trash (nothing is ever there before it). */
async function renameIn(from, to) {
  await fsp.mkdir(path.dirname(to), { recursive: true });
  await io.rename(from, to);
}

/** Whether an entry folder holds nothing but its manifest (and empty folders). */
async function onlyManifest(base) {
  const left = await fsp.readdir(base, { recursive: true, withFileTypes: true }).catch(() => []);
  return !left.some((e) => !e.isDirectory() && !(e.name === MANIFEST && path.resolve(e.parentPath ?? e.path) === path.resolve(base)));
}

/** Removes an entry folder that holds nothing but its manifest, and its day folder when empty. True when it went. */
async function dropIfEmpty(base) {
  if (!(await onlyManifest(base))) return false;
  await fsp.rm(base, { recursive: true, force: true });
  await fsp.rmdir(path.dirname(base)).catch(() => {});
  return true;
}

/** The folders between the root and `abs` (top-most first) on the filesystem `abs` is on. */
async function sameDeviceAncestors(rootDir, abs) {
  const dev = (await io.stat(abs)).dev;
  const parts = path.relative(rootDir, path.dirname(abs)).split(path.sep).filter(Boolean);
  const out = [];
  for (let i = 1; i <= parts.length; i++) {
    const dir = path.join(rootDir, ...parts.slice(0, i));
    const st = await io.stat(dir).catch(() => null);
    if (st?.dev === dev) out.push(parts.slice(0, i).join("/"));
  }
  return out;
}

// ── homes: where a root keeps trash folders ──────────────────────────
/** The trash folders of a root, relative to it: its own, the ones on other disks below it, and retro's old one. */
export function homesOf(root) {
  const extra = readJson(path.join(root.dir, TRASH_DIR, HOMES_FILE));
  const homes = [TRASH_DIR, ...(Array.isArray(extra) ? extra.filter((h) => typeof h === "string" && cleanHome(h)) : [])];
  if (fs.existsSync(path.join(root.dir, LEGACY_TRASH, ".")) && root.key === "retro") homes.push(LEGACY_TRASH);
  return [...new Set(homes)];
}

/** A home path as stored: "<folder>/.cookingfoil-trash", or null. Pure. */
function cleanHome(home) {
  const parts = String(home).split("/");
  if (parts.at(-1) !== TRASH_DIR || parts.length < 2) return null;
  return parts.slice(0, -1).every((p) => p && p !== "." && p !== ".." && p !== TRASH_DIR && p !== LEGACY_TRASH) ? home : null;
}

/**
 * The homes listed for a root whose disk is not there now (the folder that holds
 * the home is missing): their entries cannot be listed until it is mounted again.
 */
export function unavailableHomes(root) {
  if (!fs.existsSync(root.dir)) return [TRASH_DIR];
  const extra = readJson(path.join(root.dir, TRASH_DIR, HOMES_FILE));
  return (Array.isArray(extra) ? extra : [])
    .filter((h) => typeof h === "string" && cleanHome(h))
    .filter((h) => !fs.existsSync(path.join(root.dir, ...h.split("/").slice(0, -1))));
}

function addHome(root, home) {
  if (home === TRASH_DIR) return;
  const file = path.join(root.dir, TRASH_DIR, HOMES_FILE);
  const list = readJson(file);
  const homes = Array.isArray(list) ? list : [];
  if (!homes.includes(home)) writeJson(file, [...homes, home]);
}

// ── addresses: "<root>|<home>|<day>/<entry>" ─────────────────────────
export const addressOf = (rootKey, home, entry) => `${rootKey}|${home}|${entry}`;

/** { rootKey, home, entry } from an address, or null. Pure. */
export function parseAddress(id) {
  const s = String(id ?? "");
  const a = s.indexOf("|");
  const b = s.lastIndexOf("|");
  if (a < 1 || b <= a) return null;
  const entry = s.slice(b + 1);
  return ENTRY_RE.test(entry) ? { rootKey: s.slice(0, a), home: s.slice(a + 1, b), entry } : null;
}

/** The folder of an entry, after checking the home is one this root has. */
function entryBase(root, home, entry) {
  if (!ENTRY_RE.test(String(entry)) || !homesOf(root).includes(home)) throw trashError("badEntry", 404);
  return path.join(root.dir, ...home.split("/"), ...entry.split("/"));
}

/**
 * Before an operation writes beside `paths`: partials an earlier stop left in
 * their folders go (safe-move.js sweepPartials). Never fails the operation.
 */
async function sweepBeside(paths, extra = []) {
  const dirs = [...new Set(paths.map((p) => path.dirname(p)))];
  await sweepPartials(dirs).catch((err) => debug.error("trash: partials beside %s not swept: %s", dirs[0], err.message));
  if (extra.length) await sweepPartials(extra, { recursive: true }).catch(() => {});
}

// ── moving in ────────────────────────────────────────────────────────
const slugOf = (kind) => `${String(kind ?? "item").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(0, 13) || "item"}-${crypto.randomBytes(5).toString("hex")}`;

/**
 * Moves `items` ([{ rel, from? }]: where each was, relative to the root, and
 * where it is now when that differs) into the trash of `root` ({ key, dir }),
 * all or none. One entry per filesystem it took (one, unless an item sits on
 * another disk under the root). `meta`: kind, action, by ({ type: "admin" |
 * "token" | "job", name }), name (what the list shows), slug (the entry's name,
 * "<word>-<10 hex>"), restoreKeys ([{ file, key, value }]: json keys put back on
 * restore), extra (more manifest fields).
 * Returns { entry, id, entries: [{ id, home, entry, items }], files: [rel] }.
 */
export async function trashItems(root, items, meta = {}, now = new Date()) {
  const list = items.map((it) => {
    const rel = cleanRel(it.rel);
    if (!rel) throw trashError("badPath", 400, { rel: it.rel });
    return { rel, from: it.from ?? path.join(root.dir, rel) };
  });
  if (!list.length) throw trashError("nothing", 400);
  return withLocks([root.dir], async () => {
    await sweepBeside(list.map((i) => i.from));
    return trashLocked(root, list, meta, now);
  });
}

async function trashLocked(root, list, meta, now) {
  const slug = meta.slug && SLUG_RE.test(meta.slug) ? meta.slug : slugOf(meta.kind);
  const homes = new Map(); // home → { entry, base, manifest }
  const moved = []; // [{ home, rel, from }]

  async function open(home) {
    if (homes.has(home)) return homes.get(home);
    const top = path.join(root.dir, ...home.split("/"));
    let entry = `${day(now)}/${slug}`;
    for (let i = 2; await exists(path.join(top, entry)); i++) entry = `${day(now)}/${slug}-${i}`;
    const manifest = {
      version: 1, root: root.key, kind: meta.kind ?? null, action: meta.action ?? null, by: meta.by ?? null, name: meta.name ?? null,
      trashedAt: now.getTime(), items: [], ...(meta.restoreKeys?.length ? { restoreKeys: meta.restoreKeys } : {}), ...(meta.extra ?? {}),
    };
    const h = { entry, base: path.join(top, ...entry.split("/")), manifest };
    homes.set(home, h);
    return h;
  }
  const saveManifest = (h) => writeJson(path.join(h.base, MANIFEST), h.manifest);
  // The manifest names an item before it moves: a stop in between leaves nothing unnamed in the trash.
  async function into(home, item, rec, how) {
    const h = await open(home);
    h.manifest.items.push(rec);
    saveManifest(h);
    try {
      await how(item.from, path.join(h.base, ...item.rel.split("/")));
    } catch (err) {
      h.manifest.items = h.manifest.items.filter((r) => r !== rec);
      if (h.manifest.items.length) saveManifest(h);
      else if (await dropIfEmpty(h.base)) homes.delete(home);
      throw err;
    }
    moved.push({ home, rel: item.rel, from: item.from });
  }

  try {
    for (const item of list) {
      const st = await measure(item.from).catch(() => null);
      if (!st) throw trashError("gone", 404, { rel: item.rel });
      const rec = { rel: item.rel, ...st };
      try {
        await into(TRASH_DIR, item, rec, renameIn);
        continue;
      } catch (err) {
        if (err.code !== "EXDEV") throw err;
      }
      // Another filesystem: the trash of the top-most folder above it that shares it.
      let placed = false;
      for (const anc of await sameDeviceAncestors(root.dir, item.from)) {
        try {
          await into(`${anc}/${TRASH_DIR}`, item, rec, renameIn);
          placed = true;
          break;
        } catch (err) {
          if (err.code !== "EXDEV" && err.code !== "EACCES" && err.code !== "EPERM" && err.code !== "EROFS") throw err;
        }
      }
      if (!placed) await into(TRASH_DIR, item, rec, copyIn);
    }
  } catch (err) {
    throw await rollBack(err);
  }
  const entries = [...homes].map(([home, h]) => {
    addHome(root, home);
    return { id: addressOf(root.key, home, h.entry), home, entry: h.entry, items: h.manifest.items.map((r) => r.rel) };
  });
  return { entry: entries[0].entry, id: entries[0].id, entries, files: list.map((i) => i.rel) };

  /**
   * Half an action in the trash is worse than none: what went is put back, newest
   * first, never over something that took its place meanwhile. What cannot go
   * back stays in the trash, listed, and the error says so; nothing is deleted.
   */
  async function rollBack(err) {
    const stuck = [];
    for (const m of moved.reverse()) {
      const h = homes.get(m.home);
      const at = path.join(h.base, ...m.rel.split("/"));
      const back = await moveAcross(at, m.from).catch((e) => {
        debug.error("trash: %s not put back from the trash: %s", m.rel, e.message);
        return false;
      });
      if (back) h.manifest.items = h.manifest.items.filter((r) => r.rel !== m.rel);
      else stuck.push(m.rel);
    }
    for (const [home, h] of homes) {
      if (h.manifest.items.length) {
        saveManifest(h);
        addHome(root, home);
      } else await dropIfEmpty(h.base);
    }
    const why = err instanceof TrashError ? err.message : err.message ?? String(err);
    if (stuck.length) return trashError("stuck", err.status ?? 409, { why, n: stuck.length, names: stuck.join(", ") });
    return err instanceof TrashError ? err : trashError("rolledBack", 409, { why });
  }
}

// ── reading ──────────────────────────────────────────────────────────
/**
 * Whether what the trash holds for an item is not what went in: a copy cut short
 * by a stop, or a file changed in the trash. Old manifests without sizes pass. Pure.
 */
export function isIncomplete(rec, st) {
  if (rec.size == null || !st) return false;
  if (rec.type && st.type !== rec.type) return true;
  return st.size !== rec.size || (rec.type === "dir" && rec.files != null && st.files !== rec.files);
}

/** A manifest in today's shape: retro's old ones listed `files` (paths) and an `artMap`. Pure. */
export function normalizeManifest(m, rootKey) {
  if (!m || typeof m !== "object") return null;
  const items = Array.isArray(m.items) ? m.items
    : Array.isArray(m.files) ? m.files.filter((f) => typeof f === "string").map((rel) => ({ rel, type: "file", size: null })) : [];
  const legacyKey = m.artMap?.key ? [{ file: `art-map/${m.artMap.system}.json`, key: m.artMap.key, value: m.artMap.value }] : [];
  return {
    ...m,
    root: m.root ?? rootKey,
    // Retro's own entries name the game they held; `id` is the trash address once listed.
    gameId: m.gameId ?? (typeof m.id === "string" ? m.id : null),
    kind: m.kind ?? (m.system === "core" ? "retro-core" : m.system ? "retro-game" : null),
    action: m.action ?? (m.system ? "retro-trash" : null),
    by: m.by ?? null,
    items: items.filter((i) => cleanRel(i?.rel)),
    restoreKeys: [...(Array.isArray(m.restoreKeys) ? m.restoreKeys : []), ...legacyKey],
  };
}

/** Every entry of a root, newest first: [{ id, root, home, entry, kind, action, by, name, trashedAt, items, size, ... }]. */
export async function listRoot(root) {
  const out = [];
  for (const home of homesOf(root)) {
    const top = path.join(root.dir, ...home.split("/"));
    for (const d of (await fsp.readdir(top).catch(() => [])).filter((n) => DAY_RE.test(n))) {
      for (const e of await fsp.readdir(path.join(top, d)).catch(() => [])) {
        const entry = `${d}/${e}`;
        if (!ENTRY_RE.test(entry)) continue;
        const base = path.join(top, d, e);
        const m = normalizeManifest(readJson(path.join(base, MANIFEST)), root.key);
        if (!m) continue;
        const items = [];
        for (const it of m.items) {
          const st = await measure(path.join(base, ...it.rel.split("/"))).catch(() => null);
          items.push({ ...it, size: it.size ?? st?.size ?? null, present: Boolean(st), incomplete: Boolean(st && isIncomplete(it, st)) });
        }
        const held = items.filter((i) => i.present);
        out.push({
          ...m, id: addressOf(root.key, home, entry), root: root.key, home, entry, items,
          size: held.reduce((n, i) => n + (i.size || 0), 0), missing: items.length - held.length,
          incomplete: items.filter((i) => i.incomplete).length,
        });
      }
    }
  }
  return out.sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0));
}

/** Every root's entries together, newest first. */
export async function listAll(roots) {
  const all = await Promise.all(roots.map((r) => listRoot(r)));
  return all.flat().sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0));
}

/** Bytes and entries held per root: { total: { bytes, count }, roots: { <key>: { bytes, count } } }. */
export async function usage(roots) {
  const out = { total: { bytes: 0, count: 0 }, roots: {} };
  for (const r of roots) {
    const list = await listRoot(r);
    const bytes = list.reduce((n, e) => n + e.size, 0);
    out.roots[r.key] = { bytes, count: list.length };
    out.total.bytes += bytes;
    out.total.count += list.length;
  }
  return out;
}

// ── restoring and emptying ───────────────────────────────────────────
/** `rel`, or for k > 1 "<name> (k)<ext>" beside it ("<name> (k)" for a folder). Pure. */
export function numbered(rel, k, isDir) {
  if (k <= 1) return rel;
  const dir = path.posix.dirname(rel);
  const base = path.posix.basename(rel);
  const ext = isDir ? "" : path.posix.extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  return `${dir === "." ? "" : `${dir}/`}${stem} (${k})${ext}`;
}

const takenError = (rel) => trashError("placeTaken", 409, { rel });

/**
 * Puts an entry back. Nothing is ever overwritten: by default an entry whose
 * places are taken comes back beside them, every item under the same number
 * ("<name> (2)"), so files that belong together keep matching names. With
 * `exactName` (and always for a retro game, whose art and art-map key follow
 * its ROM's name, and a retro core, which RetroArch only finds under its own
 * name) a taken place refuses the whole entry instead, which stays in the
 * trash. All of the entry's items come back or none do. An item whose bytes
 * do not match its manifest (a copy cut short) refuses the entry too. An item
 * whose file is already in the library (a restore stopped after placing it and
 * before taking it out of the trash) counts as back: its trash name goes.
 * `after(result, base)` runs before the entry folder goes, for what the caller
 * keeps in it (ATTACHED_DIR). Returns { id, root, name, kind, manifest, items:
 * [{ rel, to }], renamed: [{ rel, to }] }.
 */
export async function restoreEntry(root, home, entry, { exactName = false, after = null } = {}) {
  const base = entryBase(root, home, entry);
  return withLocks([root.dir], async () => {
    const m = normalizeManifest(readJson(path.join(base, MANIFEST)), root.key);
    if (!m) throw trashError("notInTrash", 404);
    await sweepBeside(m.items.map((it) => path.join(root.dir, ...it.rel.split("/"))), [base]);
    const todo = [];
    const already = [];
    for (const it of m.items) {
      const from = path.join(base, ...it.rel.split("/"));
      if (!inside(base, from)) continue;
      const st = await measure(from).catch(() => null);
      if (!st) continue;
      if (isIncomplete(it, st)) throw trashError("incomplete", 409, { rel: it.rel });
      const twin = await twinOf(root, it.rel, from);
      if (twin) {
        await fsp.unlink(from);
        already.push({ rel: it.rel, to: twin });
        continue;
      }
      todo.push({ rel: it.rel, from, isDir: st.type === "dir" });
    }
    const exact = exactName || EXACT_KINDS.has(m.kind);
    const done = [...already, ...(todo.length ? await placeAll(root, todo, exact, m.kind) : [])];
    for (const k of m.restoreKeys ?? []) {
      const rel = cleanRel(k?.file);
      if (!rel || !KEY_FILE_RE.test(rel) || typeof k.key !== "string") continue;
      const file = path.join(root.dir, ...rel.split("/"));
      const map = readJson(file) ?? {};
      if (!Object.hasOwn(map, k.key)) writeJson(file, { ...map, [k.key]: k.value });
    }
    const result = { id: addressOf(root.key, home, entry), root: root.key, name: m.name ?? null, kind: m.kind, manifest: m, items: done, renamed: done.filter((d) => d.to !== d.rel) };
    if (after) await after(result, base);
    await fsp.rm(path.join(base, ATTACHED_DIR), { recursive: true, force: true });
    // Only the manifest and empty folders are left: those go, never a file.
    await dropIfEmpty(base);
    return result;
  });
}

// Kinds that only ever come back under their own name.
const EXACT_KINDS = new Set(["retro-game", "retro-core"]);

/**
 * The name in the root (the item's own, or a numbered one a restore gave it)
 * that holds the same file as `from` in the trash: the same inode (a restore
 * stopped between link and unlink) or, for a copy across disks stopped before
 * the original went, the same size, mtime and bytes. Null when none does.
 */
async function twinOf(root, rel, from) {
  const st = await fsp.lstat(from).catch(() => null);
  if (!st?.isFile()) return null;
  for (let k = 1; k <= MAX_NUMBER; k++) {
    const name = numbered(rel, k, false);
    const abs = path.join(root.dir, ...name.split("/"));
    const there = await fsp.lstat(abs).catch(() => null);
    if (!there) {
      // Restores take the first free number, so past a gap only a hard link can still be found.
      if (st.nlink > 1) continue;
      return null;
    }
    if (there.dev === st.dev && there.ino === st.ino) return name;
    if (there.isFile() && there.size === st.size && Math.round(there.mtimeMs) === Math.round(st.mtimeMs) && (await sameBytes(abs, from))) return name;
  }
  return null;
}

/**
 * At start: every entry item whose file is also in the library (twinOf) loses
 * its trash name; an entry left with nothing goes. Returns how many went.
 */
export async function dropTwins(root) {
  return withLocks([root.dir], async () => {
    let n = 0;
    for (const e of await listRoot(root)) {
      const base = path.join(root.dir, ...e.home.split("/"), ...e.entry.split("/"));
      const file = path.join(base, MANIFEST);
      const raw = readJson(file);
      if (!raw) continue;
      const gone = new Set();
      for (const it of e.items) {
        if (!it.present || it.incomplete) continue;
        const from = path.join(base, ...it.rel.split("/"));
        if (!inside(base, from) || !(await twinOf(root, it.rel, from))) continue;
        await fsp.unlink(from);
        gone.add(it.rel);
        n++;
      }
      if (!gone.size) continue;
      if (Array.isArray(raw.items)) raw.items = raw.items.filter((i) => !gone.has(cleanRel(i?.rel)));
      if (Array.isArray(raw.files)) raw.files = raw.files.filter((f) => !gone.has(cleanRel(f)));
      writeJson(file, raw);
      await dropIfEmpty(base);
    }
    return n;
  });
}

const coreTakenError = (rel) => trashError("coreTaken", 409, { rel });

/** Moves every item of `todo` back under one number, all or none. Returns [{ rel, to }]. */
async function placeAll(root, todo, exact, kind = null) {
  const refuse = (rel) => (kind === "retro-core" ? coreTakenError(rel) : takenError(rel));
  for (let k = 1; k <= MAX_NUMBER; k++) {
    const names = todo.map((t) => numbered(t.rel, k, t.isDir));
    for (const name of names) {
      const abs = path.join(root.dir, ...name.split("/"));
      if (!inside(root.dir, abs) || !(await realInside(root.dir, abs))) throw trashError("linkOutside", 409, { name });
    }
    const taken = [];
    for (const name of names) if (await exists(path.join(root.dir, ...name.split("/")))) taken.push(name);
    if (taken.length) {
      if (exact) throw refuse(taken[0]);
      continue;
    }
    const placed = [];
    let lost = null;
    for (const [i, t] of todo.entries()) {
      if (await moveAcross(t.from, path.join(root.dir, ...names[i].split("/")))) placed.push(i);
      else {
        lost = names[i];
        break;
      }
    }
    if (lost === null) return todo.map((t, i) => ({ rel: t.rel, to: names[i] }));
    // Something took a name between the check and the move: what came back goes back into the trash, and the next number is tried.
    for (const i of placed.reverse()) {
      if (!(await moveAcross(path.join(root.dir, ...names[i].split("/")), todo[i].from).catch(() => false))) {
        throw trashError("raceLost", 409, { lost, name: names[i] });
      }
    }
    if (exact) throw refuse(lost);
  }
  throw trashError("noFreeName");
}

/** Deletes an entry for good: the one permanent delete there is. Returns the bytes it held. */
export async function emptyEntry(root, home, entry) {
  const base = entryBase(root, home, entry);
  return withLocks([root.dir], async () => {
    if (!(await exists(path.join(base, MANIFEST))) && !(await exists(base))) throw trashError("notInTrash", 404);
    const { size } = await measure(base).catch(() => ({ size: 0 }));
    await fsp.rm(base, { recursive: true, force: true });
    await fsp.rmdir(path.dirname(base)).catch(() => {});
    return size;
  });
}

/** Whether an entry is still in the trash (its manifest is there). */
export async function hasEntry(root, home, entry) {
  return exists(path.join(entryBase(root, home, entry), MANIFEST));
}

/**
 * Keeps a copy of `fromDir` (outside the library, such as a homebrew app's
 * pictures in the data folder) with an entry, under ATTACHED_DIR/<name>, and
 * notes `fields` in its manifest. Checked like any copy; the caller forgets
 * the original only after this returns. restoreEntry's `after` reads it back.
 */
export async function attach(root, home, entry, { name = null, fromDir = null, fields = {} } = {}) {
  const base = entryBase(root, home, entry);
  return withLocks([root.dir], async () => {
    const file = path.join(base, MANIFEST);
    const m = readJson(file);
    if (!m) throw trashError("notInTrash", 404);
    let attached = null;
    if (name && fromDir && (await exists(fromDir))) {
      if (!/^[a-z0-9_-]{1,40}$/.test(name)) throw trashError("badAttachName", 400);
      const to = path.join(base, ATTACHED_DIR, name);
      const placed = await withPartial(fromDir, to, async (part) => {
        await copyChecked(fromDir, part);
        return moveNoClobber(part, to);
      });
      if (!placed) throw trashError("alreadyAttached");
      attached = name;
    }
    writeJson(file, { ...m, ...fields, ...(attached ? { attached: [...new Set([...(m.attached ?? []), attached])] } : {}) });
    return attached;
  });
}

/**
 * Retro's old trash (<retro>/.trash/<day>/<entry>) renamed into the new one,
 * entry by entry, inside the same folder. One that will not rename stays where
 * it is and is still listed from there. Returns how many moved.
 */
export async function migrateLegacy(root) {
  const old = path.join(root.dir, LEGACY_TRASH);
  let n = 0;
  for (const d of (await fsp.readdir(old).catch(() => [])).filter((x) => DAY_RE.test(x))) {
    for (const e of await fsp.readdir(path.join(old, d)).catch(() => [])) {
      if (!ENTRY_RE.test(`${d}/${e}`) || !readJson(path.join(old, d, e, MANIFEST))) continue;
      const to = path.join(root.dir, TRASH_DIR, d, e);
      if (await exists(to)) continue;
      try {
        await fsp.mkdir(path.dirname(to), { recursive: true });
        await io.rename(path.join(old, d, e), to);
        n++;
      } catch {
        // Left in .trash and listed from there.
      }
    }
    await fsp.rmdir(path.join(old, d)).catch(() => {});
  }
  await fsp.rmdir(old).catch(() => {});
  return n;
}
