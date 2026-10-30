/**
 * The drop box: files put in the incoming folder (storage-layout.js) are
 * sorted into the games folder by themselves, one folder per base game:
 *
 *   base     <game>/<file>
 *   update   <game>/update/<file>
 *   DLC      <game>/DLC/<file>
 *
 * The folder a game already has in the games folder is the one it keeps,
 * whatever its name: folder names are the operator's. A game that has none
 * gets one named after it. Each file goes in as `<name> [TITLEID][vN].ext`
 * (organize-naming.js): the admin's name, titledb's, the NACP's, then the
 * file's own name without its tags. A base game's or an update's NACP carries
 * its game's name, so it can name a game titledb does not know (a base and its
 * update in one batch share the name); a DLC has none and waits for its game
 * unless the game is known. Folder and file names compare in NFC, any case.
 * Files already in the games folder are never moved or renamed.
 *
 * What a file is comes from its cnmt when the keys can read it (NSP/NSZ), else
 * from the id in its name, else from its ticket's name (NSP/NSZ without keys).
 * A file still being copied in waits until it has not changed for SETTLE_MS.
 * Moves are renames when the drop box shares the mount, copies otherwise, and
 * nothing is ever overwritten. Files that cannot go anywhere stay, listed with why.
 * Retro ROMs and lone homebrew .nro files go to their own folders
 * (incoming-extras.js), copied when those sit on another mount.
 */
import { constants } from "fs";
import fsp from "fs/promises";
import path from "path";
import debug from "../debug.js";
import { parseFromFilename } from "./filename-parser.js";
import { identify as sharedIdentify, forget as sharedForget, identityFromName } from "./file-identity.js";
import { EXTRA_REASON_TEXT, planExtras } from "./incoming-extras.js";
import { sniffSystems } from "./drop-sniff.js";
import { planFolders } from "./drop-folders.js";
import { cleanName, firstName, freeFileName, isMeaningless, nameFromFile } from "./organize-naming.js";
import { fileKey } from "../helpers/hash-cache.js";
import { dlcDisplayName } from "./dlc-name.js";
import { incomingInGames } from "../helpers/envs.js";
import { isReadme } from "../helpers/readme-name.js";
import { moveNoClobber, withPartial } from "../library/safe-move.js";
import { activityText } from "./meta-messages.js";

export const GAME_RE = /\.(nsp|nsz|xci|xcz)$/i;
// A file younger than this may still be being copied into the drop box.
export const SETTLE_MS = 60_000;
export const SWEEP_MS = 60_000;
const LIST_MAX = 500;
const RECENT_MAX = 100;

