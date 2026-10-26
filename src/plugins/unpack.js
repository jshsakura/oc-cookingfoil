/**
 * Unpacks a plugin zip into an empty folder, or refuses it whole and leaves nothing behind.
 *
 *   unpackPlugin(zip, destDir, limits?) -> Promise<{ manifest, files, bytes }>   rejects with UnpackError(code)
 *
 * The zip is an upload from the admin page: its names and sizes are the uploader's claims, so every one
 * is checked here before a byte is written, and the bytes actually written are counted (a header that
 * understates its entry cannot get past the limits). The result is not installed: the caller decides
 * whether the folder goes into data/plugins.
 *
 * Refused: absolute names, "..", backslashes, drive letters, NUL, symlinks and other special entries,
 * names that differ only in case, encrypted entries, methods other than stored and deflate, too many
 * entries, too deep or too long names, a file or a total over its limit, and a zip with no usable
 * plugin.json and index.js. One top folder around everything is taken off.
 */
import fs from "node:fs";
import path from "node:path";
import yauzl from "yauzl";
import { ENTRY_FILE, MANIFEST_FILE } from "./loader.js";
import { API_VERSION, MAX_MANIFEST_BYTES, parseManifest } from "./manifest.js";

export const UNPACK_LIMITS = Object.freeze({
  zipBytes: 32 * 1024 * 1024,
  entries: 500,
  fileBytes: 32 * 1024 * 1024,
  totalBytes: 64 * 1024 * 1024,
  nameLength: 240,
  depth: 8,
});

export class UnpackError extends Error {
  constructor(code, detail = "") {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "UnpackError";
    this.code = code;
  }
}

const S_IFMT = 0xf000;
const S_IFREG = 0x8000;
const S_IFDIR = 0x4000;
const UNIX = 3;
const JUNK_RE = /^(?:__MACOSX\/|(?:.*\/)?\.DS_Store$)/;

const openZip = (buffer) => new Promise((resolve, reject) => {
  yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true, strictFileNames: false }, (err, zip) => (err ? reject(new UnpackError("bad-zip", err.message)) : resolve(zip)));
});

function readEntries(zip, limits) {
  return new Promise((resolve, reject) => {
    const entries = [];
    zip.on("error", (err) => reject(err instanceof UnpackError ? err : new UnpackError("bad-zip", err.message)));
    zip.on("end", () => resolve(entries));
    zip.on("entry", (entry) => {
      try {
        const checked = checkEntry(entry, limits);
        if (checked) entries.push(checked);
        if (entries.length > limits.entries) throw new UnpackError("too-many-entries");
        zip.readEntry();
      } catch (err) {
        reject(err);
      }
    });
    zip.readEntry();
  });
}

/** The entry as { name, isDir, entry }, or null for what is silently skipped; throws what is refused. */
function checkEntry(entry, limits) {
  const name = entry.fileName;
  if (JUNK_RE.test(name)) return null;
  if (entry.isEncrypted()) throw new UnpackError("encrypted", name);
  if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) throw new UnpackError("bad-method", name);
  if (name.length === 0 || name.length > limits.nameLength) throw new UnpackError("bad-name", "length");
  if (name.includes("\0") || name.includes("\\") || name.startsWith("/") || /^[A-Za-z]:/.test(name)) throw new UnpackError("bad-name", name);
  const isDir = name.endsWith("/");
  const parts = (isDir ? name.slice(0, -1) : name).split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) throw new UnpackError("bad-name", name);
  if (parts.length > limits.depth) throw new UnpackError("too-deep", name);
  if (entry.versionMadeBy >> 8 === UNIX) {
    const type = (entry.externalFileAttributes >>> 16) & S_IFMT;
    if (type !== 0 && type !== (isDir ? S_IFDIR : S_IFREG)) throw new UnpackError("special-entry", name);
  }
  if (!isDir && entry.uncompressedSize > limits.fileBytes) throw new UnpackError("file-too-large", name);
  return { name, parts, isDir, entry };
}

/** The names with the one folder that holds everything taken off; null when there is none to take off. */
function wrapperOf(entries) {
  const roots = new Set(entries.map((e) => e.parts[0]));
  if (roots.size !== 1) return null;
  const [root] = roots;
  return entries.every((e) => e.parts.length > 1 || e.isDir) && entries.some((e) => !e.isDir && e.parts.join("/") === `${root}/${MANIFEST_FILE}`) ? root : null;
}

