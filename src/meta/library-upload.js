/**
 * Putting operator uploads into the libraries: packages, retro ROMs, user
 * patches and saves. The admin route (routes/admin/upload-api.js) receives the
 * files into a staging folder on the destination disk; this module checks the
 * names and paths, unpacks a .zip, decides where everything goes and moves it
 * there in one step. Nothing is ever overwritten.
 */
import { execFile } from "child_process";
import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { zipEntries } from "./homebrew.js";
import { uploadMaxBytes } from "../helpers/envs.js";
import { coded } from "./meta-messages.js";

const UNSAFE_RE = /[\x00-\x1f\x7f/\\]/;
const NAME_MAX = 100;
const TITLE_ID_RE = /^[0-9A-F]{16}$/;
export const GAME_EXT_RE = /\.(nsp|nsz|xci|xcz)$/i;
// Disc images travel with the files they name; these never count as the ROM itself.
const COMPANION_EXT = new Set([".bin", ".img", ".sub", ".ccd", ".wav", ".ape", ".ecm"]);
const UNZIP_TIMEOUT_MS = 10 * 60_000;
const UNZIP_WATCH_MS = 100;
// The most files one upload may carry, picked or unpacked from a zip.
export const MAX_UPLOAD_FILES = 5000;

export class UploadError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }

  /** A refusal said by a meta-messages.js key: English message, the key as `code`, its `vars`. */
  static of(status, code, vars = {}) {
    return coded(new UploadError(status, ""), code, vars);
  }
}
const bad = (code, vars) => UploadError.of(400, code, vars);

/** A folder or file name the operator typed, or null when it can't be one. Pure. */
export function safeName(raw) {
  const name = String(raw ?? "").normalize("NFC").trim();
  if (!name || name.length > NAME_MAX || UNSAFE_RE.test(name) || name.startsWith(".")) return null;
  return name;
}

/** A relative path inside an upload, or null when it would leave the folder. Pure. */
export function safeRelPath(raw) {
  const parts = String(raw ?? "").normalize("NFC").replace(/\\/g, "/").split("/").filter((p) => p !== "");
  if (!parts.length) return null;
  for (const p of parts) {
    if (p === "." || p === ".." || /[\x00-\x1f\x7f]/.test(p) || p.length > 255) return null;
  }
  return parts.join("/");
}

/** A base title id (upper case), or null. Pure. */
export function baseTitleId(raw) {
  const tid = String(raw ?? "").trim().toUpperCase();
  return TITLE_ID_RE.test(tid) && (BigInt(`0x${tid}`) & 0x1fffn) === 0n ? tid : null;
}

/** Drop the first folder from every path when they all share it. Pure. */
export function stripShared(paths) {
  const first = paths.map((p) => p.split("/")[0]);
  if (!paths.length || paths.some((p) => !p.includes("/")) || new Set(first).size !== 1) return null;
  return paths.map((p) => p.slice(first[0].length + 1));
}

/** A homebrew app folder name (switch/<app>/), or null. Pure. */
export function homebrewApp(raw) {
  const app = String(raw ?? "").trim();
  return /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,63}$/.test(app) ? app : null;
}

/**
 * Files for a homebrew app's patch or save, relative to its switch/<app>/
 * folder. When the upload carries switch/<app>/ (at the top or under wrapper
 * folders), everything is taken from inside it; otherwise the paths are kept as
 * they are, less the picked folder's own name for a folder upload. Anything
 * aimed at another folder of the SD card is refused. Pure.
 */
