/**
 * The operations journal: every rename or move the server makes of a file in a
 * library folder (the drop box sorting a file into the games folder, a patch
 * or save moved to another game), so each can be undone.
 *
 *   <root>/.cookingfoil-trash/journal.jsonl   one JSON line per move, in the root the file went to:
 *     { id, at, action, by, fromRoot, from, toRoot, to, type, size, files, mtimeMs }
 *     { undo: <id>, at, by }                  written when that move was undone
 *
 * Like the trash, the file is the truth. An undo moves the file back only when
 * its old place is still free and the file is the one that was moved (same
 * size and mtime, or for a folder the same bytes and file count): nothing is
 * overwritten, and a file changed since is left alone.
 */
import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { TRASH_DIR, TrashError, cleanRel, measure, moveItem } from "./trash.js";

export const JOURNAL_FILE = "journal.jsonl";
const ID_RE = /^[0-9a-f]{12}$/;

const journalOf = (root) => path.join(root.dir, TRASH_DIR, JOURNAL_FILE);

async function append(root, line) {
  const file = journalOf(root);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.appendFile(file, `${JSON.stringify(line)}\n`);
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
    await append(toRoot, line);
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
    for (const l of lines) if (ID_RE.test(l.id ?? "") && l.from && l.to) ops.push({ ...l, journal: r.key, undone: undone.get(l.id) ?? null });
  }
  ops.sort((a, b) => b.at - a.at);
  const page = ops.slice(0, limit);
  for (const op of page) Object.assign(op, op.undone ? { undoable: false, reason: "undone" } : await undoable(op, roots).then(({ ok, reason }) => ({ undoable: ok, reason })));
  return { items: page, total: ops.length };
}

/**
 * Undoes one move ("<journal root>:<id>" or an id). `after(op, abs)` runs once
 * the item is back at `abs`, for what a move changed besides the place (a
 * patch's own title id paths). Returns { from, to } as moved back.
 */
export async function undoMove(roots, id, { by = null, now = Date.now(), after = null } = {}) {
  const want = String(id ?? "").split(":").pop();
  if (!ID_RE.test(want)) throw new TrashError("작업 기록에 없는 항목입니다", 404);
  for (const r of roots) {
    const lines = readLines(r);
    const op = lines.find((l) => l.id === want);
    if (!op) continue;
    if (lines.some((l) => l.undo === want)) throw new TrashError("이미 되돌린 작업입니다");
    const check = await undoable(op, roots);
    if (!check.ok) {
      throw new TrashError({
        "gone-root": "그 폴더를 더 이상 쓰지 않습니다",
        missing: "옮긴 파일이 그 자리에 없습니다",
        changed: "옮긴 뒤에 파일이 바뀌어 되돌리지 않습니다",
        taken: "원래 자리에 다른 파일이 있어 되돌리지 않습니다",
      }[check.reason]);
    }
    const fromRoot = roots.find((x) => x.key === op.fromRoot);
    const toRoot = roots.find((x) => x.key === op.toRoot);
    const back = path.join(fromRoot.dir, ...op.from.split("/"));
    await moveItem(path.join(toRoot.dir, ...op.to.split("/")), back);
    if (after) await after(op, back);
    // The folder the move left empty goes too, up to the root.
    for (let dir = path.posix.dirname(op.to); dir && dir !== "."; dir = path.posix.dirname(dir)) {
      if (!(await fsp.rmdir(path.join(toRoot.dir, ...dir.split("/"))).then(() => true, () => false))) break;
    }
    await append(r, { undo: want, at: now, by });
    return { id: want, fromRoot: op.fromRoot, from: op.from, toRoot: op.toRoot, to: op.to };
  }
  throw new TrashError("작업 기록에 없는 항목입니다", 404);
}
