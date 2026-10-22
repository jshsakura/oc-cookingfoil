/**
 * The operations journal: every rename or move the server makes of a file in a
 * library folder (the drop box sorting a file into the games folder, a patch
 * or save moved to another game), so each can be undone.
 *
 *   <root>/.cookingfoil-trash/journal.jsonl   one JSON line per move, in the root the file went to:
 *     { id, at, action, by, fromRoot, from, toRoot, to, type, size, files, mtimeMs }
 *     { undo: <id>, at, by }                  written when that move was undone
 *     { release: <id>, at, by }               the admin let the drop box sort an undone file again
 *
 * Like the trash, the file is the truth. An undo moves the file back only when
 * its old place is still free and the file is the one that was moved (same
 * size and mtime, or for a folder the same bytes and file count): nothing is
 * overwritten, and a file changed since is left alone. The move back claims its
 * place in the same step that fills it (safe-move.js), and undos and the
 * trash's own moves of one folder run one at a time, so nothing racing for the
 * same name is ever replaced.
 *
 * A file the drop box sorted and the admin undid is back in the drop box; the
 * drop box must leave it there (undoneHeld), or it would be sorted again within
 * a minute. It stays put while it is the same file (size and mtime) until the
 * admin releases it (releaseUndone).
 *
 * The file keeps the newest JOURNAL_KEEP moves: past JOURNAL_KEEP + JOURNAL_SLACK
 * lines it is rewritten without the oldest ones.
 */
import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { TRASH_DIR, TrashError, cleanRel, measure } from "./trash.js";
import { moveAcross, realInside, withLocks } from "./safe-move.js";

export const JOURNAL_FILE = "journal.jsonl";
export const JOURNAL_KEEP = 2000;
export const JOURNAL_SLACK = 500;
// How often (in lines appended by this process) the length is checked: reading it every time is quadratic.
export const TRIM_EVERY = 100;
const appended = new Map();
const ID_RE = /^[0-9a-f]{12}$/;

const journalOf = (root) => path.join(root.dir, TRASH_DIR, JOURNAL_FILE);

async function append(root, line) {
  const file = journalOf(root);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.appendFile(file, `${JSON.stringify(line)}\n`);
}

/** Keeps the newest JOURNAL_KEEP moves with their undo and release lines, once the file is past the slack. */
async function trim(root) {
  const file0 = journalOf(root);
  const count = (appended.get(file0) ?? 0) + 1;
  appended.set(file0, count);
  if (count % TRIM_EVERY !== 1) return;
  const lines = readLines(root);
  if (lines.length <= JOURNAL_KEEP + JOURNAL_SLACK) return;
  const ops = lines.filter((l) => l.id);
  const keep = new Set(ops.slice(-JOURNAL_KEEP).map((l) => l.id));
  const kept = lines.filter((l) => keep.has(l.id) || keep.has(l.undo) || keep.has(l.release));
  const file = journalOf(root);
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, kept.map((l) => `${JSON.stringify(l)}\n`).join(""));
  await fsp.rename(tmp, file);
}

function readLines(root) {
  let text;
  try {
    text = fs.readFileSync(journalOf(root), "utf8");
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // A line cut by a stop: the rest still reads.
    }
  }
  return out;
}

/**
 * Notes a move that has just happened: `from` in `fromRoot` is now `to` in
 * `toRoot` (roots are { key, dir }). Never throws: a move is not undone
 * because its note could not be written. Returns the line, or null.
 */
export async function recordMove({ action, by = null, fromRoot, from, toRoot, to, extra = {}, now = Date.now() }) {
  try {
    const a = cleanRel(from);
    const b = cleanRel(to);
    if (!a || !b) return null;
    const st = await measure(path.join(toRoot.dir, ...b.split("/")));
    const line = { ...extra, id: crypto.randomBytes(6).toString("hex"), at: now, action, by, fromRoot: fromRoot.key, from: a, toRoot: toRoot.key, to: b, ...st };
    await withLocks([journalOf(toRoot)], async () => {
      await append(toRoot, line);
      await trim(toRoot);
    });
    return line;
  } catch {
    return null;
  }
}

/** Whether a move can be undone now, and why not: { ok, reason }. */
async function undoable(op, roots) {
  const fromRoot = roots.find((r) => r.key === op.fromRoot);
  const toRoot = roots.find((r) => r.key === op.toRoot);
  if (!fromRoot || !toRoot) return { ok: false, reason: "gone-root" };
  if (cleanRel(op.from) !== op.from || cleanRel(op.to) !== op.to) return { ok: false, reason: "bad-path" };
  const now = await measure(path.join(toRoot.dir, ...op.to.split("/"))).catch(() => null);
  if (!now) return { ok: false, reason: "missing" };
  const same = now.type === op.type && now.size === op.size && (op.type === "dir" ? now.files === op.files : Math.round(now.mtimeMs) === Math.round(op.mtimeMs));
  if (!same) return { ok: false, reason: "changed" };
  if (await fsp.lstat(path.join(fromRoot.dir, ...op.from.split("/"))).then(() => true, () => false)) return { ok: false, reason: "taken" };
  return { ok: true, reason: null };
}

