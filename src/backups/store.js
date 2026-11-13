/**
 * Consoles' own backups on disk, under COOK_BACKUPS_DIR (off while that folder does not exist):
 *
 *   <account>/blobs/<sha256 two>/<sha256>                       file bodies, one copy per account
 *   <account>/<platform>/units/<unit>/next                      the next version number of a unit
 *   <account>/<platform>/units/<unit>/<version>.json            { key, version, createdAt, bytes, by, manifest }
 *   <account>/<platform>/secrets/<unit>/<version>/<path id>     sealed secret files (backups/secrets.js)
 *   <account>/uploads/<id>/                                     uploads in progress (backups/uploads.js)
 *   <account>/removed/<when>-<rand>/<platform>/...              removed versions, kept REMOVED_KEEP_MS
 *
 * <account> and <unit> are hashes (account.js accountFolder, unitFolder below), so no name, address or title is
 * written on the disk. Bodies are stored by their sha256 and shared by every version and unit of the account;
 * a body no version, removed version or upload refers to any more is swept. Secret files are never stored by a
 * hash of what is in them.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import * as envs from "../helpers/envs.js";
import { accountFolder } from "./account.js";
import { backupKeyId } from "../security/secret-box.js";
import debug from "../debug.js";

export const REMOVED_KEEP_MS = 30 * 24 * 3600_000;
const SHA256_RE = /^[0-9a-f]{64}$/;

export class BackupError extends Error {
  constructor(status, code, extra = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const inside = (dir, root) => dir === root || dir.startsWith(root + path.sep);
let warned = false;

// The check value of the key secrets are sealed with, kept beside the backups. The server writes it the first
// time backups are on and turns backups off when its key is another; the import tool only compares
// (compareKeyOnly), so a tool run with a stray key can never set the value.
const CHECK_FILE = ".key-check";
let writeKeyCheck = true;
const checked = new Map();

/** For the import tool: the key check is read and compared, never written. */
export function compareKeyOnly() {
  writeKeyCheck = false;
  checked.clear();
}

function keyState(root) {
  const file = path.join(root, CHECK_FILE);
  const id = backupKeyId();
  let kept = "";
  try {
    kept = fs.readFileSync(file, "utf8").trim();
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  if (kept) return kept === id ? "ok" : "key-mismatch";
  if (!writeKeyCheck) return "key-missing";
  try {
    fs.writeFileSync(file, `${id}\n`, { mode: 0o600, flag: "wx" });
  } catch (err) {
    // Another process wrote it first: its value is the one to agree with.
    if (err.code !== "EEXIST") throw err;
    return fs.readFileSync(file, "utf8").trim() === id ? "ok" : "key-mismatch";
  }
  return "ok";
}

/**
 * Whether backups are on: { root } when they are, else { root: null, reason }. Off when there is no setting
 * ("unset"), the folder is missing ("missing"), it lies in one of the server's own folders, the library or the
 * data folder, where the file explorer, the trash and the server's own backup would show it ("inside"), or
 * the server's key is not the one the backups were sealed with ("key-mismatch"; "key-missing" for the tool).
 */
export function backupsCheck() {
  const dir = envs.backupsDir;
  if (!dir) return { root: null, reason: "unset" };
  let real;
  try {
    real = fs.realpathSync(dir);
    if (!fs.statSync(real).isDirectory()) return { root: null, reason: "missing" };
  } catch {
    return { root: null, reason: "missing" };
  }
  const clash = Object.values(envs.layout.dirs).filter(Boolean).some((d) => {
    let r = path.resolve(d);
    try {
      r = fs.realpathSync(d);
    } catch { /* a folder not made yet */ }
    return inside(real, r);
  });
  if (clash) {
    if (!warned) debug.error("backups: COOK_BACKUPS_DIR lies inside one of the server's own folders; backups stay off");
    warned = true;
    return { root: null, reason: "inside" };
  }
  if (!checked.has(real)) {
    let state;
    try {
      state = keyState(real);
    } catch (err) {
      debug.error("backups: the key check could not be read or written (%s); backups stay off", err.code ?? err.name);
      state = "key-unreadable";
    }
    if (state === "key-mismatch") debug.error("backups: COOK_SECRET_KEY is not the key these backups were sealed with; backups stay off");
    checked.set(real, state);
  }
  const state = checked.get(real);
  return state === "ok" ? { root: real } : { root: null, reason: state };
}

/** The backups folder, or null while backups are off (backupsCheck says why). */
export const backupsRoot = () => backupsCheck().root;

function requireRoot() {
  const root = backupsRoot();
  if (!root) throw new BackupError(404, "backups-off");
  return root;
}

export const unitFolder = (key) => crypto.createHash("sha256").update(`unit\0${key}`).digest("hex").slice(0, 32);
export const accountDir = (accountId) => path.join(requireRoot(), accountFolder(accountId));
const unitDir = (accountId, platform, key) => path.join(accountDir(accountId), platform, "units", unitFolder(key));
export const secretDir = (accountId, platform, key, version) => path.join(accountDir(accountId), platform, "secrets", unitFolder(key), String(version));
export const uploadsDir = (accountId) => path.join(accountDir(accountId), "uploads");

/** Where the body with `sha256` is kept for an account. */
export function blobPath(accountId, sha256) {
  if (!SHA256_RE.test(sha256)) throw new BackupError(400, "manifest");
  return path.join(accountDir(accountId), "blobs", sha256.slice(0, 2), sha256);
}

export const hasBlob = (accountId, sha256) => fs.existsSync(blobPath(accountId, sha256));

// One change at a time per account folder: versions, removals and the sweep of unused bodies.
const queues = new Map();
export function serial(folder, fn) {
  const prev = queues.get(folder) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => {});
  queues.set(folder, tail);
  tail.then(() => queues.get(folder) === tail && queues.delete(folder));
  return run;
}