// Why a file stays in the drop box, by code, in each admin page language. A held
// file carries the code (the panel shows it in the viewer's language) and the
// English text as `reason`. The other files' reasons (incoming-extras.js) are part of it.
export const REASON_TEXT = Object.freeze({
  ko: {
    noId: "타이틀 ID 를 찾지 못했습니다. 파일 이름에 [TITLEID] 를 넣거나 prod.keys 를 둡니다",
    noVersion: "버전을 알려면 prod.keys 가 필요합니다",
    delta: "델타 업데이트는 옮기지 않습니다",
    settling: "아직 복사 중인 파일입니다. 1분 동안 바뀌지 않으면 옮깁니다",
    idMismatch: "파일 이름의 ID 와 내용의 ID 가 다릅니다",
    have: "같은 ID 와 버전이 이미 라이브러리에 있습니다",
    twice: "같은 ID 와 버전이 임시 폴더에 또 있습니다",
    splitBase: "이 게임의 파일이 여러 폴더에 있어 어느 쪽인지 정하지 못했습니다",
    noFolder: "이 게임의 폴더 이름을 다른 게임이 쓰고 있어 폴더를 정하지 못했습니다. 관리 페이지에서 이름을 정하면 옮깁니다",
    taken: "같은 이름의 파일이 이미 있습니다",
    notGame: "스위치 게임 파일(nsp, nsz, xci, xcz)이 아닙니다",
    waitBase: "본편을 기다립니다. 본편이나 업데이트가 들어오거나 관리 페이지에서 이름을 정하면 옮깁니다",
    noName: "이름을 정할 정보가 없습니다. 관리 페이지에서 게임 이름을 정하면 옮깁니다",
    moveFailed: "옮기지 못했습니다",
    readFailed: "임시 폴더를 읽지 못했습니다",
    undone: "휴지통 탭에서 정리를 되돌린 파일이라 그대로 둡니다. 다시 정리하려면 휴지통 탭의 작업 기록에서 다시 정리 허용을 누릅니다",
    ...EXTRA_REASON_TEXT.ko,
  },
  en: {
    noId: "No title ID found. Put [TITLEID] in the file name or add prod.keys",
    noVersion: "prod.keys is needed to read the version",
    delta: "Delta updates are not moved",
    settling: "This file is still being copied. It moves once it has not changed for a minute",
    idMismatch: "The ID in the file name differs from the ID inside the file",
    have: "The same ID and version are already in the library",
    twice: "The same ID and version are in the drop box twice",
    splitBase: "This game's files are in more than one folder, so the folder could not be chosen",
    noFolder: "Other games use this game's folder names, so the folder could not be chosen. It moves once you set a name on the admin page",
    taken: "A file with the same name already exists",
    notGame: "Not a Switch game file (nsp, nsz, xci, xcz)",
    waitBase: "Waiting for the base game. It moves when the base game or an update arrives, or once you set a name on the admin page",
    noName: "There is nothing to name this game from. It moves once you set its name on the admin page",
    moveFailed: "Could not move the file",
    readFailed: "Could not read the drop box",
    undone: "This file is left as it is because its organizing was undone in the Trash tab. To organize it again, press Allow organizing again in the Trash tab's move log",
    ...EXTRA_REASON_TEXT.en,
  },
  ja: {
    noId: "タイトル ID が見つかりません。ファイル名に [TITLEID] を入れるか、prod.keys を置きます",
    noVersion: "バージョンを読むには prod.keys が必要です",
    delta: "差分アップデートは移しません",
    settling: "まだコピー中のファイルです。1 分間変わらなければ移します",
    idMismatch: "ファイル名の ID とファイルの中の ID が違います",
    have: "同じ ID とバージョンがすでにライブラリーにあります",
    twice: "同じ ID とバージョンが一時フォルダーにもう一つあります",
    splitBase: "このゲームのファイルが複数のフォルダーにあり、どちらか決められません",
    noFolder: "このゲームのフォルダー名をほかのゲームが使っていて、フォルダーを決められません。管理ページで名前を決めると移します",
    taken: "同じ名前のファイルがすでにあります",
    notGame: "Switch のゲームファイル(nsp、nsz、xci、xcz)ではありません",
    waitBase: "本編を待っています。本編かアップデートが届くか、管理ページで名前を決めると移します",
    noName: "名前を決める情報がありません。管理ページでゲーム名を決めると移します",
    moveFailed: "移せませんでした",
    readFailed: "一時フォルダーを読めませんでした",
    undone: "ごみ箱タブで整理を取り消したファイルなので、そのままにします。もう一度整理するには、ごみ箱タブの作業記録で「再整理を許可」を押します",
    ...EXTRA_REASON_TEXT.ja,
  },
  zh: {
    noId: "找不到标题 ID。请在文件名中加入 [TITLEID]，或放入 prod.keys",
    noVersion: "需要 prod.keys 才能读取版本",
    delta: "增量更新不会移动",
    settling: "文件仍在复制中。一分钟内没有变化后再移动",
    idMismatch: "文件名中的 ID 与文件内的 ID 不同",
    have: "游戏库中已有相同的 ID 和版本",
    twice: "临时文件夹中还有一个相同 ID 和版本的文件",
    splitBase: "这个游戏的文件分布在多个文件夹中，无法确定使用哪一个",
    noFolder: "这个游戏的文件夹名称已被其他游戏使用，无法确定文件夹。在管理页面设定名称后即会移动",
    taken: "已有同名文件",
    notGame: "不是 Switch 游戏文件(nsp、nsz、xci、xcz)",
    waitBase: "正在等待本体。本体或更新到来，或在管理页面设定名称后即会移动",
    noName: "没有可用于命名的信息。在管理页面设定游戏名称后即会移动",
    moveFailed: "无法移动",
    readFailed: "无法读取临时文件夹",
    undone: "此文件已在回收站标签页中撤销整理，因此保持原样。要重新整理，请在回收站标签页的操作记录中按“允许重新整理”",
    ...EXTRA_REASON_TEXT.zh,
  },
});

