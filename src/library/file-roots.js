/**
 * The admin file browser's ground: folders and files under the library roots,
 * addressed as (root key, rel), with one containment rule for every call.
 *
 *   list(key, rel, { q, sort, order, page, perPage })  a folder, folders first, paged on the server
 *   open(key, rel)                                     a file to send: { abs, name, size, mtime }
 *   mkdir(key, rel, name)                              a new folder in `rel`
 *   rename(key, rel, name)                             in the same folder, journaled
 *   move(key, rels, toKey, toRel)                      into a folder, across roots too, journaled
 *   trash(key, rels, { by })                           into the root's trash, never a plain delete
 *   uploadTarget(key, rel, sub)                        where an upload `sub` ("a.nsp", "Pack/a.nsp") would land, checked
 *   place(key, rel, sub, src)                          a finished upload moved there; a taken name is "exists"
 *
 * A path is refused (FileError "bad-path") when it climbs out of the root, has a
 * segment that starts with a dot (the server's trash, staging and partials live
 * there), resolves through a link to somewhere outside the root or to a dot
 * folder in it, or lies in another root or a fenced folder (the server's data
 * and keys) that sits inside this one, as in the old layout. Nothing is
 * ever overwritten: a taken name is "exists". After a write the root is read
 * again (`refresh`), so the library and the catalogs see the change.
 */
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { moveAcross, withLocks } from "./safe-move.js";
import { trashItems } from "./trash.js";
import { recordMove } from "./journal.js";
import { libraryRoots, refresh as refreshRoots } from "./trash-service.js";
import * as env from "../helpers/envs.js";

/** The roots the browser shows. The server's own data folder (keys, tokens) is never one of them. */
export const FILE_ROOT_KEYS = Object.freeze(["games", "incoming", "retro", "homebrew", "patches", "saves"]);

const SORTS = new Set(["name", "size", "mtime", "type"]);
const PER_PAGE = 100;
const MAX_PER_PAGE = 500;
const MAX_NAME_BYTES = 255;
const STAT_BATCH = 64;

export class FileError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
const fail = (code, status) => {
  throw new FileError(code, status);
};

/** `rel` as clean segments, or null when it climbs, holds NUL or names a dot entry. "" is the root. */
export function cleanPath(rel) {
  const parts = String(rel ?? "").split(/[\\/]+/).filter((p) => p && p !== ".");
  if (parts.some((p) => p === ".." || p.includes("\0") || p.startsWith("."))) return null;
  return parts.join("/");
}

/** A name for a new or renamed entry, or null: one segment, no dot start, at most 255 bytes. */
export function cleanName(name) {
  const s = String(name ?? "").trim();
  if (!s || s.startsWith(".") || /[\\/\x00-\x1f\x7f]/.test(s) || Buffer.byteLength(s) > MAX_NAME_BYTES) return null;
  return s;
}

