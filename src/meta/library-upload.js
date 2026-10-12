/**
 * Putting operator uploads into the libraries: packages, retro ROMs, user
 * patches and saves. The admin route (routes/admin/upload-api.js) receives the
 * files into a staging folder on the destination disk; this module checks the
 * names and paths, unpacks a .zip, decides where everything goes and moves it
 * there in one step. Nothing is ever overwritten.
 */
import { execFile } from "child_process";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { kindOf } from "./user-patches.js";

const UNSAFE_RE = /[\x00-\x1f\x7f/\\]/;
const NAME_MAX = 100;
const TITLE_ID_RE = /^[0-9A-F]{16}$/;
export const GAME_EXT_RE = /\.(nsp|nsz|xci|xcz)$/i;
// Disc images travel with the files they name; these never count as the ROM itself.
const COMPANION_EXT = new Set([".bin", ".img", ".sub", ".ccd", ".wav", ".ape", ".ecm"]);
const UNZIP_TIMEOUT_MS = 10 * 60_000;

export class UploadError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const bad = (message) => new UploadError(400, message);

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

/**
 * Patch files arranged from the SD root: wrapper folders (a zip of a folder,
 * a picked folder) are peeled off until "atmosphere/" is on top. Pure.
 */
export function patchLayout(paths, titleId) {
  const owned = (p) => kindOf(p, titleId) !== null;
  let cur = paths;
  while (!cur.every(owned)) {
    const next = stripShared(cur);
    if (!next) {
      const stray = cur.find((p) => !owned(p));
      throw bad(`이 게임(${titleId})의 패치 경로가 아닙니다: ${stray}. atmosphere/contents/${titleId}/… 구조여야 합니다`);
    }
    cur = next;
  }
  return cur;
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
  if (stray) throw bad(`이 앱(switch/${app}/) 밖의 경로입니다: ${stray}`);
  return plain;
}

/** Save files: one wrapper folder (a zip of the save folder) is peeled off. Pure. */
export function saveLayout(paths, fromFolderPicker) {
  if (fromFolderPicker) return stripShared(paths) ?? paths;
  const inner = stripShared(paths);
  return inner && inner.every((p) => p !== "") ? inner : paths;
}

/** Retro files go flat into the console's folder; one of them must be a ROM it plays. Pure. */
export function retroLayout(paths, system) {
  const names = paths.map((p) => path.posix.basename(p));
  if (new Set(names).size !== names.length) throw bad("같은 이름의 파일이 두 개 있습니다");
  const exts = names.map((n) => path.extname(n).toLowerCase());
  if (!exts.some((e) => system.extensions.includes(e))) {
    throw bad(`${system.names?.ko ?? system.name} 롬이 없습니다 (${system.extensions.join(" ")})`);
  }
  const stray = names.find((n, i) => !system.extensions.includes(exts[i]) && !COMPANION_EXT.has(exts[i]));
  if (stray) throw bad(`이 기종에서 쓰지 않는 파일입니다: ${stray}`);
  for (const n of names) if (!safeName(n)) throw bad(`파일 이름을 쓸 수 없습니다: ${n}`);
  return names;
}

/** Unpack a zip into `dir` (Info-ZIP drops "../" and absolute paths). */
export function unzip(zip, dir) {
  return new Promise((resolve, reject) => {
    execFile("unzip", ["-qq", "-o", zip, "-d", dir], { timeout: UNZIP_TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (err, _out, stderr) => {
      // Exit 1 is "warnings" (such as a skipped ../ part); the files are out.
      if (err && err.code !== 1) reject(bad(`zip 을 풀 수 없습니다: ${(stderr || err.message).trim().split("\n")[0]}`));
      else resolve();
    });
  });
}

/** Every file under `dir` as { abs, rel }; a link or special file refuses the upload. */
export async function walk(dir, base = dir) {
  const out = [];
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isSymbolicLink()) throw bad(`링크는 올릴 수 없습니다: ${path.relative(base, abs)}`);
    if (e.isDirectory()) out.push(...(await walk(abs, base)));
    else if (e.isFile()) out.push({ abs, rel: path.relative(base, abs).split(path.sep).join("/") });
    else throw bad(`일반 파일이 아닙니다: ${path.relative(base, abs)}`);
  }
  return out;
}

/** Move a file, copying when the destination is on another disk. */
export async function moveFile(from, to) {
  await fsp.mkdir(path.dirname(to), { recursive: true });
  try {
    await fsp.rename(from, to);
  } catch (err) {
    if (err.code !== "EXDEV") throw err;
    await fsp.copyFile(from, `${to}.part`);
    await fsp.rename(`${to}.part`, to);
    await fsp.rm(from, { force: true });
  }
}

/** Refuse when something is already at `dest`. */
export function mustBeFree(dest, label) {
  if (fs.existsSync(dest)) throw new UploadError(409, `이미 있습니다: ${label}`);
}