async function readJson(file) {
  try {
    return JSON.parse(await fsp.readFile(file, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

async function writeAtomic(file, text) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  await fsp.writeFile(tmp, text);
  await fsp.rename(tmp, file);
}

const versionFiles = async (dir) => {
  const names = await fsp.readdir(dir).catch((err) => (err.code === "ENOENT" ? [] : Promise.reject(err)));
  return names.filter((n) => /^\d+\.json$/.test(n)).map((n) => Number(n.slice(0, -5))).sort((a, b) => b - a);
};

/** A unit's versions, newest first: { version, createdAt, bytes, by, manifest }. */
export async function unitVersions(accountId, platform, key) {
  const dir = unitDir(accountId, platform, key);
  const out = [];
  for (const v of await versionFiles(dir)) {
    const rec = await readJson(path.join(dir, `${v}.json`));
    if (rec?.key === key) out.push({ version: rec.version, createdAt: rec.createdAt, bytes: rec.bytes, by: rec.by, manifest: rec.manifest });
  }
  return out;
}

/** Every unit of an account on a platform, as the console's list shows them. */
export async function listUnits(accountId, platform) {
  const base = path.join(accountDir(accountId), platform, "units");
  const dirs = await fsp.readdir(base).catch((err) => (err.code === "ENOENT" ? [] : Promise.reject(err)));
  const out = [];
  for (const d of dirs.sort()) {
    const versions = await versionFiles(path.join(base, d));
    if (!versions.length) continue;
    const rec = await readJson(path.join(base, d, `${versions[0]}.json`));
    if (!rec?.manifest) continue;
    const m = rec.manifest;
    out.push({
      key: rec.key, kind: m.kind, unit: m.unit, title: m.title, version: m.version, category: m.category,
      latest: rec.version, versions: versions.length, bytes: rec.bytes, files: m.files.length, secrets: m.secrets.length,
      updatedAt: rec.createdAt,
    });
  }
  return out.sort((a, b) => Buffer.compare(Buffer.from(a.key), Buffer.from(b.key)));
}

/** The next version of a unit, taken now so an upload knows it from its start; never handed out twice. */
export function takeVersion(accountId, platform, key) {
  return serial(accountFolder(accountId), async () => {
    const dir = unitDir(accountId, platform, key);
    const kept = Number((await fsp.readFile(path.join(dir, "next"), "utf8").catch(() => "")).trim()) || 0;
    const newest = (await versionFiles(dir))[0] ?? 0;
    const version = Math.max(kept, newest + 1, 1);
    await writeAtomic(path.join(dir, "next"), `${version + 1}\n`);
    return version;
  });
}

/** The manifest of the newest version, as text, or null: an import that would add the same skips it. */
export async function latestManifestText(accountId, platform, key) {
  const [latest] = await unitVersions(accountId, platform, key);
  return latest ? JSON.stringify(latest.manifest) : null;
}

/**
 * Records `version` of a unit once every body is in place, then moves the versions past the kept count to the
 * removed folder. Returns the version.
 */
export function commitVersion(accountId, platform, key, version, manifest, by) {
  return serial(accountFolder(accountId), async () => {
    const missing = manifest.files.filter((f) => !hasBlob(accountId, f.sha256)).map((f) => f.path);
    if (missing.length) throw new BackupError(422, "mismatch", { paths: missing });
    const bytes = [...manifest.files, ...manifest.secrets].reduce((n, f) => n + f.size, 0);
    const rec = { key, version, createdAt: Date.now(), bytes, by: { label: String(by?.label ?? "") }, manifest };
    const dir = unitDir(accountId, platform, key);
    await writeAtomic(path.join(dir, `${version}.json`), JSON.stringify(rec));
    const surplus = (await versionFiles(dir)).slice(envs.consoleBackupKeep);
    if (surplus.length) await moveToRemoved(accountId, platform, key, surplus);
    return version;
  });
}

async function moveToRemoved(accountId, platform, key, versions) {
  const stamp = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const from = unitDir(accountId, platform, key);
  const to = path.join(accountDir(accountId), "removed", stamp, platform, "units", unitFolder(key));
  await fsp.mkdir(to, { recursive: true });
  for (const v of versions) {
    await fsp.rename(path.join(from, `${v}.json`), path.join(to, `${v}.json`));
    const secrets = secretDir(accountId, platform, key, v);
    if (fs.existsSync(secrets)) {
      const into = path.join(accountDir(accountId), "removed", stamp, platform, "secrets", unitFolder(key), String(v));
      await fsp.mkdir(path.dirname(into), { recursive: true });
      await fsp.rename(secrets, into);
    }
  }
}

/** Moves one version, or every version, of a unit to the removed folder. False when there was nothing. */
export function removeUnit(accountId, platform, key, version = null) {
  return serial(accountFolder(accountId), async () => {
    const all = await versionFiles(unitDir(accountId, platform, key));
    const chosen = version == null ? all : all.filter((v) => v === version);
    if (!chosen.length) return false;
    await moveToRemoved(accountId, platform, key, chosen);
    return true;
  });
}

async function* jsonFiles(dir) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return;
    throw err;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* jsonFiles(p);
    else if (e.isFile() && e.name.endsWith(".json")) yield p;
  }
}

/**
 * In one account folder: deletes removed versions past REMOVED_KEEP_MS, then the bodies nothing refers to any more (a version, a
 * removed version or an upload in progress). Returns how many bodies went and their bytes.
 */
export function sweepFolder(folder, now = Date.now()) {
  return serial(folder, async () => {
    const dir = path.join(requireRoot(), folder);
    const removed = path.join(dir, "removed");
    for (const name of await fsp.readdir(removed).catch(() => [])) {
      const at = Number(name.split("-")[0]);
      if (Number.isFinite(at) && now - at > REMOVED_KEEP_MS) await fsp.rm(path.join(removed, name), { recursive: true, force: true });
    }
    const used = new Set();
    for (const top of await fsp.readdir(dir).catch(() => [])) {
      if (top === "blobs") continue;
      for await (const file of jsonFiles(path.join(dir, top))) {
        const rec = await readJson(file).catch(() => null);
        for (const f of rec?.manifest?.files ?? []) used.add(f.sha256);
      }
    }
    let count = 0;
    let bytes = 0;
    const blobs = path.join(dir, "blobs");
    for (const two of await fsp.readdir(blobs).catch(() => [])) {
      for (const sha of await fsp.readdir(path.join(blobs, two)).catch(() => [])) {
        if (used.has(sha)) continue;
        const file = path.join(blobs, two, sha);
        const st = await fsp.stat(file).catch(() => null);
        if (!st?.isFile()) continue;
        await fsp.rm(file, { force: true });
        count++;
        bytes += st.size;
      }
    }
    return { count, bytes };
  });
}

/** The bytes an account's backups hold on the disk (bodies and sealed secrets). */
export async function usedBytes(accountId) {
  let total = 0;
  const walk = async (d) => {
    for (const e of await fsp.readdir(d, { withFileTypes: true }).catch(() => [])) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) total += (await fsp.stat(p).catch(() => ({ size: 0 }))).size;
    }
  };
  const dir = accountDir(accountId);
  await walk(path.join(dir, "blobs"));
  for (const top of await fsp.readdir(dir).catch(() => [])) if (top !== "blobs" && top !== "uploads" && top !== "removed") await walk(path.join(dir, top, "secrets"));
  return total;
}

/** Every account folder under the backups folder (for the sweep). */
export async function accountFolders() {
  const root = backupsRoot();
  if (!root) return [];
  return (await fsp.readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory() && /^[0-9a-f]{32}$/.test(e.name)).map((e) => e.name);
}
