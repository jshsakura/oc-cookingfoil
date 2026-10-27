/**
 * Resumable uploads for the admin page: a file goes up in pieces, each one a
 * request small enough for a tunnel that caps the body (100 MB on Cloudflare).
 * A piece is appended to `<id>.part`, `<id>.json` says what the file is. The id
 * comes from who sends what, so the same file picks up where it stopped after
 * a reload or a dropped connection. A partial belongs to the account that
 * started it: every call names the asker, and another account's id is unknown
 * to it. The route (routes/admin/upload-api.js) hands finished parts to the
 * same code that places a multipart upload.
 */
import crypto from "crypto";
import fsp from "fs/promises";
import express from "express";
import path from "path";
import { dataDir } from "../helpers/envs.js";
import { moveFile, safeRelPath } from "./library-upload.js";
import { actorOf } from "../library/trash-service.js";

/** The most bytes one piece may carry. */
export const MAX_CHUNK_BYTES = 32 * 1024 ** 2;
/** Space left free on the disk after a file is accepted. */
export const FREE_MARGIN_BYTES = 1024 ** 3;
/** A partial nobody has touched for this long is dropped. */
export const PARTIAL_MAX_AGE_MS = 24 * 3600_000;
export const ID_RE = /^[0-9a-f]{32}$/;
/** The largest "file" upload: the routes that take one (keys, images, a plugin zip, a retro patch) stay well under it. */
export const FILE_MAX_BYTES = 2 * 1024 ** 3;

export class ChunkError extends Error {
  constructor(status, key, vars = {}, extra = {}) {
    super(key);
    Object.assign(this, { status, key, vars, extra });
  }
}

// Ids with a piece being written: two writers would interleave.
const writing = new Set();

const statFree = async (dir) => {
  const st = await fsp.statfs(dir);
  return st.bavail * st.bsize;
};
let freeOf = statFree;
/** Bytes a disk can still give to this process. */
export const freeBytes = (dir) => freeOf(dir);
/** Test-only: how free space is read (null puts the real one back). */
export function _setFreeBytes(fn) {
  freeOf = fn ?? statFree;
}

/** Who a request is, as a partial records its owner: "admin:<name>" or "token:<label>". */
export const accountOf = (req) => {
  const a = actorOf(req);
  return `${a.type}:${a.name}`;
};

/** The id of one file sent by one person; the same file always gets the same id. */
export function chunkId({ account, kind, name, size, lastModified }) {
  return crypto.createHash("sha256").update(JSON.stringify([account, kind, name, size, lastModified])).digest("hex").slice(0, 32);
}

const partOf = (dir, id) => path.join(dir, `${id}.part`);
const infoOf = (dir, id) => path.join(dir, `${id}.json`);

/** Bytes held for `id`, or null when there is no such upload or it is not `account`'s. */
export async function offsetOf(dir, id, account) {
  if (!ID_RE.test(id)) return null;
  try {
    const info = JSON.parse(await fsp.readFile(infoOf(dir, id), "utf8"));
    if (info.account !== account) return null;
    return { ...info, offset: (await fsp.stat(partOf(dir, id))).size };
  } catch {
    return null;
  }
}

/** Starts (or finds) the upload of one file: { id, offset }. Refuses a file the disk cannot hold. */
export async function begin(dir, { account, kind, name, size, lastModified }) {
  const clean = safeRelPath(name);
  if (!clean || clean.includes("/") || !Number.isSafeInteger(size) || size < 0 || !Number.isSafeInteger(lastModified)) throw new ChunkError(400, "upload.badName");
  if (kind === FILE_KIND && size > FILE_MAX_BYTES) throw new ChunkError(413, "upload.chunkTooBig");
  const id = chunkId({ account, kind, name: clean, size, lastModified });
  await fsp.mkdir(dir, { recursive: true });
  const have = await offsetOf(dir, id, account);
  const held = have?.offset ?? 0;
  const free = await freeBytes(dir);
  if (size - held + FREE_MARGIN_BYTES > free) throw new ChunkError(507, "upload.noSpace", { need: gib(size - held + FREE_MARGIN_BYTES), free: gib(free) });
  if (have) await touch(dir, id);
  else {
    await fsp.writeFile(infoOf(dir, id), JSON.stringify({ kind, name: clean, size, account }));
    await fsp.writeFile(partOf(dir, id), "", { flag: "a" });
  }
  return { id, offset: held, size };
}

/** The info file is as fresh as the part, so a sweep never takes one of a pair first. */
const touch = (dir, id) => fsp.utimes(infoOf(dir, id), new Date(), new Date()).catch(() => {});

const gib = (n) => `${(n / 1024 ** 3).toFixed(1)} GiB`;