const inside = (root, real) => {
  const rel = path.relative(root, real);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** The browser over `roots` (default: the server's library folders), reading a root again after it changed. */
export function createFileRoots({ roots = libraryRoots, refresh = refreshRoots, fences = () => [env.dataDir, env.keysDir] } = {}) {
  function rootOf(key) {
    if (!FILE_ROOT_KEYS.includes(key)) fail("no-root", 404);
    const root = roots().find((r) => r.key === key);
    if (!root) fail("no-root", 404);
    return root;
  }

  /**
   * The real root folder and the real folders inside it the browser never enters from it: every
   * other root and every fence that sits within it. One that holds the root itself is no fence here.
   */
  async function walls(root) {
    const real = await fsp.realpath(root.dir).catch(() => fail("no-root", 404));
    const others = [...roots().filter((r) => r.key !== root.key).map((r) => r.dir), ...fences().filter(Boolean)];
    const reals = await Promise.all(others.map((d) => fsp.realpath(d).catch(() => path.resolve(d))));
    return { real, fenced: reals.filter((d) => d !== real && inside(real, d)) };
  }

  /** Whether a real path is a place of this root the browser may show: inside it, no dot folder, no fenced folder. */
  const allowed = (w, real) => inside(w.real, real) && cleanPath(path.relative(w.real, real)) !== null && !w.fenced.some((f) => inside(f, real));

  /**
   * { root, rel, abs, real, walls } for a path that exists and passes `allowed` both as itself
   * (`abs`, the entry in its real parent, a link left as the link) and once links are followed (`real`).
   * Writes act on `abs`, reads on `real`.
   */
  async function resolve(key, rel, { mayBeRoot = true } = {}) {
    const root = rootOf(key);
    const clean = cleanPath(rel);
    if (clean === null || (!clean && !mayBeRoot)) fail("bad-path");
    const w = await walls(root);
    if (!clean) return { root, rel: clean, abs: w.real, real: w.real, walls: w };
    const parts = clean.split("/");
    const missing = (err) => fail(err.code === "ENOENT" ? "not-found" : "bad-path", err.code === "ENOENT" ? 404 : 400);
    const parent = await fsp.realpath(path.join(root.dir, ...parts.slice(0, -1))).catch(missing);
    const abs = path.join(parent, parts[parts.length - 1]);
    const real = await fsp.realpath(abs).catch(missing);
    if (!allowed(w, abs) || !allowed(w, real)) fail("bad-path");
    return { root, rel: clean, abs, real, walls: w };
  }

  /** A folder to write into: it must exist, be a folder and pass `resolve`. */
  async function folder(key, rel) {
    const at = await resolve(key, rel);
    if (!(await fsp.stat(at.real)).isDirectory()) fail("not-a-folder");
    return at;
  }

  /** Just before a write: the folder is still where `resolve` saw it (no link swapped in since). */
  async function still(at) {
    const now = await fsp.realpath(at.real).catch(() => null);
    if (now !== at.real || !allowed(at.walls, now)) fail("bad-path");
  }

  async function entryOf(dir, relDir, w, dirent) {
    const abs = path.join(dir, dirent.name);
    if (!allowed(w, abs)) return null;
    let st = await fsp.lstat(abs).catch(() => null);
    if (!st) return null;
    if (st.isSymbolicLink()) {
      const real = await fsp.realpath(abs).catch(() => null);
      if (!real || !allowed(w, real)) return null;
      st = await fsp.stat(abs).catch(() => null);
      if (!st) return null;
    }
    const isDir = st.isDirectory();
    if (!isDir && !st.isFile()) return null;
    return {
      name: dirent.name,
      rel: relDir ? `${relDir}/${dirent.name}` : dirent.name,
      type: isDir ? "dir" : "file",
      size: isDir ? null : st.size,
      mtime: Math.round(st.mtimeMs),
      ext: isDir ? null : path.extname(dirent.name).slice(1).toLowerCase() || null,
    };
  }

  async function list(key, rel, { q = "", sort = "name", order = "asc", page = 1, perPage = PER_PAGE } = {}) {
    const at = await folder(key, rel);
    if (!SORTS.has(sort)) fail("bad-param");
    const size = Math.min(Math.max(1, Number(perPage) || PER_PAGE), MAX_PER_PAGE);
    const dirents = (await fsp.readdir(at.real, { withFileTypes: true })).filter((d) => !d.name.startsWith("."));
    const needle = String(q ?? "").trim().toLowerCase();
    const wanted = needle ? dirents.filter((d) => d.name.toLowerCase().includes(needle)) : dirents;
    const entries = [];
    for (let i = 0; i < wanted.length; i += STAT_BATCH) {
      const got = await Promise.all(wanted.slice(i, i + STAT_BATCH).map((d) => entryOf(at.real, at.rel, at.walls, d)));
      entries.push(...got.filter(Boolean));
    }
    const dir = order === "desc" ? -1 : 1;
    const byName = (a, b) => collator.compare(a.name, b.name);
    const by = {
      name: byName,
      type: (a, b) => collator.compare(a.ext ?? "", b.ext ?? "") || byName(a, b),
      size: (a, b) => (a.size ?? 0) - (b.size ?? 0) || byName(a, b),
      mtime: (a, b) => a.mtime - b.mtime || byName(a, b),
    }[sort];
    // Folders stay above files whichever way the files are sorted.
    entries.sort((a, b) => (a.type === b.type ? dir * by(a, b) : a.type === "dir" ? -1 : 1));
    const total = entries.length;
    const pages = Math.max(1, Math.ceil(total / size));
    const pg = Math.min(Math.max(1, Number(page) || 1), pages);
    const parent = at.rel ? at.rel.split("/").slice(0, -1).join("/") : null;
    return {
      root: key, path: at.rel, parent, items: entries.slice((pg - 1) * size, pg * size),
      total, page: pg, perPage: size, pages, sort, order: dir === -1 ? "desc" : "asc",
      counts: { dirs: entries.filter((e) => e.type === "dir").length, files: entries.filter((e) => e.type === "file").length },
    };
  }

  async function open(key, rel) {
    const at = await resolve(key, rel, { mayBeRoot: false });
    const st = await fsp.stat(at.real);
    if (!st.isFile()) fail("not-a-file");
    return { abs: at.real, name: path.basename(at.abs), size: st.size, mtime: Math.round(st.mtimeMs) };
  }

  /**
   * Everything under `rels` (one folder's entries) for a zip, in name order: { name, real, size, mtime } for a
   * file and { name, dir: true, mtime } for a folder, `name` starting at the entry's own name. What the list
   * hides stays out (dot entries, fenced folders, links that lead away), and a link back up is walked once.
   */
  async function collect(key, rels) {
    const out = [];
    const seen = new Set();
    const walk = async (w, real, name) => {
      const st = await fsp.stat(real).catch(() => null);
      if (st?.isFile()) return void out.push({ name, real, size: st.size, mtime: st.mtime });
      if (!st?.isDirectory() || seen.has(real)) return;
      seen.add(real);
      out.push({ name, dir: true, mtime: st.mtime });
      const dirents = (await fsp.readdir(real, { withFileTypes: true }).catch(() => [])).filter((d) => !d.name.startsWith("."));
      dirents.sort((a, b) => collator.compare(a.name, b.name));
      for (const d of dirents) {
        const abs = path.join(real, d.name);
        const to = allowed(w, abs) && (await fsp.realpath(abs).catch(() => null));
        if (to && allowed(w, to)) await walk(w, to, `${name}/${d.name}`);
      }
    };
    for (const rel of rels) {
      const at = await resolve(key, rel, { mayBeRoot: false });
      await walk(at.walls, at.real, path.basename(at.abs));
    }
    return out;
  }

  async function mkdir(key, rel, name) {
    const clean = cleanName(name);
    if (!clean) fail("bad-name");
    const at = await folder(key, rel);
    await still(at);
    try {
      await fsp.mkdir(path.join(at.real, clean));
    } catch (err) {
      if (err.code === "EEXIST") fail("exists", 409);
      throw err;
    }
    refresh([key]);
    return { root: key, rel: at.rel ? `${at.rel}/${clean}` : clean };
  }

  async function rename(key, rel, name, { by = null } = {}) {
    const clean = cleanName(name);
    if (!clean) fail("bad-name");
    const at = await resolve(key, rel, { mayBeRoot: false });
    const parentRel = at.rel.split("/").slice(0, -1).join("/");
    const toRel = parentRel ? `${parentRel}/${clean}` : clean;
    if (toRel === at.rel) return { root: key, rel: toRel };
    const to = path.join(path.dirname(at.abs), clean);
    const placed = await withLocks([at.root.dir], async () => {
      await still({ real: path.dirname(at.abs), walls: at.walls });
      return moveAcross(at.abs, to);
    });
    if (!placed) fail("exists", 409);
    await recordMove({ action: "rename", by, fromRoot: at.root, from: at.rel, toRoot: at.root, to: toRel });
    refresh([key]);
    return { root: key, rel: toRel };
  }

  async function move(key, rels, toKey, toRel, { by = null } = {}) {
    const dest = await folder(toKey, toRel);
    const moved = [];
    const skipped = [];
    for (const rel of rels) {
      let at;
      try {
        at = await resolve(key, rel, { mayBeRoot: false });
      } catch (err) {
        if (!(err instanceof FileError)) throw err;
        skipped.push({ rel, code: err.code });
        continue;
      }
      if (inside(at.real, dest.real)) {
        skipped.push({ rel, code: "into-itself" });
        continue;
      }
      const name = path.basename(at.abs);
      const to = dest.rel ? `${dest.rel}/${name}` : name;
      if (toKey === key && to === at.rel) {
        skipped.push({ rel, code: "same-place" });
        continue;
      }
      const placed = await withLocks([at.root.dir, dest.root.dir], async () => {
        await still(dest);
        return moveAcross(at.abs, path.join(dest.real, name));
      });
      if (!placed) {
        skipped.push({ rel, code: "exists" });
        continue;
      }
      await recordMove({ action: "move", by, fromRoot: at.root, from: at.rel, toRoot: dest.root, to });
      moved.push({ from: at.rel, to });
    }
    if (moved.length) refresh([key, toKey]);
    return { moved, skipped };
  }

  /**
   * Where an upload `sub` lands in the folder `rel`: its own folders (a dropped folder keeps its shape) may
   * be new, the file itself must not be there yet. Nothing is made here, so a refusal costs no upload.
   */
  async function uploadTarget(key, rel, sub) {
    const dest = await folder(key, rel);
    const parts = String(sub ?? "").split("/");
    if (parts.some((p) => cleanName(p) !== p)) fail("bad-name");
    let at = dest.real;
    for (const [i, p] of parts.entries()) {
      at = path.join(at, p);
      const st = await fsp.lstat(at).catch(() => null);
      if (i === parts.length - 1) {
        if (st) fail("exists", 409);
      } else if (st && !st.isDirectory()) {
        fail("not-a-folder");
      }
    }
    return { dest, abs: at, rel: dest.rel ? `${dest.rel}/${sub}` : sub };
  }

  async function place(key, rel, sub, src) {
    const t = await uploadTarget(key, rel, sub);
    const placed = await withLocks([t.dest.root.dir], async () => {
      await still(t.dest);
      await fsp.mkdir(path.dirname(t.abs), { recursive: true });
      // A folder of the upload that was a link elsewhere by now is refused like any other path.
      if (!allowed(t.dest.walls, await fsp.realpath(path.dirname(t.abs)))) fail("bad-path");
      return moveAcross(src, t.abs);
    });
    if (!placed) fail("exists", 409);
    refresh([key]);
    return { root: key, rel: t.rel };
  }

  async function trash(key, rels, { by = null } = {}) {
    const root = rootOf(key);
    const items = [];
    for (const rel of rels) items.push({ rel: (await resolve(key, rel, { mayBeRoot: false })).rel });
    if (!items.length) fail("nothing");
    const out = await trashItems(root, items, { kind: "file", action: "files-trash", by, name: items.length === 1 ? path.basename(items[0].rel) : null });
    refresh([key]);
    return out;
  }

  return { list, open, collect, mkdir, rename, move, trash, uploadTarget, place, rootOf, roots: () => roots().filter((r) => FILE_ROOT_KEYS.includes(r.key) && fs.existsSync(r.dir)) };
}
