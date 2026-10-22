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
 */
import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";

export const TRASH_DIR = ".cookingfoil-trash";
export const LEGACY_TRASH = ".trash";
const HOMES_FILE = "homes.json";
const MANIFEST = "manifest.json";
const ENTRY_RE = /^\d{4}-\d{2}-\d{2}\/[a-z0-9_-]{1,24}-[0-9a-f]{10}(?:-\d{1,3})?$/;
const SLUG_RE = /^[a-z0-9_-]{1,24}-[0-9a-f]{10}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a name a scanner must not walk into. Pure. */
export const isTrashName = (name) => name === TRASH_DIR;

export class TrashError extends Error {
  constructor(message, status = 409) {
    super(message);
    this.status = status;
  }
}

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

/** A copy that is checked (same bytes in, same file count) before the original goes. */
async function copyVerifyRemove(from, to) {
  const before = await measure(from);
  await fsp.mkdir(path.dirname(to), { recursive: true });
  await fsp.cp(from, to, { recursive: true, preserveTimestamps: true, errorOnExist: true, force: false });
  const after = await measure(to);
  if (after.size !== before.size || after.files !== before.files) {
    await fsp.rm(to, { recursive: true, force: true });
    throw new TrashError(`복사본이 원본과 달라 옮기지 않았습니다: ${path.basename(from)}`);
  }
  await fsp.rm(from, { recursive: true });
}

/**
 * Moves `from` to `to` (parents made). A rename; across filesystems a checked
 * copy when `copy` allows it, else the EXDEV error goes up.
 */
export async function moveItem(from, to, { copy = true } = {}) {
  await fsp.mkdir(path.dirname(to), { recursive: true });
  try {
    await io.rename(from, to);
  } catch (err) {
    if (err.code !== "EXDEV" || !copy) throw err;
    await copyVerifyRemove(from, to);
  }
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
  return parts.slice(0, -1).every((p) => p && p !== "." && p !== ".." && !p.startsWith(".")) ? home : null;
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
  if (!ENTRY_RE.test(String(entry)) || !homesOf(root).includes(home)) throw new TrashError("휴지통 항목이 맞지 않습니다", 404);
  return path.join(root.dir, ...home.split("/"), ...entry.split("/"));
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
    if (!rel) throw new TrashError(`옮길 수 없는 경로입니다: ${it.rel}`, 400);
    return { rel, from: it.from ?? path.join(root.dir, rel) };
  });
  if (!list.length) throw new TrashError("옮길 파일이 없습니다", 400);
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
  // The manifest names an item before it moves: a stop in between leaves nothing unnamed in the trash.
  async function into(home, item, rec, how) {
    const h = await open(home);
    h.manifest.items.push(rec);
    writeJson(path.join(h.base, MANIFEST), h.manifest);
    try {
      await how(item.from, path.join(h.base, ...item.rel.split("/")));
    } catch (err) {
      h.manifest.items = h.manifest.items.filter((r) => r !== rec);
      if (h.manifest.items.length) writeJson(path.join(h.base, MANIFEST), h.manifest);
      else {
        await fsp.rm(h.base, { recursive: true, force: true });
        homes.delete(home);
      }
      throw err;
    }
    moved.push({ home, rel: item.rel, from: item.from });
  }

  try {
    for (const item of list) {
      const st = await measure(item.from).catch(() => null);
      if (!st) throw new TrashError(`${item.rel} 이(가) 없습니다`, 404);
      const rec = { rel: item.rel, ...st };
      const rename = (from, to) => moveItem(from, to, { copy: false });
      try {
        await into(TRASH_DIR, item, rec, rename);
        continue;
      } catch (err) {
        if (err.code !== "EXDEV") throw err;
      }
      // Another filesystem: the trash of the top-most folder above it that shares it.
      let placed = false;
      for (const anc of await sameDeviceAncestors(root.dir, item.from)) {
        try {
          await into(`${anc}/${TRASH_DIR}`, item, rec, rename);
          placed = true;
          break;
        } catch (err) {
          if (err.code !== "EXDEV" && err.code !== "EACCES" && err.code !== "EPERM" && err.code !== "EROFS") throw err;
        }
      }
      if (!placed) await into(TRASH_DIR, item, rec, copyVerifyRemove);
    }
  } catch (err) {
    // Half an action in the trash is worse than none: put back what went, newest first.
    for (const m of moved.reverse()) {
      const h = homes.get(m.home);
      if (h) await moveItem(path.join(h.base, ...m.rel.split("/")), m.from).catch(() => {});
    }
    for (const h of homes.values()) await fsp.rm(h.base, { recursive: true, force: true }).catch(() => {});
    throw err instanceof TrashError ? err : new TrashError(`휴지통으로 옮기지 못해 되돌렸습니다: ${err.message}`);
  }
  const entries = [...homes].map(([home, h]) => {
    addHome(root, home);
    return { id: addressOf(root.key, home, h.entry), home, entry: h.entry, items: h.manifest.items.map((r) => r.rel) };
  });
  return { entry: entries[0].entry, id: entries[0].id, entries, files: list.map((i) => i.rel) };
}

