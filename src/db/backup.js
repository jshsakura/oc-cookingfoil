/**
 * Daily backups of what cannot be made again, in ${COOK_DATA_DIR}/backups/<YYYY-MM-DD>/:
 *
 *   security.db       accounts, consoles, tokens, settings, the audit log and the
 *                     refusals, sealed secrets as they are (VACUUM INTO: a whole,
 *                     consistent copy while the server runs)
 *   *.json            the logs and hand-kept files: downloads, alerts, the NSZ
 *                     queue, descriptions, names, featured rows, homebrew sources,
 *                     the patch notes
 *   extracted-meta/   names fixed by hand
 *   custom-art/       artwork uploaded by hand
 *
 * Left out, as they come back by themselves: the library, the index
 * (cookingfoil.db), titledb, images and every other cache.
 *
 * A day's folder is written beside its place and renamed in, so a backup is
 * there whole or not at all; a second one the same day replaces the first.
 * Folders older than `backupDays` are removed. Everything is the server's
 * account's only (0700 folders, 0600 files): the copy holds the same hashes
 * and sealed secrets as the original.
 */
import fs from "fs";
import path from "path";
import debug from "../debug.js";
import * as env from "../helpers/envs.js";
import { securityDb } from "./database.js";
import * as activity from "../tasks/activity.js";

export const BACKUP_DIR = "backups";
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
// Files at the top of the data folder that are only caches.
const CACHES = new Set(["patches-cache.json"]);
// Folders copied whole.
const FOLDERS = ["extracted-meta", "custom-art"];
// Folders whose own top-level .json files are copied (not their subfolders).
const JSON_FOLDERS = [".", "security", "homebrew", "patches"];
// How often the schedule looks whether today's backup is there.
const CHECK_MS = 60 * 60_000;

const root = () => path.join(env.dataDir, BACKUP_DIR);

/** The local date of `at` as YYYY-MM-DD. Pure. */
export function dayOf(at) {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The .json files directly in `dir` (relative to the data folder), caches left out. */
function jsonFiles(dir) {
  try {
    return fs.readdirSync(path.join(env.dataDir, dir), { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".json") && !(dir === "." && CACHES.has(e.name)))
      .map((e) => path.join(dir, e.name));
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

/** Copies `rel` from the data folder into `into`, 0600; false when it is not there. */
function copyOne(rel, into) {
  const to = path.join(into, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true, mode: 0o700 });
  try {
    fs.copyFileSync(path.join(env.dataDir, rel), to);
  } catch (err) {
    if (err.code === "ENOENT") return false;
    throw err;
  }
  fs.chmodSync(to, 0o600);
  return true;
}

/** Copies folder `rel` whole; the number of files. */
function copyFolder(rel, into) {
  let n = 0;
  let entries;
  try {
    entries = fs.readdirSync(path.join(env.dataDir, rel), { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return 0;
    throw err;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const child = path.join(rel, e.name);
    if (e.isDirectory()) n += copyFolder(child, into);
    else if (e.isFile() && copyOne(child, into)) n++;
  }
  return n;
}

function sizeOf(dir) {
  let bytes = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    bytes += e.isDirectory() ? sizeOf(p) : fs.statSync(p).size;
  }
  return bytes;
}

/** The kept backups, newest first: [{ day, bytes }]. */
export function list() {
  let names;
  try {
    names = fs.readdirSync(root());
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  return names.filter((n) => DAY_RE.test(n)).sort().reverse().map((day) => ({ day, bytes: sizeOf(path.join(root(), day)) }));
}

/** Removes the day folders past the newest `keep`. */
function prune(keep) {
  for (const { day } of list().slice(keep)) {
    fs.rmSync(path.join(root(), day), { recursive: true, force: true });
    debug.log("backup: removed %s", day);
  }
}

let last = null; // { at, day, files, bytes, ms } or { at, error }

/** Makes today's backup now (replacing one made earlier today). Returns what it wrote. */
export function backupNow(now = Date.now()) {
  const started = Date.now();
  const job = activity.begin("backup", { title: "DB 를 백업합니다" });
  const day = dayOf(now);
  const work = path.join(root(), `.${day}.partial`);
  try {
    fs.mkdirSync(root(), { recursive: true, mode: 0o700 });
    fs.chmodSync(root(), 0o700);
    fs.rmSync(work, { recursive: true, force: true });
    fs.mkdirSync(path.join(work, "security"), { recursive: true, mode: 0o700 });
    const dbCopy = path.join(work, "security", "security.db");
    securityDb().prepare("VACUUM INTO ?").run(dbCopy);
    fs.chmodSync(dbCopy, 0o600);
    let files = 1;
    for (const dir of JSON_FOLDERS) for (const rel of jsonFiles(dir)) if (copyOne(rel, work)) files++;
    for (const dir of FOLDERS) files += copyFolder(dir, work);
    const done = path.join(root(), day);
    fs.rmSync(done, { recursive: true, force: true });
    fs.renameSync(work, done);
    last = { at: Date.now(), day, files, bytes: sizeOf(done), ms: Date.now() - started };
    debug.log("backup: %s, %d file(s), %d bytes in %d ms", day, files, last.bytes, last.ms);
    if (env.backupDays > 0) prune(env.backupDays);
    job.done(`파일 ${files}개`);
    return last;
  } catch (err) {
    fs.rmSync(work, { recursive: true, force: true });
    last = { at: Date.now(), error: err.message };
    job.fail(err);
    throw err;
  }
}

/** What the admin page shows: the setting, the last run, the kept days. */
export function status() {
  const kept = list();
  return { days: env.backupDays, last, kept, dir: BACKUP_DIR };
}

/** Today's backup when it is missing and backups are on. */
function catchUp() {
  if (env.backupDays <= 0) return;
  const today = dayOf(Date.now());
  if (list().some((b) => b.day === today)) return;
  try {
    backupNow();
  } catch (err) {
    debug.error("backup: failed: %s", err.message);
  }
}

let timer = null;
/** On start: a backup when today has none, then a look every hour. */
export function start() {
  if (timer) return;
  catchUp();
  timer = setInterval(catchUp, CHECK_MS);
  timer.unref?.();
}
