/**
 * One backup going up: begin names the files the server lacks, PUT sends each from where it stopped, finish
 * checks every size and sha256 and only then makes the version. An upload is the account's, for one unit, and
 * goes after UPLOAD_MAX_AGE_MS untouched.
 *
 * Secret files (work.bin, .rif, license.db) come in one PUT each, whole and small, are sealed in memory the
 * moment they arrive and touch the disk only sealed. They are never stored by, or compared with, a hash of what
 * is in them.
 */
import zlib from "node:zlib";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
import * as envs from "../helpers/envs.js";
import { normalizeManifest } from "./manifest.js";
import * as store from "./store.js";
import { sealSecret, secretName, secretPlace } from "./secrets.js";

const { BackupError } = store;
export const UPLOAD_MAX_AGE_MS = 24 * 3600_000;
export const SECRET_MAX_BYTES = 16 * 1024 ** 2;
export const PUT_MAX_BYTES = 64 * 1024 ** 2;
const ID_RE = /^[0-9a-f]{32}$/;

const metaFile = (accountId, id) => path.join(store.uploadsDir(accountId), id, "upload.json");
const partFile = (accountId, id, sha256) => path.join(store.uploadsDir(accountId), id, `${sha256}.part`);
const sealedFile = (accountId, id, file) => path.join(store.uploadsDir(accountId), id, secretName(file));

async function readMeta(accountId, platform, id) {
  if (!ID_RE.test(String(id))) throw new BackupError(410, "upload");
  const meta = await fsp.readFile(metaFile(accountId, id), "utf8").then(JSON.parse).catch(() => null);
  if (!meta || meta.platform !== platform || Date.now() - meta.touchedAt > UPLOAD_MAX_AGE_MS) throw new BackupError(410, "upload");
  return meta;
}

const writeMeta = (accountId, meta) => fsp.writeFile(metaFile(accountId, meta.id), JSON.stringify(meta));

async function activeUploadFor(accountId, platform, key) {
  const dir = store.uploadsDir(accountId);
  for (const id of await fsp.readdir(dir).catch(() => [])) {
    const meta = await fsp.readFile(path.join(dir, id, "upload.json"), "utf8").then(JSON.parse).catch(() => null);
    if (meta?.platform === platform && meta.key === key && Date.now() - meta.touchedAt <= UPLOAD_MAX_AGE_MS) return meta;
  }
  return null;
}

/**
 * Starts an upload of `key` with the console's manifest. `need` lists one path for each body the account does
 * not hold yet; `needSecrets` lists every secret file. With `checkQuota`, the bodies it needs must fit what the
 * account may still hold. `by` is the console's label, kept with the version.
 */
export async function begin({ accountId, platform, key, manifest: raw, by, checkQuota = true }) {
  const manifest = normalizeManifest(platform, key, raw);
  if (!manifest) throw new BackupError(400, "manifest");
  return store.serial(`upload\0${accountId}\0${platform}\0${key}`, async () => {
    if (await activeUploadFor(accountId, platform, key)) throw new BackupError(409, "busy");
    const need = [];
    const wanted = new Set();
    for (const f of manifest.files) {
      if (wanted.has(f.sha256) || store.hasBlob(accountId, f.sha256)) continue;
      wanted.add(f.sha256);
      need.push({ path: f.path, size: f.size });
    }
    const quota = envs.consoleBackupQuotaBytes;
    if (checkQuota && quota > 0) {
      const adding = need.reduce((n, f) => n + f.size, 0) + manifest.secrets.reduce((n, f) => n + f.size, 0);
      if ((await store.usedBytes(accountId)) + adding > quota) throw new BackupError(507, "quota");
    }
    const version = await store.takeVersion(accountId, platform, key);
    const id = crypto.randomBytes(16).toString("hex");
    const now = Date.now();
    const meta = { id, platform, key, version, manifest, need, by: { label: String(by?.label ?? "").slice(0, 64) }, createdAt: now, touchedAt: now };
    await fsp.mkdir(path.dirname(metaFile(accountId, id)), { recursive: true });
    await writeMeta(accountId, meta);
    return { upload: id, need, needSecrets: manifest.secrets.map((f) => ({ path: f.path, size: f.size })) };
  });
}

const fileOf = (meta, file) => meta.manifest.files.find((f) => f.path === file && meta.need.some((n) => n.path === file));
const secretOf = (meta, file) => meta.manifest.secrets.find((f) => f.path === file);
const sizeOf = async (file) => (await fsp.stat(file).catch(() => null))?.size ?? 0;

/** How much of a file the server holds for an upload: the bytes received in a row, or the whole of a secret. */
export async function received({ accountId, platform, id, file }) {
  const meta = await readMeta(accountId, platform, id);
  const body = fileOf(meta, file);
  if (body) return sizeOf(partFile(accountId, id, body.sha256));
  const secret = secretOf(meta, file);
  if (secret) return fs.existsSync(sealedFile(accountId, id, file)) ? secret.size : 0;
  throw new BackupError(400, "path");
}

/** Reads a request body into memory, refusing past `max` bytes. */
function bodyOf(req, max) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let n = 0;
    let settled = false;
    // What came in is wiped once it is copied out or given up, so no stray copy of a secret stays in memory.
    const wipe = () => {
      for (const p of parts) p.fill(0);
      parts.length = 0;
    };
    const fail = (err) => {
      if (settled) return;
      settled = true;
      wipe();
      reject(err);
    };
    req.on("data", (c) => {
      if (settled) return c.fill(0);
      n += c.length;
      if (n > max) {
        c.fill(0);
        req.destroy();
        fail(new BackupError(413, "size"));
      } else parts.push(c);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      const body = Buffer.concat(parts, n);
      wipe();
      resolve(body);
    });
    req.on("error", fail);
    req.on("close", () => fail(new BackupError(400, "size")));
  });
}