export function homebrewLayout(paths, app, fromFolderPicker = false) {
  const prefix = `switch/${app.toLowerCase()}/`;
  let cur = paths;
  for (let i = 0; i < 4 && cur; i++) {
    if (cur.every((p) => p.toLowerCase().startsWith(prefix))) return cur.map((p) => p.slice(prefix.length));
    cur = stripShared(cur);
  }
  const plain = fromFolderPicker ? stripShared(paths) ?? paths : paths;
  // An SD-card folder anywhere in a path (atmosphere/, another app's switch/<x>/) means it aims elsewhere.
  const stray = paths.find((p) => /(^|\/)(atmosphere|bootloader)\//i.test(p) || /(^|\/)switch\/[^/]+\//i.test(p));
  if (stray) throw bad("upload.outsideApp", { app, path: stray });
  return plain;
}

/** Save files: one wrapper folder (a zip of the save folder) is peeled off. Pure. */
export function saveLayout(paths, fromFolderPicker) {
  if (fromFolderPicker) return stripShared(paths) ?? paths;
  const inner = stripShared(paths);
  return inner && inner.every((p) => p !== "") ? inner : paths;
}

/**
 * A save backup's key=value .meta (save-keeper's `<backup>.meta`, or
 * `.dropkeep.meta` inside a backup zip): "device" when its user_id marks the
 * console's shared save, "account" for any other user_id, null when the text
 * is not such a file. Pure.
 */
export function backupSaveType(name, text) {
  if (!/\.meta$/i.test(name)) return null;
  const fields = Object.fromEntries(String(text).split(/\r?\n/).map((l) => l.split("=")).filter((kv) => kv.length >= 2)
    .map(([k, ...v]) => [k.trim(), v.join("=").trim()]));
  if (!("user_id" in fields) && !("title_id" in fields)) return null;
  if (fields.user_id === "device") return "device";
  return fields.user_id ? "account" : null;
}

/** Retro files go flat into the console's folder; one of them must be a ROM it plays. Pure. */
export function retroLayout(paths, system) {
  const names = paths.map((p) => path.posix.basename(p));
  if (new Set(names).size !== names.length) throw bad("upload.sameName");
  const exts = names.map((n) => path.extname(n).toLowerCase());
  if (!exts.some((e) => system.extensions.includes(e))) {
    throw bad("upload.noRom", { system: (lang) => system.names?.[lang] ?? system.names?.en ?? system.name, exts: system.extensions.join(" ") });
  }
  const stray = names.find((n, i) => !system.extensions.includes(exts[i]) && !COMPANION_EXT.has(exts[i]));
  if (stray) throw bad("upload.foreignFile", { name: stray });
  for (const n of names) if (!safeName(n)) throw bad("upload.badName", { name: n });
  return names;
}

/**
 * Unpack a zip into `dir` (Info-ZIP drops "../" and absolute paths). What the
 * zip says it holds is read first, as the homebrew path does: past `maxEntries`
 * entries or `maxBytes` unpacked (an upload's own limit) nothing is written.
 * Headers can lie, so what is written is also counted while unzip runs; past
 * `maxBytes` it is stopped and `dir` is emptied.
 */
export async function unzip(zip, dir, { maxBytes = uploadMaxBytes, maxEntries = MAX_UPLOAD_FILES } = {}) {
  let entries;
  try { entries = await zipEntries(zip); } catch { throw bad("upload.zipUnreadable"); }
  if (entries.length > maxEntries) throw UploadError.of(413, "upload.zipTooManyEntries", { max: maxEntries });
  const total = entries.reduce((sum, e) => sum + e.size, 0);
  const tooBig = () => UploadError.of(413, "upload.zipTooBig", { max: maxBytes });
  if (total > maxBytes) throw tooBig();
  let overflow = false;
  const done = await new Promise((resolve) => {
    const child = execFile("unzip", ["-qq", "-o", zip, "-d", dir], { timeout: UNZIP_TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (err, _out, stderr) => {
      clearInterval(watch);
      resolve({ err, stderr });
    });
    const watch = setInterval(() => {
      bytesUnder(dir).then((n) => {
        if (n > maxBytes && !overflow) { overflow = true; child.kill("SIGKILL"); }
      }, () => {});
    }, UNZIP_WATCH_MS);
  });
  if (overflow || (await bytesUnder(dir)) > maxBytes) {
    await emptyDir(dir);
    throw tooBig();
  }
  // Exit 1 is "warnings" (such as a skipped ../ part); the files are out.
  if (done.err && done.err.code !== 1) throw bad("upload.unzipFailed", { why: (done.stderr || done.err.message).trim().split("\n")[0] });
}

/** Bytes of the regular files under `dir`; links are not followed. */
async function bytesUnder(dir) {
  let total = 0;
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) total += await bytesUnder(abs);
    else if (e.isFile()) total += (await fsp.lstat(abs).catch(() => ({ size: 0 }))).size;
  }
  return total;
}

async function emptyDir(dir) {
  for (const name of await fsp.readdir(dir)) await fsp.rm(path.join(dir, name), { recursive: true, force: true });
}

/** Every file under `dir` as { abs, rel }; a link or special file refuses the upload. */
export async function walk(dir, base = dir) {
  const out = [];
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isSymbolicLink()) throw bad("upload.link", { path: path.relative(base, abs) });
    if (e.isDirectory()) out.push(...(await walk(abs, base)));
    else if (e.isFile()) out.push({ abs, rel: path.relative(base, abs).split(path.sep).join("/") });
    else throw bad("upload.notFile", { path: path.relative(base, abs) });
  }
  return out;
}

/**
 * Move a file, copying when the destination is on another disk. The copy goes
 * to a new file beside `to` and is renamed over it, so a link already at `to`
 * is replaced, never written through.
 */
export async function moveFile(from, to) {
  await fsp.mkdir(path.dirname(to), { recursive: true });
  try {
    await fsp.rename(from, to);
  } catch (err) {
    if (err.code !== "EXDEV") throw err;
    const part = `${to}.${crypto.randomBytes(6).toString("hex")}.part`;
    try {
      await fsp.copyFile(from, part, fs.constants.COPYFILE_EXCL);
      await fsp.rename(part, to);
    } catch (copyErr) {
      await fsp.rm(part, { force: true });
      throw copyErr;
    }
    await fsp.rm(from, { force: true });
  }
}

/** Refuse when something is already at `dest`. */
export function mustBeFree(dest, label) {
  if (fs.existsSync(dest)) throw UploadError.of(409, "upload.exists", { name: label });
}
