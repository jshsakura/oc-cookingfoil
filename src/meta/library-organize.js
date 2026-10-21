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
 * gets one named after it (titledb's Korean or English name, else the file
 * name). The file itself goes in with [TITLEID][vN] added to its name, which
 * is what the shop reads. Files already in the games folder are never moved.
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
import { parseFromFilename } from "./filename-parser.js";
import { identify as sharedIdentify, forget as sharedForget, identityFromName } from "./file-identity.js";
import { planExtras } from "./incoming-extras.js";
import { incomingInGames } from "../helpers/envs.js";

export const GAME_RE = /\.(nsp|nsz|xci|xcz)$/i;
// A file younger than this may still be being copied into the drop box.
export const SETTLE_MS = 60_000;
export const SWEEP_MS = 60_000;
const FOLDER_MAX = 100;
const LIST_MAX = 500;
const RECENT_MAX = 100;

export const REASONS = Object.freeze({
  noId: "타이틀 ID 를 찾지 못했습니다. 파일 이름에 [TITLEID] 를 넣거나 prod.keys 를 둡니다",
  noVersion: "버전을 알려면 prod.keys 가 필요합니다",
  delta: "델타 업데이트는 옮기지 않습니다",
  settling: "아직 복사 중인 파일입니다. 1분 동안 바뀌지 않으면 옮깁니다",
  idMismatch: "파일 이름의 ID 와 내용의 ID 가 다릅니다",
  have: "같은 ID 와 버전이 이미 라이브러리에 있습니다",
  twice: "같은 ID 와 버전이 임시 폴더에 또 있습니다",
  splitBase: "이 게임의 파일이 여러 폴더에 있어 어느 쪽인지 정하지 못했습니다",
  noFolder: "폴더 이름을 정하지 못했습니다",
  taken: "같은 이름의 파일이 이미 있습니다",
  notGame: "스위치 게임 파일(nsp, nsz, xci, xcz)이 아닙니다",
});

const SUB = { update: "update", dlc: "DLC" };

/** True for a games-folder path inside a drop box there (`inGames`, any case). Pure. */
export const isIncoming = (rel, inGames = incomingInGames) => {
  if (!inGames) return false;
  const p = String(rel ?? "").split(/[\\/]/).join("/").toLowerCase();
  const box = inGames.toLowerCase();
  return p === box || p.startsWith(`${box}/`);
};

