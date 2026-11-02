/**
 * 정리: the drop box's rules (meta/library-organize.js) run on files already in the games folder, after a preview.
 * The picked files and folders are planned as if they had just come in, against the rest of the library:
 * one folder per base game, update/ and DLC/ under it, each file named `<name> [TITLEID][vN].ext`.
 *
 *   plan(rels, lang)          { moves: [{ from, to, titleId, kind, version }], held: [{ rel, code, reason }], unchanged }
 *   apply(rels, accepted, by) { moved: [{ from, to, undo }], skipped: [{ from, code }] }
 *
 * A game whose picked files sit in one folder of their own keeps that folder and its name; the operator named
 * it. apply() plans again and carries out only the moves the preview showed that still stand, so a file changed
 * since is left alone. Nothing is overwritten, every move is journaled for undo, and a folder left empty is removed
 * (an undo makes it again).
 */
import fsp from "fs/promises";
import path from "path";
import { GAME_RE, REASON_TEXT, isIncoming, planOrganize } from "../meta/library-organize.js";
import { identityFromName } from "../meta/file-identity.js";
import { moveAcross, withLocks } from "./safe-move.js";

const same = (s) => s.normalize("NFC").toLowerCase();
const topOf = (rel) => (rel.includes("/") ? rel.split("/")[0] : null);

/** base id → the one folder of its own its picked files sit in, for games whose files are not spread or shared. Pure. */
export function keptFolders(items, restRels) {
  const tops = new Map();
  const bases = new Map();
  const note = (top, base) => {
    if (!top || !base) return;
    (bases.get(same(top)) ?? bases.set(same(top), new Set()).get(same(top))).add(base);
  };
  for (const f of items) {
    const base = f.id?.baseTitleId;
    if (!base) continue;
    const top = topOf(f.rel);
    if (top) (tops.get(base) ?? tops.set(base, new Set()).get(base)).add(top);
    note(top, base);
  }
  for (const rel of restRels) note(topOf(rel), identityFromName(rel)?.baseTitleId);
  const out = new Map();
  for (const [base, set] of tops) {
    if (set.size !== 1) continue;
    const [top] = set;
    if (bases.get(same(top))?.size === 1) out.set(base, top);
  }
  return out;
}

/**
 * The previewed moves inside one folder, each journaled for undo; a move whose place was taken meanwhile is skipped.
 * A folder a move leaves empty is removed, up to the top, except where keep(rel) says it stays.
 */
export async function carryOut({ root: r, moves, journal, by = null, keep = () => false }) {
  const moved = [];
  const skipped = [];
  for (const m of moves) {
    const from = path.join(r.dir, ...m.from.split("/"));
    const to = path.join(r.dir, ...m.to.split("/"));
    const placed = await withLocks([r.dir], async () => {
      await fsp.mkdir(path.dirname(to), { recursive: true });
      return moveAcross(from, to);
    }).catch(() => false);
    if (!placed) {
      skipped.push({ from: m.from, code: "exists" });
      continue;
    }
    const line = await journal({ action: "move", by, fromRoot: r, from: m.from, toRoot: r, to: m.to, ...(m.extra ? { extra: m.extra } : {}) });
    moved.push({ from: m.from, to: m.to, undo: line?.id ?? null });
    for (let d = path.posix.dirname(m.from); d && d !== "." && !keep(d); d = path.posix.dirname(d)) {
      if (!(await fsp.rmdir(path.join(r.dir, ...d.split("/"))).then(() => true, () => false))) break;
    }
  }
  return { moved, skipped };
}

export function createTidy({ root, collect, identify, romsRels, adminName, titledbName, journal, rescan = () => {} }) {
  async function picks(rels) {
    const { dir } = root();
    const out = [];
    for (const e of await collect(rels)) {
      if (e.dir) continue;
      const rel = path.relative(dir, e.real).split(path.sep).join("/");
      if (!rel || rel.startsWith("..") || isIncoming(rel) || !GAME_RE.test(rel)) continue;
      const read = await identify({ abs: e.real, rel, size: e.size, mtimeMs: e.mtime.getTime() });
      out.push({ rel, mtimeMs: 0, id: read.id, source: read.source });
    }
    return out;
  }

  async function plan(rels, lang = "en") {
    const items = await picks(rels);
    const picked = new Set(items.map((f) => same(f.rel)));
    const rest = (await romsRels()).filter((r) => !picked.has(same(r)));
    const out = planOrganize({ incoming: items, romsRels: rest, adminName, titledbName, settleMs: 0, keepFolders: keptFolders(items, rest) });
    const words = REASON_TEXT[lang] ?? REASON_TEXT.en;
    const moves = out.moves.filter((m) => same(m.from) !== same(m.to))
      .map(({ from, to, titleId, kind, version }) => ({ from, to, titleId, kind, version }));
    return {
      moves,
      held: out.held.map((h) => ({ rel: h.rel, code: h.code, reason: words[h.code] ?? h.reason })),
      unchanged: out.moves.length - moves.length,
    };
  }

  async function apply(rels, accepted, { by = null } = {}) {
    const ok = new Set((accepted ?? []).map((m) => `${m.from}\0${m.to}`));
    const out = await carryOut({ root: root(), moves: (await plan(rels)).moves.filter((m) => ok.has(`${m.from}\0${m.to}`)), journal, by });
    if (out.moved.length) rescan();
    return out;
  }

  return { plan, apply };
}