/** Moves across every root, newest first, at most `limit`: [{ ...line, undone, undoable, reason }]. */
export async function listJournal(roots, { limit = 200 } = {}) {
  const ops = [];
  for (const r of roots) {
    const lines = readLines(r);
    const undone = new Map(lines.filter((l) => l.undo).map((l) => [l.undo, l]));
    const released = new Map(lines.filter((l) => l.release).map((l) => [l.release, l]));
    for (const l of lines) if (ID_RE.test(l.id ?? "") && l.from && l.to) ops.push({ ...l, journal: r.key, undone: undone.get(l.id) ?? null, released: released.get(l.id) ?? null });
  }
  ops.sort((a, b) => b.at - a.at);
  const page = ops.slice(0, limit);
  for (const op of page) Object.assign(op, op.undone ? { undoable: false, reason: "undone" } : await undoable(op, roots).then(({ ok, reason }) => ({ undoable: ok, reason })));
  return { items: page, total: ops.length };
}

/** The line of a move by id ("<journal root>:<id>" or an id): { root, lines, op }, or null. */
function findOp(roots, id) {
  const want = String(id ?? "").split(":").pop();
  if (!ID_RE.test(want)) return null;
  for (const r of roots) {
    const lines = readLines(r);
    const op = lines.find((l) => l.id === want);
    if (op) return { root: r, lines, op, want };
  }
  return null;
}

const REFUSED = {
  "gone-root": "그 폴더를 더 이상 쓰지 않습니다",
  "bad-path": "작업 기록의 경로가 맞지 않아 되돌리지 않습니다",
  missing: "옮긴 파일이 그 자리에 없습니다",
  changed: "옮긴 뒤에 파일이 바뀌어 되돌리지 않습니다",
  taken: "원래 자리에 다른 파일이 있어 되돌리지 않습니다",
};

/**
 * Undoes one move ("<journal root>:<id>" or an id). `after(op, abs)` runs once
 * the item is back at `abs`, for what a move changed besides the place (a
 * patch's own title id paths). Returns { from, to } as moved back.
 */
export async function undoMove(roots, id, { by = null, now = Date.now(), after = null } = {}) {
  const first = findOp(roots, id);
  if (!first) throw new TrashError("작업 기록에 없는 항목입니다", 404);
  const fromRoot = roots.find((x) => x.key === first.op.fromRoot);
  const toRoot = roots.find((x) => x.key === first.op.toRoot);
  const locks = [first.root.dir, fromRoot?.dir, toRoot?.dir].filter(Boolean);
  return withLocks(locks, async () => {
    // Read again under the locks: a second undo of the same move waits for the first and then sees its line.
    const { root: r, lines, op, want } = findOp(roots, id);
    if (lines.some((l) => l.undo === want)) throw new TrashError("이미 되돌린 작업입니다");
    const check = await undoable(op, roots);
    if (!check.ok) throw new TrashError(REFUSED[check.reason]);
    const back = path.join(fromRoot.dir, ...op.from.split("/"));
    if (!(await realInside(fromRoot.dir, back))) throw new TrashError(REFUSED["bad-path"]);
    const st = await measure(path.join(toRoot.dir, ...op.to.split("/")));
    if (!(await moveAcross(path.join(toRoot.dir, ...op.to.split("/")), back))) throw new TrashError(REFUSED.taken);
    if (after) await after(op, back);
    // The folder the move left empty goes too, up to the root.
    for (let dir = path.posix.dirname(op.to); dir && dir !== "."; dir = path.posix.dirname(dir)) {
      if (!(await fsp.rmdir(path.join(toRoot.dir, ...dir.split("/"))).then(() => true, () => false))) break;
    }
    // What came back, so the drop box can tell it is the same file it must leave alone.
    await withLocks([journalOf(r)], () => append(r, { undo: want, at: now, by, back: { root: op.fromRoot, rel: op.from, size: st.size, mtimeMs: st.mtimeMs, type: st.type } }));
    return { id: want, action: op.action, fromRoot: op.fromRoot, from: op.from, toRoot: op.toRoot, to: op.to };
  });
}

/**
 * Files undone back into root `key` that must stay where they are: [{ id, rel, size, mtimeMs }]
 * for each undo not released yet. The drop box leaves a file alone while it matches one.
 */
export function undoneHeld(roots, key) {
  const out = [];
  for (const r of roots) {
    const lines = readLines(r);
    const released = new Set(lines.filter((l) => l.release).map((l) => l.release));
    for (const l of lines) {
      if (!l.undo || released.has(l.undo) || l.back?.root !== key || !cleanRel(l.back.rel)) continue;
      out.push({ id: l.undo, rel: l.back.rel, size: l.back.size, mtimeMs: l.back.mtimeMs });
    }
  }
  return out;
}

/** Lets the drop box sort an undone file again (the id of the move that was undone). */
export async function releaseUndone(roots, id, { by = null, now = Date.now() } = {}) {
  const found = findOp(roots, id);
  if (!found) throw new TrashError("작업 기록에 없는 항목입니다", 404);
  const { root: r, lines, want } = found;
  if (!lines.some((l) => l.undo === want)) throw new TrashError("되돌린 작업이 아닙니다");
  if (lines.some((l) => l.release === want)) return { id: want, released: false };
  await withLocks([journalOf(r)], () => append(r, { release: want, at: now, by }));
  return { id: want, released: true };
}