/** Writes a request body onto the end of `file`, refusing a body past `max` bytes; whatever came before stays. */
async function appendBody(req, file, max) {
  const declared = Number(req.get("content-length"));
  if (Number.isFinite(declared) && declared > max) throw new BackupError(413, "size");
  let n = 0;
  await pipeline(req, async function* (source) {
    for await (const chunk of source) {
      n += chunk.length;
      if (n > max) throw new BackupError(413, "size");
      yield chunk;
    }
  }, fs.createWriteStream(file, { flags: "a" }));
  return n;
}

/** One PUT: the bytes of `file` from `offset`. Returns the bytes the server now holds of it. */
export async function put({ accountId, platform, id, file, offset, req }) {
  const meta = await readMeta(accountId, platform, id);
  const secret = secretOf(meta, file);
  if (secret) {
    if (offset !== 0) throw new BackupError(409, "offset", { received: 0 });
    if (secret.size > SECRET_MAX_BYTES) throw new BackupError(413, "size");
    const plain = await bodyOf(req, secret.size);
    if (plain.length !== secret.size) {
      plain.fill(0);
      throw new BackupError(422, "mismatch", { paths: [file] });
    }
    const sealed = sealSecret(plain, secretPlace(accountId, platform, meta.key, meta.version, file));
    plain.fill(0);
    const to = sealedFile(accountId, id, file);
    await fsp.writeFile(`${to}.tmp`, sealed);
    await fsp.rename(`${to}.tmp`, to);
    await writeMeta(accountId, { ...meta, touchedAt: Date.now() });
    return secret.size;
  }
  const body = fileOf(meta, file);
  if (!body) throw new BackupError(400, "path");
  const part = partFile(accountId, id, body.sha256);
  const have = await sizeOf(part);
  if (offset !== have) throw new BackupError(409, "offset", { received: have });
  try {
    await appendBody(req, part, Math.min(PUT_MAX_BYTES, body.size - have));
  } catch (err) {
    // A piece cut short or too long is taken back to where it began.
    await fsp.truncate(part, have).catch(() => {});
    throw err;
  }
  await writeMeta(accountId, { ...meta, touchedAt: Date.now() });
  return sizeOf(part);
}

// A piece's sha256 and CRC-32, from one read.
async function digestOf(file) {
  const hash = crypto.createHash("sha256");
  let crc = 0;
  for await (const chunk of fs.createReadStream(file, { highWaterMark: 4 * 1024 ** 2 })) {
    hash.update(chunk);
    crc = zlib.crc32(chunk, crc);
  }
  return { sha256: hash.digest("hex"), crc };
}

/**
 * Checks every body and secret of an upload and makes its version. A body whose size or sha256 is off is
 * dropped and named in a 422 (send it again); so is one the account lost meanwhile, which joins the upload's
 * list. Returns { key, version }.
 */
export async function finish({ accountId, platform, id }) {
  const meta = await readMeta(accountId, platform, id);
  const bad = [];
  for (const n of meta.need) {
    const f = fileOf(meta, n.path);
    const part = partFile(accountId, id, f.sha256);
    if (store.hasBlob(accountId, f.sha256)) {
      await fsp.rm(part, { force: true });
      continue;
    }
    const digest = (await sizeOf(part)) === f.size ? await digestOf(part) : null;
    if (digest?.sha256 !== f.sha256) {
      await fsp.rm(part, { force: true });
      bad.push(n.path);
      continue;
    }
    const blob = store.blobPath(accountId, f.sha256);
    await fsp.mkdir(path.dirname(blob), { recursive: true });
    await store.noteBlobCrc(accountId, f.sha256, digest.crc);
    await fsp.rename(part, blob);
  }
  const lost = meta.manifest.files.filter((f) => !store.hasBlob(accountId, f.sha256) && !meta.need.some((n) => n.path === f.path));
  const missingSecrets = meta.manifest.secrets.filter((f) => !fs.existsSync(sealedFile(accountId, id, f.path))).map((f) => f.path);
  if (bad.length || lost.length || missingSecrets.length) {
    const need = [...meta.need, ...lost.map((f) => ({ path: f.path, size: f.size }))];
    await writeMeta(accountId, { ...meta, need, touchedAt: Date.now() });
    throw new BackupError(422, "mismatch", { paths: [...bad, ...lost.map((f) => f.path), ...missingSecrets] });
  }
  const into = store.secretDir(accountId, platform, meta.key, meta.version);
  if (meta.manifest.secrets.length) await fsp.mkdir(into, { recursive: true });
  for (const f of meta.manifest.secrets) await fsp.rename(sealedFile(accountId, id, f.path), path.join(into, secretName(f.path)));
  const version = await store.commitVersion(accountId, platform, meta.key, meta.version, meta.manifest, meta.by);
  await fsp.rm(path.dirname(metaFile(accountId, id)), { recursive: true, force: true });
  return { key: meta.key, version };
}

/** Drops an account's uploads untouched for UPLOAD_MAX_AGE_MS, sealed secrets and pieces with them. */
export async function sweepUploads(folderDir, now = Date.now()) {
  const dir = path.join(folderDir, "uploads");
  for (const id of await fsp.readdir(dir).catch(() => [])) {
    const meta = await fsp.readFile(path.join(dir, id, "upload.json"), "utf8").then(JSON.parse).catch(() => null);
    if (!meta || now - meta.touchedAt > UPLOAD_MAX_AGE_MS) await fsp.rm(path.join(dir, id), { recursive: true, force: true });
  }
}
