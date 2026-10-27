/**
 * A retro game's Korean title from the names plugins' dictionary (ko-names.js):
 *
 *   confirmed  the ROM's content hash (rom-index.js) is in the dictionary. Shown
 *              as the game's Korean name without asking; the only kind anything
 *              that decides how a game runs may read.
 *   guess      only the English title matched. Listed for the admin to approve
 *              or reject; an approved one is saved as the admin's own name
 *              (names.js), so it shows like any name the admin gave.
 *
 * A name the admin gave always wins over both.
 */
import { koreanName, koreanNameByTitle } from "./ko-names.js";
import * as retroNames from "./names.js";
import * as romIndex from "./rom-index.js";
import { englishTitle, localTitle } from "./variants.js";

/** { ko, en, by } for a rom-index.js row of a ROM on `system` whose hash is in the dictionary, else null. Pure. */
export function nameOfRow(system, row) {
  if (!row || row.skip) return null;
  for (const v of [row, row.bare].filter(Boolean)) {
    // With a SHA known, a CRC-32 alone (which can collide) does not count.
    const hit = v.sha256 ? koreanName(system, { sha256: v.sha256, sha1: v.sha1 }) : koreanName(system, { crc32: v.crc32 });
    if (hit) return hit;
  }
  return null;
}

/** { ko, en, by } when the game's content hash is in the dictionary, else null. */
export const confirmed = (g) => nameOfRow(g.system, romIndex.known(g));

/**
 * { ko, en, by: "title" } still waiting for the admin, or null: none when the
 * hash already names the game, the file name is Korean, the admin named it in
 * Korean, or the admin turned this guess down.
 */
export function pendingGuess(g) {
  if (localTitle(g.name) || retroNames.get(g.id)?.ko || retroNames.guessRejected(g.id) || confirmed(g)) return null;
  return koreanNameByTitle(g.system, englishTitle(g.name, g.names));
}

/** The admin keeps the guess: it becomes the game's Korean name. False when there is none to keep. */
export function approve(g) {
  const guess = pendingGuess(g);
  if (!guess) return false;
  return retroNames.set(g.id, { ...retroNames.get(g.id), ko: guess.ko });
}

/** The admin turns the guess down; it is not suggested again. False when there is none to turn down. */
export const reject = (g) => Boolean(pendingGuess(g)) && retroNames.rejectGuess(g.id);