const inside = (parent, child) => child === parent || child.startsWith(parent + path.sep);

function copyEntry(zip, item, target, limits, spent) {
  return new Promise((resolve, reject) => {
    zip.openReadStream(item.entry, (err, stream) => {
      if (err) return reject(new UnpackError("bad-zip", err.message));
      const out = fs.createWriteStream(target, { flags: "wx", mode: 0o644 });
      let size = 0;
      const fail = (error) => { stream.destroy(); out.destroy(); reject(error instanceof UnpackError ? error : new UnpackError("bad-zip", error.message)); };
      stream.on("data", (chunk) => {
        size += chunk.length;
        spent.bytes += chunk.length;
        if (size > limits.fileBytes) fail(new UnpackError("file-too-large", item.name));
        else if (spent.bytes > limits.totalBytes) fail(new UnpackError("too-large"));
      });
      stream.on("error", fail);
      out.on("error", fail);
      out.on("finish", () => resolve(size));
      stream.pipe(out);
    });
  });
}

/**
 * zip: a Buffer. destDir: a folder that does not exist yet or is empty; on a refusal it is removed.
 * Resolves { manifest, files, bytes }.
 */
export async function unpackPlugin(zip, destDir, limits = UNPACK_LIMITS) {
  const lim = { ...UNPACK_LIMITS, ...limits };
  if (!Buffer.isBuffer(zip) || zip.length === 0) throw new UnpackError("bad-zip", "empty");
  if (zip.length > lim.zipBytes) throw new UnpackError("zip-too-large");
  let opened;
  try {
    opened = await openZip(zip);
    const entries = await readEntries(opened, lim);
    if (!entries.length) throw new UnpackError("no-manifest");
    const lower = new Set();
    for (const e of entries) {
      const key = e.name.toLowerCase();
      if (lower.has(key)) throw new UnpackError("duplicate-name", e.name);
      lower.add(key);
    }
    const wrapper = wrapperOf(entries);
    const strip = wrapper ? 1 : 0;

    await fs.promises.mkdir(destDir, { recursive: true, mode: 0o755 });
    const realDest = await fs.promises.realpath(destDir);
    const spent = { bytes: 0 };
    let files = 0;
    for (const item of entries) {
      const rel = item.parts.slice(strip);
      if (!rel.length) continue;
      const target = path.resolve(realDest, ...rel);
      if (!inside(realDest, target)) throw new UnpackError("bad-name", item.name);
      if (item.isDir) {
        await fs.promises.mkdir(target, { recursive: true, mode: 0o755 });
        continue;
      }
      await fs.promises.mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
      // The folder is ours and was just made, but the check costs nothing and is the one that would catch a link.
      if (!inside(realDest, await fs.promises.realpath(path.dirname(target)))) throw new UnpackError("bad-name", item.name);
      await copyEntry(opened, item, target, lim, spent);
      files++;
    }
    return { ...(await readManifest(realDest)), files, bytes: spent.bytes };
  } catch (err) {
    await fs.promises.rm(destDir, { recursive: true, force: true });
    throw err instanceof UnpackError ? err : new UnpackError("bad-zip", err.message);
  } finally {
    opened?.close();
  }
}

async function readManifest(dir) {
  const manifestFile = path.join(dir, MANIFEST_FILE);
  const st = await fs.promises.lstat(manifestFile).catch(() => null);
  if (!st?.isFile()) throw new UnpackError("no-manifest");
  if (st.size > MAX_MANIFEST_BYTES) throw new UnpackError("manifest-too-large");
  const index = await fs.promises.lstat(path.join(dir, ENTRY_FILE)).catch(() => null);
  if (!index?.isFile()) throw new UnpackError("no-index");
  const text = await fs.promises.readFile(manifestFile, "utf8");
  let apiVersion;
  try { apiVersion = JSON.parse(text)?.apiVersion; } catch { /* parseManifest says bad-json */ }
  if (Number.isInteger(apiVersion) && apiVersion >= 1 && apiVersion !== API_VERSION) throw new UnpackError("incompatible", String(apiVersion));
  const parsed = parseManifest(text);
  if (!parsed.ok) throw new UnpackError("bad-manifest", parsed.problems.join(","));
  return { manifest: parsed.manifest };
}
