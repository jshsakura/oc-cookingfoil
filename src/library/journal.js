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
 * lines it is rewritten without the oldest ones. A move that is held (undone
 * and not released) is kept with its undo line however old it is: the hold
 * lives in those lines, and dropping them would let the drop box sort the file
 * again behind the admin's back.
 *
 * The undo line is written as soon as the file is back, before anything else
 * the undo does (`after`), so a failure or a stop after the move never leaves
 * the file back without its hold.
 */
import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { TRASH_DIR, cleanRel, isProtectedRel, measure, trashError } from "./trash.js";
import { trashText } from "./trash-messages.js";
import { moveAcross, realInside, sweepPartials, withLocks } from "./safe-move.js";

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

/** The ids of moves undone and not released in `lines`: the holds. Pure. */
function heldIds(lines) {
  const released = new Set(lines.filter((l) => l.release).map((l) => l.release));
  return new Set(lines.filter((l) => l.undo && !released.has(l.undo)).map((l) => l.undo));
}

/** Keeps the newest JOURNAL_KEEP moves and every held one, with their undo and release lines, once the file is past the slack. */
async function trim(root) {
  const file0 = journalOf(root);
  const count = (appended.get(file0) ?? 0) + 1;
  appended.set(file0, count);
  if (count % TRIM_EVERY !== 1) return;
  const lines = readLines(root);
  if (lines.length <= JOURNAL_KEEP + JOURNAL_SLACK) return;
  const ops = lines.filter((l) => l.id);
  const keep = new Set([...ops.slice(-JOURNAL_KEEP).map((l) => l.id), ...heldIds(lines)]);
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

/**
 * Moves across every root, newest first, at most `limit`: { items: [{ ...line,
 * undone, released, held, undoable, reason }], total, held }. `held` lists every
 * move whose file the drop box must leave where it is (undone into it and not
 * released), whatever its age, so its release is always reachable.
 */
export async function listJournal(roots, { limit = 200 } = {}) {
  const ops = [];
  for (const r of roots) {
    const lines = readLines(r);
    const undone = new Map(lines.filter((l) => l.undo).map((l) => [l.undo, l]));
    const released = new Map(lines.filter((l) => l.release).map((l) => [l.release, l]));
    for (const l of lines) {
      if (!ID_RE.test(l.id ?? "") || !l.from || !l.to) continue;
      const u = undone.get(l.id) ?? null;
      const rel = released.get(l.id) ?? null;
      ops.push({ ...l, journal: r.key, undone: u, released: rel, held: Boolean(u && !rel && u.back?.root === "incoming") });
    }
  }
  ops.sort((a, b) => b.at - a.at);
  const page = ops.slice(0, limit);
  for (const op of page) Object.assign(op, op.undone ? { undoable: false, reason: "undone" } : await undoable(op, roots).then(({ ok, reason }) => ({ undoable: ok, reason })));
  const held = ops.filter((o) => o.held).map((o) => ({ ...o, undoable: false, reason: "undone" }));
  return { items: page, total: ops.length, held };
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

/**
 * Undoes one move ("<journal root>:<id>" or an id). `after(op, abs)` runs once
 * the item is back at `abs`, for what a move changed besides the place (a
 * patch's own title id paths). Returns { from, to } as moved back.
 */
export async function undoMove(roots, id, { by = null, now = Date.now(), after = null, lang = "ko" } = {}) {
  const first = findOp(roots, id);
  if (!first) throw trashError("noOp", 404);
  const fromRoot = roots.find((x) => x.key === first.op.fromRoot);
  const toRoot = roots.find((x) => x.key === first.op.toRoot);
  const locks = [first.root.dir, fromRoot?.dir, toRoot?.dir].filter(Boolean);
  return withLocks(locks, async () => {
    // Read again under the locks: a second undo of the same move waits for the first and then sees its line.
    const again = findOp(roots, id);
    if (!again) throw trashError("noOp", 404);
    const { root: r, lines, op, want } = again;
    if (lines.some((l) => l.undo === want)) throw trashError("alreadyUndone");
    if (isProtectedRel(op.fromRoot, op.from) || isProtectedRel(op.toRoot, op.to)) throw trashError("bad-path", 400);
    const check = await undoable(op, roots);
    if (!check.ok) throw trashError(check.reason);
    const back = path.join(fromRoot.dir, ...op.from.split("/"));
    if (!(await realInside(fromRoot.dir, back))) throw trashError("bad-path");
    await sweepPartials([path.dirname(back)]).catch(() => {});
    const st = await measure(path.join(toRoot.dir, ...op.to.split("/")));
    if (!(await moveAcross(path.join(toRoot.dir, ...op.to.split("/")), back))) throw trashError("taken");
    // What came back, written first, so the drop box can tell it is the same file it must leave alone.
    await withLocks([journalOf(r)], () => append(r, { undo: want, at: now, by, back: { root: op.fromRoot, rel: op.from, size: st.size, mtimeMs: st.mtimeMs, type: st.type } }));
    // The file is back and held; what else the move changed is put back after, and a failure there is reported, not undone.
    let warning = null;
    if (after) {
      try {
        await after(op, back);
      } catch (err) {
        warning = trashText(lang, "undoPartial", { why: err.message });
      }
    }
    // The folder the move left empty goes too, up to the root.
    for (let dir = path.posix.dirname(op.to); dir && dir !== "."; dir = path.posix.dirname(dir)) {
      if (!(await fsp.rmdir(path.join(toRoot.dir, ...dir.split("/"))).then(() => true, () => false))) break;
    }
    return { id: want, action: op.action, fromRoot: op.fromRoot, from: op.from, toRoot: op.toRoot, to: op.to, ...(warning ? { warning } : {}) };
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
  if (!found) throw trashError("noOp", 404);
  const { root: r, lines, want } = found;
  if (!lines.some((l) => l.undo === want)) throw trashError("notUndone");
  if (lines.some((l) => l.release === want)) return { id: want, released: false };
  await withLocks([journalOf(r)], () => append(r, { release: want, at: now, by }));
  return { id: want, released: true };
}
