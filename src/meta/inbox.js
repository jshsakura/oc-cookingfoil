/**
 * The temporary share inbox on disk. Signed-in web users leave files, a memo
 * and links here; the operator (or an assistant reading the folder) sorts them
 * into patches, saves or homebrew later.
 *
 *   <dataDir>/inbox/<YYYYMMDD-HHMMSS>-<user>-<4 hex>/
 *     files/<original names, folders kept>
 *     note.json    { user, at (ISO), memo, links: [], files: [{ name, size, sha256 }] }
 *     status.json  { done: true, at }   only once the admin marks it 정리함
 *   <dataDir>/inbox/.staging/<random>/   uploads being received (cleared at startup)
 *
 * An upload is received into staging and renamed into place in one step, so a
 * half-finished one never shows up. Names keep what the person picked, cleaned
 * of folders that leave files/, control characters and clashes.
 */
import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { dataDir } from "../helpers/envs.js";

export const INBOX_DIR = path.join(dataDir, "inbox");
const STAGING_DIR = path.join(INBOX_DIR, ".staging");
const NAME_MAX = 200;
const MEMO_MAX = 10_000;
const LINKS_MAX = 20;
const LINK_MAX = 2000;
// Control characters, and the bidi marks and overrides that could show x\u202Egpj.exe as xexe.jpg.
const CONTROL_RE = /[\x00-\x1f\x7f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const USAGE_TTL_MS = 60_000;
const ID_RE = /^\d{8}-\d{6}-[A-Za-z0-9_-]{1,40}-[0-9a-f]{4}$/;

/** A refusal the person can act on: an HTTP status, a code and a Korean message. */
export class InboxError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** One path part as the person named it, made safe to write. Never empty. Pure. */
export function fileNameOf(raw) {
  let name = String(raw ?? "").normalize("NFC").split(/[/\\]/).pop().replace(CONTROL_RE, "").trim();
  if (!name || name === "." || name === "..") return "file";
  if (name.length > NAME_MAX) {
    const ext = path.extname(name).slice(0, 20);
    name = name.slice(0, NAME_MAX - ext.length) + ext;
  }
  return name;
}

/** A path inside an uploaded folder, each part cleaned, with nothing that climbs out. Pure. */
export function relPathOf(raw) {
  const parts = String(raw ?? "").replace(/\\/g, "/").split("/")
    .filter((p) => p !== "" && p !== "." && p !== "..")
    .map(fileNameOf);
  return parts.length ? parts.join("/") : "file";
}

/** The same paths, a clash (ignoring case) renamed "name (2).ext". Pure. */
export function uniquePaths(rels) {
  const taken = new Set();
  return rels.map((rel) => {
    const dir = path.posix.dirname(rel);
    const ext = path.posix.extname(rel);
    const stem = path.posix.basename(rel, ext);
    let out = rel;
    for (let n = 2; taken.has(out.toLowerCase()); n++) out = `${dir === "." ? "" : `${dir}/`}${stem} (${n})${ext}`;
    taken.add(out.toLowerCase());
    return out;
  });
}

/** Links from a newline-separated text or a list: http or https only, no repeats. */
export function parseLinks(raw) {
  const items = (Array.isArray(raw) ? raw : String(raw ?? "").split(/\r?\n/)).map((s) => String(s).trim()).filter(Boolean);
  if (items.length > LINKS_MAX) throw new InboxError(400, "too-many-links", `링크는 ${LINKS_MAX}개까지 남깁니다`);
  const out = [];
  for (const item of items) {
    let url = null;
    try {
      url = item.length <= LINK_MAX ? new URL(item) : null;
    } catch {
      url = null;
    }
    if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) {
      throw new InboxError(400, "bad-link", `http 나 https 로 시작하는 주소만 남깁니다: ${item.slice(0, 80)}`);
    }
    if (!out.includes(url.href)) out.push(url.href);
  }
  return out;
}

/** The memo, trimmed, with plain line breaks. */
export function cleanMemo(raw) {
  const memo = String(raw ?? "").replace(/\r\n?/g, "\n").trim();
  if (memo.length > MEMO_MAX) throw new InboxError(400, "memo-too-long", `메모는 ${MEMO_MAX.toLocaleString()}자까지 남깁니다`);
  return memo;
}

/** The account name as a folder-name part. Pure. */
export const slugOf = (user) => String(user ?? "").replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 40) || "user";

const two = (n) => String(n).padStart(2, "0");

/** <YYYYMMDD-HHMMSS>-<user>-<4 hex>, in the server's local time. Pure. */
export function entryId(user, date, hex) {
  const d = `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}`;
  const t = `${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`;
  return `${d}-${t}-${slugOf(user)}-${hex}`;
}

export const isEntryId = (id) => typeof id === "string" && ID_RE.test(id);

/** Drops what a stopped server left half-received. Runs once when the route is set up. */
export function clearStaging() {
  fs.rmSync(STAGING_DIR, { recursive: true, force: true });
  fs.mkdirSync(STAGING_DIR, { recursive: true });
}

/** A new empty staging folder with an in/ for the incoming files. */
export async function newStaging() {
  const work = path.join(STAGING_DIR, crypto.randomBytes(8).toString("hex"));
  await fsp.mkdir(path.join(work, "in"), { recursive: true });
  return work;
}

function sha256Of(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    fs.createReadStream(file).on("data", (c) => hash.update(c)).on("error", reject).on("end", () => resolve(hash.digest("hex")));
  });
}

