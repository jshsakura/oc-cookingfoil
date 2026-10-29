/**
 * The retro index (/api/retro/index) as versions a client can sync from.
 *
 * A snapshot is the list ordered by id with a short hash per item; its version
 * names the whole list. A client pages through a version once, then asks with
 * ?since=<version> and gets only the items added or changed and the ids gone.
 * The last HISTORY versions per language are remembered (hashes only, no
 * bodies); a client further behind, or after a restart, is told to start over.
 */
import crypto from "crypto";

const HISTORY = 16;

const shortHash = (s, n) => crypto.createHash("sha1").update(s).digest("hex").slice(0, n);

/** The list `games` (each with an id) ordered by id, each item's hash, and the list's version. Pure. */
export function snapshot(games) {
  const sorted = [...games].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const hashes = new Map(sorted.map((g) => [g.id, shortHash(JSON.stringify(g), 12)]));
  const version = shortHash([...hashes].map(([id, h]) => `${id}:${h}`).join("\n"), 16);
  return { games: sorted, hashes, version };
}

/** What changed from `older` (id → hash) to `newer`: the items added or changed and the ids gone. Pure. */
export function delta(older, newer) {
  const changed = newer.games.filter((g) => older.get(g.id) !== newer.hashes.get(g.id));
  const removed = [...older.keys()].filter((id) => !newer.hashes.has(id));
  return { changed, removed };
}

/**
 * Snapshots per key (a language). One is rebuilt at once when `source` (the catalog object) changes,
 * and otherwise when `stamp()` (what else the items show) moved, at most once per `freshMs`. With
 * neither, it is still rebuilt after `maxAgeMs`, for what no stamp covers (box art replaced by hand).
 * `build(source, key)` returns the items.
 */
export function createIndexCache(build, { stamp = () => null, freshMs = 3000, maxAgeMs = 60_000, history = HISTORY } = {}) {
  const current = new Map(); // key → { source, stamp, at, snap, pages: Map }
  const past = new Map(); // key → Map(version → hashes), oldest first

  function get(source, key, now = Date.now()) {
    const hit = current.get(key);
    if (hit && hit.source === source) {
      const age = now - hit.at;
      if (age < freshMs) return hit;
      if (age < maxAgeMs && hit.stamp === stamp()) return hit;
    }
    // Read before the build, so a change that lands while it runs moves the stamp past it.
    const at = stamp();
    const snap = snapshot(build(source, key));
    // Unchanged: keep the pages (and their gzip) already made.
    const entry = hit?.snap.version === snap.version ? { ...hit, source, stamp: at, at: now } : { source, stamp: at, at: now, snap, pages: new Map() };
    current.set(key, entry);
    const versions = past.get(key) ?? new Map();
    if (!versions.has(snap.version)) {
      versions.set(snap.version, snap.hashes);
      if (versions.size > history) versions.delete(versions.keys().next().value);
    }
    past.set(key, versions);
    return entry;
  }

  /** The hashes of `version` under `key`, or null when it is not remembered. */
  const hashesOf = (key, version) => past.get(key)?.get(version) ?? null;

  return { get, hashesOf };
}
