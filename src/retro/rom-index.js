/**
 * CRC-32, SHA-1 and SHA-256 of each retro ROM file, read in one streaming pass
 * in the background after a scan (or when the admin asks), so a ROM can be named
 * from the names plugins' Korean title dictionary (ko-names.js) by its content.
 *
 * Retro games only: the Switch library is never read here. Files are only ever
 * read, never written, renamed or moved.
 *
 * Kept in the index (db/stores.js retroRomHashes) by absolute path under the
 * file's fileKey: a pass reads only files whose key moved and drops the rows of
 * files that left the catalog or the disk. A row's data is
 *
 *   { crc32, sha1?, sha256?, bare?: { crc32, sha1, sha256 }, entry?, skip? }
 *
 * What is hashed is the ROM as No-Intro and Redump list it:
 *   - a plain file: its bytes. `bare` is the same without a copier or iNES
 *     header (NES, SNES, PC Engine, Atari 7800, Lynx), as some lists hash it so.
 *   - a zip: its largest file. The central directory already holds that file's
 *     CRC-32, so nothing is inflated unless the CRC is one the dictionary knows
 *     (then SHA-1 and SHA-256 confirm it) or the system has a header to drop.
 *   - a .cue: the first track file it names (the data track Redump lists).
 *   - .chd .pbp .cso .rvz .m3u .7z are skipped: their bytes are not the dump a
 *     list names (compressed or an index), and 7z cannot be read here.
 *   - anything over 1 GB is skipped: a disc image that big would hold the disk
 *     for minutes, and the dictionary names no system with such files.
 * Only systems the dictionary names anything for are read at all.
 */
import { createReadStream } from "fs";
import fsp from "fs/promises";
import crypto from "crypto";
import path from "path";
import zlib from "zlib";
import debug from "../debug.js";
import { appDb } from "../db/database.js";
import { retroRomHashes } from "../db/stores.js";
import { fileKey } from "../helpers/hash-cache.js";
import { entryStream, zipDirectory } from "../helpers/zip-read.js";
import * as activity from "../tasks/activity.js";
import { inTurn } from "./disk-turn.js";
import { koreanNameCrc, koreanNameSystem } from "./ko-names.js";
import * as indexRevision from "./index-revision.js";

export const MAX_BYTES = 1024 ** 3;
const SKIP_EXT = new Set([".chd", ".pbp", ".cso", ".rvz", ".m3u", ".7z"]);
const READ_CHUNK = 1024 * 1024;
const HEAD = 128;
// The activity menu shows server-side titles as they are; kept with its translations all the same.
const JOB_TITLE = {
  ko: "레트로 롬 파일의 내용 해시를 구합니다",
  en: "Reading the content hashes of retro ROM files",
  ja: "レトロ ROM ファイルの内容ハッシュを求めます",
  zh: "正在计算复古 ROM 文件的内容哈希",
};
// A breath between files, so requests keep their turn while a big library is read.
const PAUSE_MS = 50;

const startsWith = (buf, text, at = 0) => buf.length >= at + text.length && buf.toString("latin1", at, at + text.length) === text;

/** How many leading bytes of a ROM of `system` are a header the lists leave out, from its first bytes and size. Pure. */
const HEADERS = {
  nes: (head) => (startsWith(head, "NES\x1a") || startsWith(head, "FDS\x1a") ? 16 : 0),
  snes: (_head, size) => (size % 1024 === 512 ? 512 : 0),
  pce: (_head, size) => (size % 1024 === 512 ? 512 : 0),
  a7800: (head) => (startsWith(head, "ATARI7800", 1) ? 128 : 0),
  lynx: (head) => (startsWith(head, "LYNX\0") ? 64 : 0),
};

function triple() {
  let crc = 0;
  const sha1 = crypto.createHash("sha1");
  const sha256 = crypto.createHash("sha256");
  return {
    update(chunk) {
      crc = zlib.crc32(chunk, crc);
      sha1.update(chunk);
      sha256.update(chunk);
    },
    digest: () => ({ crc32: (crc >>> 0).toString(16).padStart(8, "0"), sha1: sha1.digest("hex"), sha256: sha256.digest("hex") }),
  };
}

/**
 * Hashes what `stream` gives, as a ROM of `system` that is `size` bytes long: { crc32, sha1, sha256, bare? }.
 * Throws JobStopped, the stream destroyed, as soon as `stopped()` turns true.
 */
export async function hashRom(stream, system, size, stopped = () => false) {
  const whole = triple();
  const header = HEADERS[system];
  let bare = null;
  let head = header ? [] : null;
  let headLen = 0;
  const decide = () => {
    const buf = Buffer.concat(head);
    head = null;
    const skip = header(buf, size);
    if (!skip || buf.length < skip) return;
    bare = triple();
    bare.update(buf.subarray(skip));
  };
  for await (const chunk of stream) {
    if (stopped()) {
      stream.destroy();
      throw new activity.JobStopped();
    }
    whole.update(chunk);
    if (bare) bare.update(chunk);
    else if (head) {
      head.push(chunk);
      headLen += chunk.length;
      if (headLen >= HEAD) decide();
    }
  }
  if (head) decide();
  return { ...whole.digest(), ...(bare ? { bare: bare.digest() } : {}) };
}