/** Appends `buf` at `offset` and syncs it; the new offset. A wrong offset is a 409 that names the real one. */
export async function append(dir, id, account, offset, buf) {
  const have = await offsetOf(dir, id, account);
  if (!have) throw new ChunkError(404, "upload.unknownChunk");
  if (buf.length > MAX_CHUNK_BYTES) throw new ChunkError(413, "upload.chunkTooBig");
  if (writing.has(id) || offset !== have.offset) throw new ChunkError(409, "upload.badOffset", {}, { offset: have.offset });
  if (have.offset + buf.length > have.size) throw new ChunkError(400, "upload.chunkTooBig");
  // begin() checked one file against the disk; many at once could still fill it, so every piece looks again.
  const free = await freeBytes(dir);
  if (buf.length + FREE_MARGIN_BYTES > free) throw new ChunkError(507, "upload.noSpace", { need: gib(buf.length + FREE_MARGIN_BYTES), free: gib(free) });
  writing.add(id);
  try {
    const fh = await fsp.open(partOf(dir, id), "a");
    try {
      await fh.write(buf);
      await fh.sync();
    } finally {
      await fh.close();
    }
  } catch (err) {
    if (err.code === "ENOSPC") throw new ChunkError(507, "upload.noSpace", { need: gib(buf.length), free: gib(0) });
    throw err;
  } finally {
    writing.delete(id);
  }
  await touch(dir, id);
  return have.offset + buf.length;
}

/** The part file of a complete upload, with its info; throws when the id is unknown or short. */
export async function completed(dir, id, account) {
  const have = await offsetOf(dir, id, account);
  if (!have) throw new ChunkError(404, "upload.unknownChunk");
  if (have.offset !== have.size) throw new ChunkError(409, "upload.incomplete", {}, { offset: have.offset });
  return { ...have, path: partOf(dir, id) };
}

/** Forgets `account`'s upload once its part has been handed on (or thrown away); another's stays. */
export async function discard(dir, id, account) {
  if (!ID_RE.test(id)) return;
  const info = await fsp.readFile(infoOf(dir, id), "utf8").then(JSON.parse, () => null);
  if (info?.account !== account) return;
  await fsp.rm(infoOf(dir, id), { force: true });
  await fsp.rm(partOf(dir, id), { force: true });
}

/** Removes the partials in `dir` nobody has touched for `maxAge` ms. */
export async function sweep(dir, maxAge = PARTIAL_MAX_AGE_MS, now = Date.now()) {
  for (const name of await fsp.readdir(dir).catch(() => [])) {
    const abs = path.join(dir, name);
    const st = await fsp.stat(abs).catch(() => null);
    if (st?.isFile() && now - st.mtimeMs > maxAge) await fsp.rm(abs, { force: true });
  }
}

/**
 * Where the chunked uploads that are not a library kind wait ("file": an image, a plugin zip, a keys file,
 * a patch). One file per request, taken by the route that wanted it with takeFile or rawOrChunk.
 */
export const FILE_KIND = "file";
export const fileChunksDir = () => path.join(dataDir, "upload-chunks");

/**
 * `account`'s finished upload `id` of the "file" kind, moved to `dest` (or read, with no `dest`); the partial
 * is gone after. The part is claimed by a rename first, so two requests naming one id never both get it.
 */
export async function takeFile(id, { account, dest = null, limit = Infinity } = {}) {
  const dir = fileChunksDir();
  const part = await completed(dir, String(id), account);
  const claimed = `${part.path}.taking-${crypto.randomBytes(4).toString("hex")}`;
  try {
    await fsp.rename(part.path, claimed);
  } catch {
    throw new ChunkError(404, "upload.unknownChunk");
  }
  try {
    await fsp.rm(infoOf(dir, id), { force: true });
    if (part.size > limit) throw new ChunkError(413, "upload.chunkTooBig");
    if (dest) await moveFile(claimed, dest);
    const bytes = dest ? null : await fsp.readFile(claimed);
    return { name: part.name, size: part.size, bytes };
  } finally {
    await fsp.rm(claimed, { force: true });
  }
}

/**
 * express.raw(opts), unless the request names a finished chunked upload in X-Chunk-Id: then that file is
 * the body. A refusal reaches `next` the way body-parser's do (`type: "entity.too.large"`).
 */
export function rawOrChunk(opts) {
  const raw = express.raw(opts);
  return async (req, res, next) => {
    const id = req.get("X-Chunk-Id");
    if (!id) return raw(req, res, next);
    try {
      req.body = (await takeFile(id, { account: accountOf(req), limit: opts.limit })).bytes;
      req._body = true;
      next();
    } catch (err) {
      next(Object.assign(err, { type: err.status === 413 ? "entity.too.large" : "entity.parse.failed" }));
    }
  };
}