/** A folder name made from a title, or null. Pure. */
export function folderNameOf(title) {
  const name = String(title ?? "")
    .normalize("NFC")
    .replace(/\s*:\s*/g, " - ")
    .replace(/[\\/*?"<>|\x00-\x1f\x7f]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "")
    .slice(0, FOLDER_MAX)
    .trim();
  return name || null;
}

/** The file name with [TITLEID] and [vN] in it, adding what is missing. Pure. */
export function taggedName(fileName, { titleId, version }) {
  const ext = path.extname(fileName);
  let stem = fileName.slice(0, fileName.length - ext.length);
  if (!/\[[0-9A-Fa-f]{16}\]/.test(stem)) stem = `${stem.trimEnd()} [${titleId}]`;
  if (!/\[v\d+\]/i.test(stem)) stem = stem.replace(/\[[0-9A-Fa-f]{16}\]/, (m) => `${m}[v${version}]`);
  return stem + ext;
}

const key = (id) => `${id.titleId}@${id.version}`;
const topOf = (rel) => (rel.includes("/") ? rel.split("/")[0] : null);

/** Who lives where in the games folder, from its file list (drop box left out). Pure. */
export function indexLibrary(romsRels) {
  const have = new Set();
  const familyFolders = new Map(); // base id → Set(top folder) holding any of its files
  const subNames = new Map(); // "top/update" in lower case → the spelling on disk
  const rels = new Set();
  const topFolders = new Set(); // every top-level folder, lower case
  for (const rel of romsRels) {
    if (isIncoming(rel)) continue;
    rels.add(rel.toLowerCase());
    const parts = rel.split("/");
    if (parts.length > 1) topFolders.add(parts[0].toLowerCase());
    if (parts.length >= 3 && /^(update|dlc)$/i.test(parts[1])) subNames.set(`${parts[0]}/${parts[1]}`.toLowerCase(), parts[1]);
    const id = identityFromName(rel);
    if (!id) continue;
    have.add(key({ ...id, version: id.version ?? 0 }));
    const top = topOf(rel);
    if (top) (familyFolders.get(id.baseTitleId) ?? familyFolders.set(id.baseTitleId, new Set()).get(id.baseTitleId)).add(top);
  }
  return { have, familyFolders, subNames, rels, topFolders };
}

function destOf(lib, folder, kind, fileName) {
  if (kind === "base") return `${folder}/${fileName}`;
  const sub = lib.subNames.get(`${folder}/${SUB[kind]}`.toLowerCase()) ?? SUB[kind];
  return `${folder}/${sub}/${fileName}`;
}

/**
 * The plan. `incoming` is [{ rel, mtimeMs, id, source }], `rel` relative to the
 * drop box, `id` from the cnmt ("cnmt"), the name ("name") or the ticket
 * ("ticket"), or null; `romsRels` is every file in the games folder;
 * `nameOf(baseTitleId)` is the game's title or null. Pure.
 */
export function planOrganize({ incoming = [], romsRels = [], nameOf = () => null, now = Date.now(), settleMs = SETTLE_MS }) {
  const lib = indexLibrary(romsRels);
  const moves = [];
  const held = [];
  const taken = new Set(lib.rels);
  const hold = (rel, reason, id = null) => held.push({ rel, reason, titleId: id?.titleId ?? null, kind: id?.kind ?? null });

  // Base files go first, so a new game's folder is named from its base file when the title is unknown.
  const order = { base: 0 };
  const sorted = [...incoming].sort((a, b) => (order[a.id?.kind] ?? 1) - (order[b.id?.kind] ?? 1) || a.rel.localeCompare(b.rel));
  const batchFolders = new Map(); // base id → the new folder made for it in this batch
  const usedFolders = new Set(lib.topFolders);
  // A new game's folder is never one another game already has; the title id tells two same-named games apart.
  const newFolder = (title, baseId) => {
    const name = folderNameOf(title);
    if (!name) return null;
    return [name, `${name} [${baseId}]`].find((pick) => !usedFolders.has(pick.toLowerCase())) ?? null;
  };
  const seen = new Set();
  for (const f of sorted) {
    if (!GAME_RE.test(f.rel)) { hold(f.rel, REASONS.notGame); continue; }
    const id = f.id;
    if (now - f.mtimeMs < settleMs) { hold(f.rel, REASONS.settling, id); continue; }
    if (!id) { hold(f.rel, REASONS.noId); continue; }
    if (id.kind === "delta") { hold(f.rel, REASONS.delta, id); continue; }
    // A base game without its version is almost always v0; an update or DLC must say which it is.
    const version = id.version ?? (id.kind === "base" ? 0 : null);
    if (version === null) { hold(f.rel, REASONS.noVersion, id); continue; }
    const full = { ...id, version };
    const named = parseFromFilename(f.rel).titleId;
    if (f.source === "cnmt" && named && named !== id.titleId) { hold(f.rel, REASONS.idMismatch, id); continue; }
    if (lib.have.has(key(full))) { hold(f.rel, REASONS.have, id); continue; }
    if (seen.has(key(full))) { hold(f.rel, REASONS.twice, id); continue; }
    seen.add(key(full));
    const base = id.baseTitleId;
    const family = lib.familyFolders.get(base);
    if (family && family.size > 1) { hold(f.rel, REASONS.splitBase, id); continue; }
    const known = family?.size === 1 ? [...family][0] : null;
    const fileName = path.posix.basename(f.rel);
    const title = nameOf(base) ?? (id.kind === "base" ? parseFromFilename(fileName).name : null);
    const folder = known ?? batchFolders.get(base) ?? newFolder(title, base);
    if (!folder) { hold(f.rel, REASONS.noFolder, id); continue; }
    const to = destOf(lib, folder, id.kind, taggedName(fileName, full));
    if (taken.has(to.toLowerCase())) { hold(f.rel, REASONS.taken, id); continue; }
    taken.add(to.toLowerCase());
    moves.push({ from: f.rel, to, titleId: id.titleId, version, kind: id.kind, folderIsNew: !known });
    if (!known && !batchFolders.has(base)) {
      batchFolders.set(base, folder);
      usedFolders.add(folder.toLowerCase());
    }
  }
  return { moves, held };
}

/** Every file under `root` as { rel, abs, size, mtimeMs }; dot entries are skipped. */
export async function listFiles(root, rel = "", out = []) {
  let entries;
  try {
    entries = await fsp.readdir(rel ? path.join(root, rel) : root, { withFileTypes: true });
  } catch (err) {
    if (rel || err.code !== "ENOENT") throw err;
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) await listFiles(root, r, out);
    else if (e.isFile()) {
      const st = await fsp.stat(path.join(root, r)).catch(() => null);
      if (st) out.push({ rel: r, abs: path.join(root, r), size: st.size, mtimeMs: st.mtimeMs });
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
 * Moves `from` to `to` unless something is already at `to`: a hard link fails
 * on an existing name where a rename would replace it. False when `to` exists.
 */
export async function moveNoReplace(from, to) {
  try {
    await fsp.link(from, to);
  } catch (err) {
    if (err.code === "EEXIST") return false;
    if (err.code !== "EPERM" && err.code !== "ENOTSUP" && err.code !== "EOPNOTSUPP") throw err;
    // A filesystem without hard links: check, then rename.
    if (await exists(to)) return false;
    await fsp.rename(from, to);
    return true;
  }
  await fsp.unlink(from);
  return true;
}

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
  const part = `${to}.${process.pid}-${Date.now()}.part`;
  try {
    const before = await fsp.stat(from);
    await fsp.copyFile(from, part, constants.COPYFILE_EXCL);
    const after = await fsp.stat(from);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      throw Object.assign(new Error(`${from} changed while it was copied`), { code: "ECHANGED" });
    }
    if (!(await moveNoReplace(part, to))) return false;
  } finally {
    await fsp.rm(part, { force: true });
  }
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
 *   nameOf(baseId)     the game's title, or null
 *   retroDir, homebrewDir, systems()   where the other files go, and loadSystems()
 *   readRefs(abs)      the files a .cue / .m3u names, relative to its folder
 *   begin(kind, opts)  an activity job
 *   rescan()           after games moved; rescanRetro(), rescanHomebrew() after those
 */
export function createOrganizer(deps) {
  const dir = deps.incomingDir;
  const identify = deps.identify ?? sharedIdentify;
  const forget = deps.forget ?? sharedForget;
  let state = { held: [], recent: [], sweptAt: null, error: null, waiting: 0 };
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

  async function sweepOnce() {
    const files = await listFiles(dir);
    if (!files.length) {
      state = { ...state, held: [], sweptAt: new Date().toISOString(), error: null, waiting: 0 };
      return { moved: 0 };
    }
    const now = Date.now();
    const items = [];
    const others = [];
    const settling = [];
    for (const f of files) {
      // A file still being copied is not opened yet.
      const settled = now - f.mtimeMs >= SETTLE_MS;
      if (!GAME_RE.test(f.rel)) {
        if (settled) others.push(f);
        else settling.push({ rel: f.rel, reason: REASONS.settling, titleId: null, kind: null });
        continue;
      }
      const read = settled ? await identify(f) : { id: identityFromName(f.rel), source: "name" };
      items.push({ rel: f.rel, mtimeMs: f.mtimeMs, id: read.id, source: read.source });
    }
    const plan = planOrganize({ incoming: items, romsRels: await deps.romsRels(), nameOf: deps.nameOf, now });
    const extras = planExtras({ items: others, refs: await listRefs(others), systems: deps.systems() });
    const moves = [...plan.moves.map((m) => ({ ...m, root: "games" })), ...extras.moves];
    const rootDir = { games: deps.romsDir, retro: deps.retroDir, homebrew: deps.homebrewDir };
    const movedIn = { games: 0, retro: 0, homebrew: 0 };
    const job = moves.length ? deps.begin("organize", { title: "임시 폴더의 파일을 옮깁니다", total: moves.length }) : null;
    const failed = [];
    for (const [i, m] of moves.entries()) {
      const from = path.join(dir, m.from);
      const to = path.join(rootDir[m.root], m.to);
      try {
        await fsp.mkdir(path.dirname(to), { recursive: true });
        if (await moveAcross(from, to)) {
          movedIn[m.root]++;
          forget(from);
          await dropEmptyDirs(dir, m.from);
          state.recent = [{ ...m, at: new Date().toISOString() }, ...state.recent].slice(0, RECENT_MAX);
        } else failed.push({ rel: m.from, reason: REASONS.taken, titleId: m.titleId ?? null, kind: m.kind ?? null });
      } catch (err) {
        const reason = err.code === "ECHANGED" ? REASONS.settling : `옮기지 못했습니다: ${err.code ?? err.message}`;
        failed.push({ rel: m.from, reason, titleId: m.titleId ?? null, kind: m.kind ?? null });
      }
      job?.step(i + 1, m.to);
    }
    const moved = movedIn.games + movedIn.retro + movedIn.homebrew;
    job?.done(`${moved}개 옮겼습니다`);
    if (movedIn.games) deps.rescan();
    if (movedIn.retro) deps.rescanRetro();
    if (movedIn.homebrew) deps.rescanHomebrew();
    const held = [...settling, ...plan.held, ...extras.held, ...failed];
    state = { ...state, held, sweptAt: new Date().toISOString(), error: null, waiting: held.filter((h) => h.reason === REASONS.settling).length };
    return { moved };
  }

  /** Sorts the drop box now; one sweep at a time (a second call waits for the running one). */
  function sweep() {
    running ??= sweepOnce()
      .catch((err) => {
        state = { ...state, error: `임시 폴더를 읽지 못했습니다: ${err.message}`, sweptAt: new Date().toISOString() };
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
