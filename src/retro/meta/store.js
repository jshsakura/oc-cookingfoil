/**
 * The retro game details collected ahead of time, kept in <data dir>/retro-meta.json:
 *
 *   { version, builtAt, games: { "<system>/<ROM name>": record } }   (record: fields.js)
 *
 * Loaded once at startup and replaced as a whole after a refresh; requests
 * only ever read the copy in memory, so a detail never waits on the network
 * or the disk for it. Written to a temporary file and renamed over the old one.
 */
import fs from "fs";
import path from "path";
import debug from "../../debug.js";

// 2: LaunchBox records carry `wiki` (fields.js). 3: they carry cooperative,
// esrb, styles, simultaneous, arcadeStyle and series. An older file is kept and
// served, but counts as never matched, so the first tick matches it again.
const VERSION = 3;
let file = null;
let state = { builtAt: 0, games: {} };

export function load(dataDir) {
  file = path.join(dataDir, "retro-meta.json");
  try {
    const stored = JSON.parse(fs.readFileSync(file, "utf8"));
    const known = stored?.games && Number.isInteger(stored.version) && stored.version >= 1 && stored.version <= VERSION;
    state = known ? { builtAt: stored.version === VERSION ? Number(stored.builtAt) || 0 : 0, games: stored.games } : { builtAt: 0, games: {} };
  } catch (err) {
    if (err.code !== "ENOENT") debug.error("retro meta: cannot read %s: %s", file, err.message);
    state = { builtAt: 0, games: {} };
  }
  return Object.keys(state.games).length;
}

/** The record filed under a key, or null. */
export const get = (key) => state.games[key] ?? null;

/** Every record, keyed. */
export const all = () => state.games;

/** When LaunchBox's data was last matched (0: never). */
export const builtAt = () => state.builtAt;

/** Replaces the records (and, with `built`, the LaunchBox date) and saves them. */
export function replace(games, built = state.builtAt) {
  state = { builtAt: built, games };
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify({ version: VERSION, builtAt: built, games }));
    fs.renameSync(`${file}.tmp`, file);
  } catch (err) {
    debug.error("retro meta: cannot save %s: %s", file, err.message);
  }
}

/** For tests: records in memory only. */
export function reset(games = {}, built = 0) {
  file = null;
  state = { builtAt: built, games };
}
