/**
 * The conversion log of the NSZ queue (nsz-queue.js): one JSON line per
 * finished event in ${COOK_DATA_DIR}/nsz-log.jsonl, kept after the queue's
 * rows are cleared.
 *
 *   { at, id, rel, name, from, to, sizeBefore, sizeAfter, event, reason? }
 *   event: converted | original-deleted | restored | failed
 *
 * Appended as events happen; past `max` lines the file is written again with
 * the newest `max` (to a temporary file, then renamed).
 */
import fs from "fs";
import path from "path";
import debug from "../debug.js";

const PAGE_MAX = 100;

export function createNszLog(file, { max = 5000 } = {}) {
  let count = null;

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
      fs.appendFileSync(file, `${JSON.stringify({ at: Date.now(), ...entry })}\n`);
      if (++count <= max) return;
      const keep = readLines().slice(-max);
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
    const rows = [];
    for (const line of readLines().reverse()) {
      let e;
      try { e = JSON.parse(line); } catch { continue; }
      if (needle && !`${e.rel ?? ""}\n${e.name ?? ""}`.toLowerCase().includes(needle)) continue;
      rows.push(e);
    }
    const off = Math.max(0, Math.floor(Number(offset) || 0));
    const lim = Math.min(PAGE_MAX, Math.max(1, Math.floor(Number(limit) || 50)));
    return { items: rows.slice(off, off + lim), total: rows.length, offset: off, limit: lim };
  }

  return { append, page, file };
}