/** The first track file a cue sheet names, beside it, or null. */
export async function cueTrack(abs) {
  const text = await fsp.readFile(abs, "latin1");
  const m = text.match(/^\s*FILE\s+(?:"([^"]+)"|(\S+))/im);
  const name = m ? path.basename(m[1] ?? m[2]) : null;
  return name ? path.join(path.dirname(abs), name) : null;
}

/** What is read for game `g`: { file, key } (a cue's key covers its track too), or null when it is gone. */
async function target(g) {
  try {
    const st = await fsp.stat(g.abs);
    if (path.extname(g.abs).toLowerCase() !== ".cue") return { file: g.abs, size: st.size, key: fileKey(st) };
    const track = await cueTrack(g.abs);
    const tst = track ? await fsp.stat(track) : null;
    return tst ? { file: track, size: tst.size, key: `${fileKey(st)}|${fileKey(tst)}`, entry: path.basename(track) } : { file: g.abs, size: st.size, key: fileKey(st), skip: "format" };
  } catch {
    return null;
  }
}

/** The row data for game `g` read through `t` (target); `stopped` as hashRom takes it. */
async function read(g, t, stopped) {
  if (t.skip) return { skip: t.skip };
  const ext = path.extname(t.file).toLowerCase();
  if (SKIP_EXT.has(ext)) return { skip: "format" };
  if (t.size > MAX_BYTES) return { skip: "large" };
  if (ext !== ".zip") return { ...(await hashRom(createReadStream(t.file, { highWaterMark: READ_CHUNK }), g.system, t.size, stopped)), ...(t.entry ? { entry: t.entry } : {}) };
  const inner = (await zipDirectory(t.file)).filter((e) => !e.name.endsWith("/")).sort((a, b) => b.size - a.size)[0];
  if (!inner) return { skip: "unreadable" };
  if (inner.size > MAX_BYTES) return { skip: "large" };
  if (!HEADERS[g.system] && !koreanNameCrc(g.system, inner.crc32)) return { crc32: inner.crc32, entry: inner.name };
  const stream = await entryStream(t.file, inner);
  if (!stream) return { crc32: inner.crc32, entry: inner.name };
  return { ...(await hashRom(stream, g.system, inner.size, stopped)), entry: inner.name };
}

let store = null;
const rows = () => (store ??= retroRomHashes(appDb()));

/** Whether `g` is read at all: a file of a system the dictionary names something for. */
export const indexed = (g) => Boolean(g.abs) && koreanNameSystem(g.system);

/** The row data remembered for a game, or null (not read yet, or not indexed). */
export const known = (g) => (g.abs && rows().get(g.abs)?.data) || null;

/** Reads the catalog's new and changed files and forgets the ones gone: { hashed, stopped }. */
export async function pass(games, { pauseMs = PAUSE_MS } = {}) {
  const ours = games.filter(indexed);
  const due = [];
  const seen = new Set();
  for (const g of ours) {
    const t = await target(g);
    if (!t) continue;
    seen.add(g.abs);
    if (rows().get(g.abs)?.key !== t.key) due.push([g, t]);
  }
  rows().prune(seen);
  if (!due.length) return { hashed: 0, stopped: false };
  const job = activity.begin("retro-rom-index", { title: JOB_TITLE.ko, total: due.length });
  const stopped = () => job.stopped;
  let hashed = 0;
  try {
    for (const [g, t] of due) {
      if (stopped()) break;
      let data;
      try {
        data = await read(g, t, stopped);
      } catch (err) {
        // Stopped mid-file: no row, so the next pass reads it whole.
        if (err instanceof activity.JobStopped) break;
        debug.error("retro: content hash of %s: %s", g.rel ?? g.abs, err.message);
        data = { skip: "unreadable" };
      }
      rows().set(g.abs, { key: t.key, data });
      indexRevision.bump();
      job.step(++hashed, g.file);
      if (pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
    }
  } catch (err) {
    job.fail(err);
    throw err;
  }
  const wasStopped = stopped();
  job.done(String(hashed));
  return { hashed, stopped: wasStopped };
}

/** How many indexed files have a row, and how many of those were skipped. */
export function counts(games) {
  const ours = games.filter(indexed);
  const data = ours.map(known).filter(Boolean);
  return { files: ours.length, read: data.length, skipped: data.filter((d) => d.skip).length };
}

let running = null;
let next = null;
/**
 * A pass over `games`, after any other reader of the ROM files (disk-turn.js); one at a time,
 * and a catalog that comes in meanwhile is read after it, unless the admin stopped the pass:
 * then the next scan or the admin's button starts the next one.
 */
export function queue(games) {
  if (running) {
    next = games;
    return running;
  }
  running = inTurn(() => pass(games))
    .then((r) => {
      if (r.hashed) debug.log("retro: %d ROM content hashes read", r.hashed);
      if (r.stopped) next = null;
    })
    .catch((err) => debug.error("retro: ROM content hashes: %s", err.message))
    .finally(() => {
      running = null;
      const later = next;
      next = null;
      if (later) queue(later);
    });
  return running;
}

/** Whether a pass is reading files now. */
export const busy = () => Boolean(running);
