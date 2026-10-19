/**
 * What the server knows about RetroAchievements, kept in <data dir>/retro-achievements.json:
 *
 *   { version, lists: { "<console id>": { at, triedAt, games: [{ id, title, count, points, icon, hashes }] } },
 *              roms:  { "<catalog game id>": { stamp, hash, ra: { id, by } | null, listAt } } }
 *
 * A console's list is the games that have achievements, read again weekly. A
 * ROM is hashed once per file (`stamp` is its size and mtime) and matched
 * again whenever its console's list is newer than the match (`listAt`).
 * Requests read the copy in memory only.
 */
import fs from "fs";
import path from "path";
import debug from "../../debug.js";

const VERSION = 1;
let file = null;
let state = { lists: {}, roms: {} };
let byId = null; // Map(ra game id → list entry), rebuilt when a list changes

export function load(dataDir) {
  file = path.join(dataDir, "retro-achievements.json");
  try {
    const stored = JSON.parse(fs.readFileSync(file, "utf8"));
    state = stored?.version === VERSION ? { lists: stored.lists ?? {}, roms: stored.roms ?? {} } : { lists: {}, roms: {} };
  } catch (err) {
    if (err.code !== "ENOENT") debug.error("retro achievements: cannot read %s: %s", file, err.message);
    state = { lists: {}, roms: {} };
  }
  byId = null;
  return Object.keys(state.roms).length;
}

export function save() {
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify({ version: VERSION, ...state }));
    fs.renameSync(`${file}.tmp`, file);
  } catch (err) {
    debug.error("retro achievements: cannot save %s: %s", file, err.message);
  }
}

/** A console's list record ({ at, triedAt, games }), or null. */
export const list = (consoleId) => state.lists[consoleId] ?? null;

export function setList(consoleId, record) {
  state.lists[consoleId] = record;
  byId = null;
}

/** A catalog game's record, or null. */
export const rom = (gameId) => state.roms[gameId] ?? null;

export function setRom(gameId, record) {
  state.roms[gameId] = record;
}

/** Forgets the ROMs no longer in the catalog; how many went. */
export function keepRoms(ids) {
  let dropped = 0;
  for (const id of Object.keys(state.roms)) if (!ids.has(id)) { delete state.roms[id]; dropped++; }
  return dropped;
}

/** The list entry of a RetroAchievements game id, or null. */
export function game(raId) {
  byId ??= new Map(Object.values(state.lists).flatMap((l) => l.games ?? []).map((g) => [g.id, g]));
  return byId.get(raId) ?? null;
}

/** For tests: everything in memory only. */
export function reset(next = { lists: {}, roms: {} }) {
  file = null;
  state = next;
  byId = null;
}