/** The English text of each hold reason, by code: what a token or a script reads. */
export const REASONS = Object.freeze({ ...REASON_TEXT.en });

export const SUB = Object.freeze({ update: "update", dlc: "DLC" });

/** True for a games-folder path inside a drop box there (`inGames`, any case). Pure. */
export const isIncoming = (rel, inGames = incomingInGames) => {
  if (!inGames) return false;
  const p = String(rel ?? "").split(/[\\/]/).join("/").toLowerCase();
  const box = inGames.toLowerCase();
  return p === box || p.startsWith(`${box}/`);
};

/** A folder name made from a title, or null. Pure. */
export const folderNameOf = cleanName;

const key = (id) => `${id.titleId}@${id.version}`;
// How two names are compared: the same text in NFC or NFD, any case, is one name.
const same = (s) => s.normalize("NFC").toLowerCase();
/** A held file: its reason as a code and in English, and `detail` for what the code leaves open. */
const heldItem = (rel, code, id = null, detail = null) => ({
  rel, code, reason: detail ? `${REASONS[code]}: ${detail}` : REASONS[code], ...(detail ? { detail } : {}), titleId: id?.titleId ?? null, kind: id?.kind ?? null,
});
const topOf = (rel) => (rel.includes("/") ? rel.split("/")[0] : null);

/** Who lives where in the games folder, from its file list (drop box left out). Pure. */
export function indexLibrary(romsRels) {
  const have = new Set();
  const familyFolders = new Map(); // base id → Set(top folder) holding any of its files
  const subNames = new Map(); // same("top/update") → the spelling on disk
  const rels = new Set(); // same(rel) of every file
  const topFolders = new Set(); // same(name) of every top-level folder
  for (const rel of romsRels) {
    if (isIncoming(rel)) continue;
    rels.add(same(rel));
    const parts = rel.split("/");
    if (parts.length > 1) topFolders.add(same(parts[0]));
    if (parts.length >= 3 && /^(update|dlc)$/i.test(parts[1])) subNames.set(same(`${parts[0]}/${parts[1]}`), parts[1]);
    const id = identityFromName(rel);
    if (!id) continue;
    have.add(key({ ...id, version: id.version ?? 0 }));
    const top = topOf(rel);
    if (top) (familyFolders.get(id.baseTitleId) ?? familyFolders.set(id.baseTitleId, new Set()).get(id.baseTitleId)).add(top);
  }
  return { have, familyFolders, subNames, rels, topFolders };
}

function dirOf(lib, folder, kind) {
  if (kind === "base") return folder;
  return `${folder}/${lib.subNames.get(same(`${folder}/${SUB[kind]}`)) ?? SUB[kind]}`;
}

/**
 * The plan. `incoming` is [{ rel, mtimeMs, id, source, nacpName? }], `rel`
 * relative to the drop box, `id` from the cnmt ("cnmt"), the name ("name") or
 * the ticket ("ticket"), or null, `nacpName` the name the file's NACP gives
 * (its game's, for a base game or an update); `romsRels` is every file in the
 * games folder; `adminName(titleId)` and `titledbName(titleId)` are a title's
 * name from the admin and from titledb, or null. Pure.
 */