/**
 * Turns a received staging folder into an entry. `files` are [{ path, name }]
 * already inside `work` (name may carry an uploaded folder's inner path).
 * Returns the note with its id.
 */
export async function create({ user, slug, work, files, memo = "", links = [], now = new Date() }) {
  const out = path.join(work, "entry");
  const names = uniquePaths(files.map((f) => relPathOf(f.name)));
  await fsp.mkdir(path.join(out, "files"), { recursive: true });
  const listed = [];
  for (const [i, f] of files.entries()) {
    const dest = path.join(out, "files", ...names[i].split("/"));
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.rename(f.path, dest);
    listed.push({ name: names[i], size: (await fsp.stat(dest)).size, sha256: await sha256Of(dest) });
  }
  const note = { user, at: now.toISOString(), memo, links, files: listed };
  await fsp.writeFile(path.join(out, "note.json"), `${JSON.stringify(note, null, 1)}\n`);
  let id;
  for (;;) {
    id = entryId(slug ?? user, now, crypto.randomBytes(2).toString("hex"));
    try {
      await fsp.rename(out, path.join(INBOX_DIR, id));
      break;
    } catch (err) {
      if (err.code !== "ENOTEMPTY" && err.code !== "EEXIST") throw err;
    }
  }
  await fsp.rm(work, { recursive: true, force: true });
  renewUsage();
  return { id, ...note };
}

async function sizeOf(dir) {
  let total = 0;
  for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += await sizeOf(p);
    else if (e.isFile()) total += (await fsp.stat(p)).size;
  }
  return total;
}

let usageCache = null; // { bytes, at }
const renewUsage = () => { usageCache = null; };

/**
 * Bytes the inbox's entries hold (uploads in flight are counted by the route).
 * Measured at most once a minute, and again after this module adds or removes
 * an entry; `fresh` measures now.
 */
export async function usage({ fresh = false } = {}) {
  if (!fresh && usageCache && Date.now() - usageCache.at < USAGE_TTL_MS) return usageCache.bytes;
  let bytes = 0;
  for (const name of (await fsp.readdir(INBOX_DIR).catch(() => [])).filter(isEntryId)) bytes += await sizeOf(path.join(INBOX_DIR, name));
  usageCache = { bytes, at: Date.now() };
  return bytes;
}

async function readEntry(id) {
  const dir = path.join(INBOX_DIR, id);
  try {
    const note = JSON.parse(await fsp.readFile(path.join(dir, "note.json"), "utf8"));
    const status = await fsp.readFile(path.join(dir, "status.json"), "utf8").then(JSON.parse, () => null);
    const files = Array.isArray(note.files) ? note.files : [];
    return {
      id, user: String(note.user ?? ""), at: note.at ?? null, memo: String(note.memo ?? ""),
      links: Array.isArray(note.links) ? note.links.map(String) : [], files,
      bytes: files.reduce((n, f) => n + (Number(f.size) || 0), 0), done: status?.done === true,
    };
  } catch {
    return null;
  }
}

/** Entries newest first; `done` true or false keeps only those. */
export async function list({ done } = {}) {
  const names = (await fsp.readdir(INBOX_DIR).catch(() => [])).filter(isEntryId);
  const entries = (await Promise.all(names.map(readEntry))).filter(Boolean);
  return entries
    .filter((e) => done === undefined || e.done === done)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)) || b.id.localeCompare(a.id));
}

const entryDir = (id) => (isEntryId(id) && fs.existsSync(path.join(INBOX_DIR, id, "note.json")) ? path.join(INBOX_DIR, id) : null);

/** Marks an entry 정리함 (or not). Returns whether it exists. */
export async function setDone(id, done) {
  const dir = entryDir(id);
  if (!dir) return false;
  const file = path.join(dir, "status.json");
  if (done) await fsp.writeFile(file, `${JSON.stringify({ done: true, at: new Date().toISOString() })}\n`);
  else await fsp.rm(file, { force: true });
  renewUsage();
  return true;
}

/** Deletes one entry. Returns whether it existed. */
export async function remove(id) {
  const dir = entryDir(id);
  if (!dir) return false;
  await fsp.rm(dir, { recursive: true, force: true });
  renewUsage();
  return true;
}

/** The absolute path of one of an entry's files, or null when it isn't one. */
export function filePath(id, rel) {
  const dir = entryDir(id);
  if (!dir || !rel) return null;
  const base = path.join(dir, "files");
  const abs = path.resolve(base, String(rel));
  if (!abs.startsWith(base + path.sep)) return null;
  try {
    return fs.statSync(abs).isFile() ? abs : null;
  } catch {
    return null;
  }
}

/** 1.5 MB style. Pure. */
export function fmtBytes(n) {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return i === 0 ? `${n} B` : `${(n / 1024 ** i).toFixed(1)} ${units[i]}`;
}

/** The Telegram text for one upload: who, how many files and how big, links, the memo's first line. Pure. */
export function alertText(note) {
  const bytes = note.files.reduce((n, f) => n + (Number(f.size) || 0), 0);
  const first = note.memo.split("\n").map((s) => s.trim()).find(Boolean)?.slice(0, 120);
  return `${note.user} 님이 파일 ${note.files.length}개(${fmtBytes(bytes)}), 링크 ${note.links.length}개를 올렸습니다.${first ? `\n메모: ${first}` : ""}`;
}
