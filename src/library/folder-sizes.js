/**
 * Folder sizes, kept between asks (the admin file browser's size column and details pane).
 * Each folder remembers its own files' bytes and count, its child folders and its mtime; asked again,
 * a folder whose mtime has not moved reuses that and only its child folders are looked at, so a repeat
 * costs one stat per folder below, not one per file. Adding, removing or renaming an entry moves its
 * folder's mtime; a file rewritten in place under the same name does not, and keeps its old size here
 * until something else in its folder changes.
 * Dot entries and symbolic links are left out, as is any path keep(abs) refuses (fenced folders).
 */
import fsp from "fs/promises";
import path from "path";

const STAT_BATCH = 32;

export function createFolderSizes() {
  const cache = new Map();
  const running = new Map();

  async function own(dir, mtimeMs, keep) {
    const dirents = (await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])).filter((d) => !d.name.startsWith("."));
    const kids = [];
    const files = [];
    for (const d of dirents) {
      const abs = path.join(dir, d.name);
      if (!keep(abs)) continue;
      if (d.isDirectory()) kids.push(abs);
      else if (d.isFile()) files.push(abs);
    }
    let bytes = 0;
    for (let i = 0; i < files.length; i += STAT_BATCH) {
      const st = await Promise.all(files.slice(i, i + STAT_BATCH).map((f) => fsp.lstat(f).catch(() => null)));
      for (const s of st) bytes += s?.size ?? 0;
    }
    const entry = { mtimeMs, bytes, files: files.length, kids };
    cache.set(dir, entry);
    return entry;
  }

  async function walk(dir, keep) {
    const st = await fsp.lstat(dir).catch(() => null);
    if (!st?.isDirectory()) {
      cache.delete(dir);
      return { bytes: 0, files: 0, dirs: 0 };
    }
    const hit = cache.get(dir);
    const e = hit && hit.mtimeMs === st.mtimeMs ? hit : await own(dir, st.mtimeMs, keep);
    const out = { bytes: e.bytes, files: e.files, dirs: e.kids.length };
    for (const kid of e.kids) {
      const t = await walk(kid, keep);
      out.bytes += t.bytes;
      out.files += t.files;
      out.dirs += t.dirs;
    }
    return out;
  }

  /** { bytes, files, dirs } under the folder `dir` (a real path); one walk at a time per folder. */
  function sizeOf(dir, keep = () => true) {
    if (!running.has(dir)) running.set(dir, walk(dir, keep).finally(() => running.delete(dir)));
    return running.get(dir);
  }

  return { sizeOf, forget: () => cache.clear() };
}