export function planOrganize({ incoming = [], romsRels = [], adminName = () => null, titledbName = () => null, now = Date.now(), settleMs = SETTLE_MS }) {
  const lib = indexLibrary(romsRels);
  const moves = [];
  const held = [];
  const taken = new Set(lib.rels);
  const hold = (rel, code, id = null) => held.push(heldItem(rel, code, id));

  // Base files, then updates, go first: a new game's folder is named from them when titledb does not know the game.
  const order = { base: 0, update: 1 };
  const sorted = [...incoming].sort((a, b) => (order[a.id?.kind] ?? 2) - (order[b.id?.kind] ?? 2) || a.rel.localeCompare(b.rel));
  const batchFolders = new Map(); // base id → the new folder made for it in this batch
  const batchNames = new Map(); // base id → the game's name a file of this batch gave
  // One name per game in a batch: its base file's NACP, else its update's (bases sort first).
  const batchNacp = new Map();
  for (const f of sorted) {
    const name = f.id?.kind === "base" || f.id?.kind === "update" ? cleanName(f.nacpName) : null;
    if (name && !batchNacp.has(f.id.baseTitleId)) batchNacp.set(f.id.baseTitleId, name);
  }
  const titleOf = (tid) => firstName([adminName(tid), titledbName(tid)]);
  const isTaken = (rel) => taken.has(same(rel));
  const usedFolders = new Set(lib.topFolders);
  // A new game's folder is never one another game already has; the title id tells two same-named games apart.
  const newFolder = (title, baseId) => {
    const name = folderNameOf(title);
    if (!name) return null;
    return [name, `${name} [${baseId}]`].find((pick) => !usedFolders.has(same(pick))) ?? null;
  };
  const seen = new Set();
  for (const f of sorted) {
    if (!GAME_RE.test(f.rel)) { hold(f.rel, "notGame"); continue; }
    const id = f.id;
    if (now - f.mtimeMs < settleMs) { hold(f.rel, "settling", id); continue; }
    if (!id) { hold(f.rel, "noId"); continue; }
    if (id.kind === "delta") { hold(f.rel, "delta", id); continue; }
    // A base game without its version is almost always v0; an update or DLC must say which it is.
    const version = id.version ?? (id.kind === "base" ? 0 : null);
    if (version === null) { hold(f.rel, "noVersion", id); continue; }
    const full = { ...id, version };
    const named = parseFromFilename(f.rel).titleId;
    if (f.source === "cnmt" && named && named !== id.titleId) { hold(f.rel, "idMismatch", id); continue; }
    if (lib.have.has(key(full))) { hold(f.rel, "have", id); continue; }
    if (seen.has(key(full))) { hold(f.rel, "twice", id); continue; }
    seen.add(key(full));
    const base = id.baseTitleId;
    const family = lib.familyFolders.get(base);
    if (family && family.size > 1) { hold(f.rel, "splitBase", id); continue; }
    const known = family?.size === 1 ? [...family][0] : null;
    const fileName = path.posix.basename(f.rel);
    const own = nameFromFile(fileName);
    const gameName = titleOf(base) ?? batchNacp.get(base) ?? batchNames.get(base) ?? (id.kind === "base" ? own : null);
    const folder = known ?? batchFolders.get(base) ?? newFolder(gameName, base);
    if (!folder) {
      // Two folder names taken is a naming failure; no name yet means the game has not come (or cannot be named).
      hold(f.rel, gameName ? "noFolder" : id.kind === "base" ? "noName" : "waitBase", id);
      continue;
    }
    if (gameName && !batchNames.has(base)) batchNames.set(base, gameName);
    const name = id.kind === "dlc"
      ? firstName([titleOf(id.titleId), own && !isMeaningless(own) ? own : null, dlcDisplayName({ baseName: gameName ?? folder, titleId: id.titleId })])
      : firstName([gameName, own, folder]);
    const to = name && freeFileName(dirOf(lib, folder, id.kind), name, full, path.extname(fileName), isTaken);
    if (!to) { hold(f.rel, "taken", id); continue; }
    taken.add(same(to));
    moves.push({ from: f.rel, to, titleId: id.titleId, version, kind: id.kind, folderIsNew: !known });
    if (!known && !batchFolders.has(base)) {
      batchFolders.set(base, folder);
      usedFolders.add(same(folder));
    }
  }
  return { moves, held };
}

/** Every file under `root` as { rel, abs, size, mtimeMs, ctimeMs, ino }; dot entries and README.md files are skipped. */
export async function listFiles(root, rel = "", out = []) {
  let entries;
  try {
    entries = await fsp.readdir(rel ? path.join(root, rel) : root, { withFileTypes: true });
  } catch (err) {
    if (rel || err.code !== "ENOENT") throw err;
    return out;
  }
  for (const e of entries) {
    // A README.md is someone's notes: never sorted (.md is a Mega Drive extension), never listed as held.
    if (e.name.startsWith(".") || (e.isFile() && isReadme(e.name))) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) await listFiles(root, r, out);
    else if (e.isFile()) {
      const st = await fsp.stat(path.join(root, r)).catch(() => null);
      if (st) out.push({ rel: r, abs: path.join(root, r), size: st.size, mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs, ino: st.ino });
    }
  }
  return out;
}

/** Removes the folders `rel` leaves empty, up to (not including) `root`. */
async function dropEmptyDirs(root, rel) {
  for (let dir = path.posix.dirname(rel); dir && dir !== "."; dir = path.posix.dirname(dir)) {
    if (!(await fsp.rmdir(path.join(root, dir)).then(() => true, () => false))) break;
  }
}

