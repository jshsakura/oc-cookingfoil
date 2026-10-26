/**
 * Packs an installed plugin folder into a zip that the install upload takes back unchanged.
 *
 *   packPlugin(dir) -> yazl ZipFile   (its outputStream is the zip; the caller pipes it)
 *
 * Only regular files are packed: no symlinks or special files, no node_modules, and not the folder's
 * own data/ (a cache the plugin keeps). Settings and secrets live outside the folder and are not
 * here. A folder that the upload limits would refuse is refused here too, so a download never makes
 * a zip that cannot go back in.
 */
import fs from "node:fs";
import path from "node:path";
import yazl from "yazl";
import { UNPACK_LIMITS } from "./unpack.js";

export class PackError extends Error {
  constructor(code) {
    super(code);
    this.name = "PackError";
    this.code = code;
  }
}

const SKIP_DIRS = new Set(["node_modules"]);
const SKIP_TOP = new Set(["data"]);
const JUNK_RE = /^(?:\.DS_Store|Thumbs\.db)$/;

async function walk(root, rel, found) {
  const entries = await fs.promises.readdir(path.join(root, ...rel), { withFileTypes: true });
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (e.isSymbolicLink() || JUNK_RE.test(e.name)) continue;
    const next = [...rel, e.name];
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || (rel.length === 0 && SKIP_TOP.has(e.name))) continue;
      if (next.length > UNPACK_LIMITS.depth - 1) throw new PackError("too-deep");
      await walk(root, next, found);
    } else if (e.isFile()) {
      const name = next.join("/");
      if (name.length > UNPACK_LIMITS.nameLength) throw new PackError("too-large");
      const size = (await fs.promises.lstat(path.join(root, ...next))).size;
      found.files.push({ name, size });
      found.bytes += size;
      if (size > UNPACK_LIMITS.fileBytes || found.bytes > UNPACK_LIMITS.totalBytes || found.files.length > UNPACK_LIMITS.entries) throw new PackError("too-large");
    }
  }
}

export async function packPlugin(dir) {
  const real = await fs.promises.realpath(dir);
  const found = { files: [], bytes: 0 };
  await walk(real, [], found);
  const zip = new yazl.ZipFile();
  for (const f of found.files) zip.addFile(path.join(real, ...f.name.split("/")), f.name, { mode: 0o100644 });
  zip.end();
  return zip;
}
