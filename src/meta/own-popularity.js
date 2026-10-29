/**
 * The server's own popularity order: how many different consoles (or accounts, or addresses) finished
 * downloading a game in the last POPULAR_DAYS days. It fills the rank of the games no metadata plugin
 * ranked, after the ones a plugin did, so a client sorts by the one number item.rank.
 *
 * transfer-log.js tells recordCompleted about every transfer that covered the whole file; the table
 * title_downloads (cookingfoil.db) keeps one row per base title and requester, with when they last finished.
 * A requester is the console's first eight key characters, an account name or an address, as the
 * download records already hold them; no full key is kept here.
 */
import { appDb } from "../db/database.js";
import { baseTitleIdOf } from "./image-cache.js";

export const POPULAR_DAYS = 90;
// Rows older than this are dropped when a new one is written.
const KEEP_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;
const TITLE_ID_RE = /\[([0-9A-Fa-f]{16})\]/;

/** The base title of a game file path, or null when its name carries no title id. Pure. */
export function baseOfPath(filePath) {
  const m = TITLE_ID_RE.exec(String(filePath ?? ""));
  return m ? baseTitleIdOf(m[1].toUpperCase()) : null;
}

/** Notes a finished transfer record (transfer-log.js); only one that covered the whole file counts. */
export function recordCompleted(rec, { db = appDb(), now = Date.now } = {}) {
  if (!rec?.complete || !rec.who?.id) return false;
  const title = baseOfPath(rec.file?.path);
  if (!title) return false;
  const at = Number.isFinite(rec.endedAt) ? rec.endedAt : now();
  db.prepare("INSERT INTO title_downloads (title_id, who, at) VALUES (?, ?, ?) ON CONFLICT (title_id, who) DO UPDATE SET at = MAX(at, excluded.at)")
    .run(title, `${rec.who.kind}:${rec.who.id}`, at);
  db.prepare("DELETE FROM title_downloads WHERE at < ?").run(now() - KEEP_DAYS * DAY_MS);
  return true;
}

/** Map of base title id → how many requesters finished it within `days`. */
export function completedCounts({ db = appDb(), now = Date.now, days = POPULAR_DAYS } = {}) {
  const rows = db.prepare("SELECT title_id, COUNT(*) AS n FROM title_downloads WHERE at >= ? GROUP BY title_id").all(now() - days * DAY_MS);
  return new Map(rows.map((r) => [r.title_id, r.n]));
}

/**
 * Gives every base item without a rank one, after the highest rank already taken: more finished downloads
 * first, then the newer release, then the title id. Items of one title share a rank. Changes the items. Pure.
 */
export function fillRanks(items, counts) {
  const bases = items.filter((i) => i.app_type === "base" && i.title_id);
  let last = bases.reduce((m, i) => Math.max(m, i.rank ?? 0), 0);
  const open = new Map();
  for (const i of bases) if (!i.rank && !open.has(i.title_id)) open.set(i.title_id, i);
  const order = [...open.values()].sort((a, b) =>
    (counts.get(b.title_id) ?? 0) - (counts.get(a.title_id) ?? 0)
    || (b.release_date ?? 0) - (a.release_date ?? 0)
    || (a.title_id < b.title_id ? -1 : 1));
  const rankOf = new Map(order.map((i) => [i.title_id, ++last]));
  for (const i of bases) if (!i.rank) i.rank = rankOf.get(i.title_id);
  return items;
}