async function exists(p) {
  return fsp.lstat(p).then(() => true, () => false);
}

/**
 * Moves `from` to `to` unless something is already at `to`, claiming the name in
 * the same step (library/safe-move.js). False when `to` exists.
 */
export const moveNoReplace = (from, to) => moveNoClobber(from, to);

/**
 * Moves `from` to `to` on another mount without replacing anything: a copy
 * beside `to` that is then moved into place by moveNoReplace. Same mount: a
 * plain moveNoReplace. False when `to` exists. A file that changed while it
 * was copied is still being written: the copy is dropped, `from` stays, and
 * the error's code is ECHANGED.
 */
export async function moveAcross(from, to) {
  try {
    return await moveNoReplace(from, to);
  } catch (err) {
    if (err.code !== "EXDEV") throw err;
  }
  if (await exists(to)) return false;
  // A dot name with a marker beside it: no scanner reads a copy that is not finished, and one a stop leaves is swept.
  const placed = await withPartial(from, to, async (part) => {
    const before = await fsp.stat(from);
    await fsp.copyFile(from, part, constants.COPYFILE_EXCL);
    const after = await fsp.stat(from);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      throw Object.assign(new Error(`${from} changed while it was copied`), { code: "ECHANGED" });
    }
    return moveNoReplace(part, to);
  });
  if (!placed) return false;
  await fsp.rm(from, { force: true });
  return true;
}

/**
 * The drop box service: a sweep every SWEEP_MS (and on demand) that reads what
 * is in the drop box, moves what can go and keeps what cannot with why.
 * `deps` are the outside world, so tests can stand in:
 *   incomingDir        the drop box
 *   romsDir            the games folder
 *   romsRels()         every file the library lists (relative paths)
 *   identify(file), forget(abs)   file-identity.js (the shared one by default)
 *   adminName(titleId), titledbName(titleId)   a title's name from the admin and from titledb, or null
 *   readNacpName(file, id)   the game's name from a base game's or an update's NACP, or null;
 *                      asked only when the admin and titledb have none, once per file (fileKey);
 *                      a failed read is tried again when nacpEpoch() changes or a sweep asks to retry
 *   nacpEpoch()        what a NACP read depends on (keys, nstool), as a comparable value
 *   retroDir, homebrewDir, systems()   where the other files go, and loadSystems()
 *   placeFolder(kind, items, body)   puts a folder-shaped drop ("patch" | "homebrew") in place with the upload page's own code; optional
 *   identifyRoms(files, refs, systems)   rel → { systems, name } for the files a hash database lists (drop-hash.js); optional
 *   readRefs(abs)      the files a .cue / .m3u names, relative to its folder
 *   begin(kind, opts)  an activity job
 *   rescan()           after games moved; rescanRetro(), rescanHomebrew() after those
 *   journal({ action, from, to })   notes each move (absolute paths) in the operations journal, so it can be undone
 *   undone()           files an undo put back in the drop box: [{ rel, size, mtimeMs }]. Each stays where it
 *                      is while it is that same file, until the admin releases it (library/journal.js)
 */
