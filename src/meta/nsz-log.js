/**
 * The conversion log of the NSZ queue (nsz-queue.js): one JSON line per
 * finished event in ${COOK_DATA_DIR}/nsz-log.jsonl, kept after the queue's
 * rows are cleared.
 *
 *   { at, id, rel, name, from, to, sizeBefore, sizeAfter, event, reason? }
 *   event: converted | original-deleted | failed
 *   (lines from older versions may also say restored)
 *
 * Appended as events happen; past `max` lines, or once an hour when the oldest
 * line is past `keepMs` (the admin's 기록 보관 기간), the file is written again
 * with what is left (to a temporary file, then renamed). Reads skip expired lines.
 */
import fs from "fs";
import path from "path";
import debug from "../debug.js";

const PAGE_MAX = 100;

const PRUNE_EVERY_MS = 60 * 60 * 1000;

export function createNszLog(file, { max = 5000, keepMs = () => Infinity, now = Date.now } = {}) {
  let count = null;
  let prunedAt = 0;
  const fresh = (line, cutoff) => {
    try { return JSON.parse(line).at >= cutoff; } catch { return false; }
  };

  function readLines() {
    try {
      return fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
    } catch {
      return [];
    }
  }

  function append(entry) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      count ??= readLines().length;
      fs.appendFileSync(file, `${JSON.stringify({ at: now(), ...entry })}\n`);
      const due = now() - prunedAt >= PRUNE_EVERY_MS;
      if (++count <= max && !due) return;
      prunedAt = now();
      const cutoff = now() - keepMs();
      const lines = readLines();
      const keep = lines.filter((l) => fresh(l, cutoff)).slice(-max);
      if (keep.length === lines.length) return;
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, `${keep.join("\n")}\n`);
      fs.renameSync(tmp, file);
      count = keep.length;
    } catch (err) {
      debug.error("nsz: log not written: %s", err.message);
    }
  }

  /** One page, newest first; `q` matches the file path or the name, any case. */
  function page({ offset = 0, limit = 50, q = "" } = {}) {
    const needle = String(q ?? "").trim().toLowerCase();
    const cutoff = now() - keepMs();
    const rows = [];
    for (const line of readLines().reverse()) {
      let e;
      try { e = JSON.parse(line); } catch { continue; }
      if (!(e.at >= cutoff)) continue;
      if (needle && !`${e.rel ?? ""}\n${e.name ?? ""}`.toLowerCase().includes(needle)) continue;
      rows.push(e);
    }
    const off = Math.max(0, Math.floor(Number(offset) || 0));
    const lim = Math.min(PAGE_MAX, Math.max(1, Math.floor(Number(limit) || 50)));
    return { items: rows.slice(off, off + lim), total: rows.length, offset: off, limit: lim };
  }

  return { append, page, file };
}