// ── reading ──────────────────────────────────────────────────────────
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
          const st = await fsp.lstat(path.join(base, ...it.rel.split("/"))).catch(() => null);
          items.push({ ...it, size: it.size ?? (st && !st.isDirectory() ? st.size : null), present: Boolean(st) });
        }
        const held = items.filter((i) => i.present);
        out.push({
          ...m, id: addressOf(root.key, home, entry), root: root.key, home, entry, items,
          size: held.reduce((n, i) => n + (i.size || 0), 0), missing: items.length - held.length,
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
/** `rel` itself, or "<name> (2)<ext>", "(3)", ... beside it: the first free one. */
async function freeName(rootDir, rel, isDir) {
  if (!(await exists(path.join(rootDir, rel)))) return rel;
  const dir = path.posix.dirname(rel);
  const base = path.posix.basename(rel);
  const ext = isDir ? "" : path.posix.extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  for (let n = 2; ; n++) {
    const next = `${dir === "." ? "" : `${dir}/`}${stem} (${n})${ext}`;
    if (!(await exists(path.join(rootDir, next)))) return next;
  }
}

/**
 * Puts an entry back. Nothing is overwritten: an item whose place is taken
 * comes back beside it under a numbered name. Only what the trash still holds
 * moves. Returns { id, root, items: [{ rel, to }], renamed: [{ rel, to }] }.
 */
export async function restoreEntry(root, home, entry) {
  const base = entryBase(root, home, entry);
  const m = normalizeManifest(readJson(path.join(base, MANIFEST)), root.key);
  if (!m) throw new TrashError("휴지통에 없는 항목입니다", 404);
  const done = [];
  for (const it of m.items) {
    const from = path.join(base, ...it.rel.split("/"));
    if (!inside(base, from) || !(await exists(from))) continue;
    const st = await fsp.lstat(from);
    const to = await freeName(root.dir, it.rel, st.isDirectory());
    if (!inside(root.dir, path.join(root.dir, to))) continue;
    await moveItem(from, path.join(root.dir, ...to.split("/")));
    done.push({ rel: it.rel, to });
  }
  for (const k of m.restoreKeys ?? []) {
    const rel = cleanRel(k?.file);
    if (!rel || !/\.json$/i.test(rel) || typeof k.key !== "string") continue;
    const file = path.join(root.dir, ...rel.split("/"));
    const map = readJson(file) ?? {};
    if (!Object.hasOwn(map, k.key)) writeJson(file, { ...map, [k.key]: k.value });
  }
  // Only the manifest and empty folders are left: those go, never a file.
  const left = (await fsp.readdir(base, { recursive: true, withFileTypes: true }).catch(() => [])).filter((e) => e.isFile() && !(e.name === MANIFEST && path.resolve(e.parentPath ?? e.path) === path.resolve(base)));
  if (!left.length) await fsp.rm(base, { recursive: true, force: true });
  await fsp.rmdir(path.dirname(base)).catch(() => {});
  return { id: addressOf(root.key, home, entry), root: root.key, name: m.name ?? null, kind: m.kind, manifest: m, items: done, renamed: done.filter((d) => d.to !== d.rel) };
}

/** Deletes an entry for good: the one permanent delete there is. Returns the bytes it held. */
export async function emptyEntry(root, home, entry) {
  const base = entryBase(root, home, entry);
  if (!(await exists(path.join(base, MANIFEST))) && !(await exists(base))) throw new TrashError("휴지통에 없는 항목입니다", 404);
  const { size } = await measure(base).catch(() => ({ size: 0 }));
  await fsp.rm(base, { recursive: true, force: true });
  await fsp.rmdir(path.dirname(base)).catch(() => {});
  return size;
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