export function createOrganizer(deps) {
  const dir = deps.incomingDir;
  const identify = deps.identify ?? sharedIdentify;
  const forget = deps.forget ?? sharedForget;
  const adminName = deps.adminName ?? (() => null);
  const titledbName = deps.titledbName ?? (() => null);
  const nacpNames = new Map(); // abs → { key: fileKey, name, epoch }
  let state = { held: [], recent: [], sweptAt: null, error: null, errorCode: null, waiting: 0 };
  let running = null;
  let timer = null;

  /** Each settled .cue / .m3u in the drop box → the drop-box rels it names. */
  async function listRefs(files) {
    const refs = new Map();
    for (const f of files) {
      if (!/\.(cue|m3u)$/i.test(f.rel) || f.size > 64 * 1024) continue;
      const names = await deps.readRefs(f.abs).catch(() => []);
      const at = path.posix.dirname(f.rel);
      refs.set(f.rel, names.map((n) => path.posix.normalize(at === "." ? n.replace(/\\/g, "/") : `${at}/${n.replace(/\\/g, "/")}`)));
    }
    return refs;
  }

  /** The drop-box files an undo put back that must stay: rel → true while size and mtime still match. */
  async function undoneSet(files) {
    const list = await Promise.resolve(deps.undone?.() ?? []).catch(() => []);
    const want = new Map(list.map((u) => [u.rel, u]));
    return new Set(files.filter((f) => {
      const u = want.get(f.rel);
      return u && u.size === f.size && Math.round(u.mtimeMs) === Math.round(f.mtimeMs);
    }).map((f) => f.rel));
  }

  /**
   * The NACP's name for a settled base game or update whose game the admin and
   * titledb cannot name. A name is kept while the file is the same file; a
   * failed read only while `epoch` is the same and no retry was asked for.
   */
  async function nacpNameOf(f, id, { epoch, retry }) {
    if (!deps.readNacpName || !id || (id.kind !== "base" && id.kind !== "update")) return null;
    if (firstName([adminName(id.baseTitleId), titledbName(id.baseTitleId)])) return null;
    const fk = fileKey(f);
    const hit = nacpNames.get(f.abs);
    if (hit?.key === fk && (hit.name || (!retry && hit.epoch === epoch))) return hit.name;
    const name = await deps.readNacpName(f, id).catch(() => null);
    nacpNames.set(f.abs, { key: fk, name, epoch });
    return name;
  }

  async function sweepOnce({ retry = false, whole = new Set() } = {}) {
    const all = await listFiles(dir);
    const keep = await undoneSet(all);
    const kept = all.filter((f) => keep.has(f.rel)).map((f) => heldItem(f.rel, "undone"));
    const files = all.filter((f) => !keep.has(f.rel));
    if (!files.length) {
      state = { ...state, held: kept, sweptAt: new Date().toISOString(), error: null, waiting: 0 };
      return { moved: 0 };
    }
    const now = Date.now();
    const epoch = deps.nacpEpoch ? await deps.nacpEpoch().catch(() => null) : null;
    const items = [];
    const others = [];
    const settling = [];
    for (const f of files) {
      // A file still being copied is not opened yet; one the caller put there whole needs no wait.
      const settled = whole.has(f.rel) || now - f.mtimeMs >= SETTLE_MS;
      if (!GAME_RE.test(f.rel)) {
        if (settled) others.push(f);
        else settling.push(heldItem(f.rel, "settling"));
        continue;
      }
      const read = settled ? await identify(f) : { id: identityFromName(f.rel), source: "name" };
      const nacpName = settled ? await nacpNameOf(f, read.id, { epoch, retry }) : null;
      items.push({ rel: f.rel, mtimeMs: settled ? Math.min(f.mtimeMs, now - SETTLE_MS) : f.mtimeMs, id: read.id, source: read.source, nacpName });
    }
    const present = new Set(files.map((f) => f.abs));
    for (const abs of nacpNames.keys()) if (!present.has(abs)) nacpNames.delete(abs);
    const plan = planOrganize({ incoming: items, romsRels: await deps.romsRels(), adminName, titledbName, now });
    const systems = deps.systems();
    const folders = planFolders(others, systems, files.filter((f) => !whole.has(f.rel) && now - f.mtimeMs < SETTLE_MS).map((f) => f.rel));
    const refs = await listRefs(folders.rest);
    const identified = deps.identifyRoms ? await deps.identifyRoms(folders.rest, refs, systems).catch(() => new Map()) : new Map();
    const extras = planExtras({ items: folders.rest, refs, sniffed: await sniffSystems(folders.rest, refs, systems), identified, systems });
    const moves = [...plan.moves.map((m) => ({ ...m, root: "games" })), ...folders.moves, ...extras.moves];
    const rootDir = { games: deps.romsDir, retro: deps.retroDir, homebrew: deps.homebrewDir };
    const movedIn = { games: 0, retro: 0, homebrew: 0, folders: 0 };
    const job = moves.length ? deps.begin("organize", { title: activityText("act.organize"), total: moves.length }) : null;
    const failed = [];
    for (const [i, m] of moves.entries()) {
      const from = path.join(dir, m.from);
      const to = path.join(rootDir[m.root], m.to);
      try {
        await fsp.mkdir(path.dirname(to), { recursive: true });
        if (await moveAcross(from, to)) {
          movedIn[m.root]++;
          await deps.journal?.({ action: "organize", from, to });
          forget(from);
          await dropEmptyDirs(dir, m.from);
          state.recent = [{ ...m, at: new Date().toISOString() }, ...state.recent].slice(0, RECENT_MAX);
        } else failed.push(heldItem(m.from, "taken", m));
      } catch (err) {
        failed.push(err.code === "ECHANGED" ? heldItem(m.from, "settling", m) : heldItem(m.from, "moveFailed", m, err.code ?? err.message));
      }
      job?.step(i + 1, m.to);
    }
    const folderHeld = folders.held.map((h) => heldItem(h.rel, h.code));
    for (const g of folders.groups) {
      const files = g.files.map((f) => f.rel);
      if (!deps.placeFolder) { folderHeld.push(...files.map((rel) => heldItem(rel, g.kind === "patch" ? "patch" : "homebrewFolder"))); continue; }
      try {
        const res = await deps.placeFolder(g.kind, g.files.map((f) => ({ abs: path.join(dir, f.rel), rel: f.inner })), g.body);
        for (const rel of files) {
          forget(path.join(dir, rel));
          await dropEmptyDirs(dir, rel);
        }
        movedIn.folders += 1;
        state.recent = [{ from: g.root, to: res.where, root: g.kind, by: "folder", at: new Date().toISOString() }, ...state.recent].slice(0, RECENT_MAX);
      } catch (err) {
        folderHeld.push(...files.map((rel) => heldItem(rel, "moveFailed", { from: g.root }, err.key ?? err.code ?? err.message)));
      }
    }
    const placed = new Set(moves.filter((m) => !failed.some((f) => f.rel === m.from)).map((m) => m.to));
    for (const w of extras.writes) {
      if (!w.after.every((t) => placed.has(t))) continue;
      const to = path.join(rootDir[w.root], w.to);
      try {
        await fsp.writeFile(to, w.content, { flag: "wx" });
      } catch (err) {
        if (err.code !== "EEXIST") debug.error("organize: could not write %s: %s", to, err.message);
      }
    }
    const moved = movedIn.games + movedIn.retro + movedIn.homebrew + movedIn.folders;
    job?.done(activityText("act.organized", { n: moved }));
    if (movedIn.games) deps.rescan();
    if (movedIn.retro) deps.rescanRetro();
    if (movedIn.homebrew) deps.rescanHomebrew();
    const held = [...kept, ...settling, ...plan.held, ...folderHeld, ...extras.held, ...failed];
    state = { ...state, held, sweptAt: new Date().toISOString(), error: null, errorCode: null, errorDetail: null, waiting: held.filter((h) => h.code === "settling").length };
    return { moved };
  }

  /**
   * Sorts the drop box now; one sweep at a time (a second call waits for the
   * running one). `retry` reads again the NACPs that could not be read before; `whole` is the
   * drop-box rels the caller wrote completely (an upload), sorted without waiting for them to settle,
   * after a sweep already running.
   */
  async function sweep({ retry = false, whole = null } = {}) {
    if (whole?.size && running) await running;
    running ??= sweepOnce({ retry, whole: whole ?? new Set() })
      .catch((err) => {
        state = { ...state, error: `${REASONS.readFailed}: ${err.message}`, errorCode: "readFailed", errorDetail: err.message, sweptAt: new Date().toISOString() };
        return { moved: 0 };
      })
      .finally(() => { running = null; });
    return running;
  }

  function view() {
    return {
      incoming: dir,
      sweptAt: state.sweptAt,
      error: state.error,
      errorCode: state.errorCode ?? null,
      errorDetail: state.errorDetail ?? null,
      running: Boolean(running),
      held: state.held.slice(0, LIST_MAX),
      heldCount: state.held.length,
      waiting: state.waiting,
      recent: state.recent,
      // The folder names a ROM can be dropped under, one per system.
      systems: Object.entries(deps.systems?.() ?? {}).map(([id, s]) => ({ folder: id, name: s.names?.ko ?? s.names?.en ?? id })),
    };
  }

  function start() {
    if (timer) return;
    fsp.mkdir(dir, { recursive: true }).catch(() => {});
    timer = setInterval(() => sweep(), SWEEP_MS);
    timer.unref?.();
    sweep();
  }

  function stop() {
    clearInterval(timer);
    timer = null;
  }

  return { view, sweep, start, stop, dir };
}
