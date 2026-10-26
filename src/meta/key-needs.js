/**
 * How the library's key generations (content-meta.js keyGeneration, read in
 * the background) compare with the server's keys: per title for the detail,
 * and counted for the admin's keys row. Only what is already in memory is
 * read; a file whose generation is not known yet is counted as unknown.
 */
import * as contentMeta from "./content-meta.js";
import * as libraryCache from "./library-cache.js";
import { firmwareOf } from "./generations.js";

const GAME_KINDS = new Set(["base", "update"]);

/** The generation content-meta has read for a listed file; undefined while unread. */
const storedGeneration = (file) => contentMeta.get(file.titleId, file.version ?? 0)?.keyGeneration;

/** { keyGeneration, keyFirmware } a title's base game and updates in the library need; nulls while unknown. */
export function titleKeyNeed(baseTitleId, files = libraryCache.files(), generationOf = storedGeneration) {
  const gens = files
    .filter((f) => f.baseTitleId === baseTitleId && GAME_KINDS.has(f.kind))
    .map(generationOf)
    .filter(Number.isInteger);
  if (!gens.length) return { keyGeneration: null, keyFirmware: null };
  const keyGeneration = Math.max(...gens);
  return { keyGeneration, keyFirmware: firmwareOf(keyGeneration) };
}

/**
 * { above, version, known, unknown }: games (base titles) with a file that
 * needs a generation above `have`, the prod.keys version that would cover them
 * all (the first firmware of the highest generation they need; null when none
 * is above), and how many game files have a known generation and how many not
 * yet. `have` null (no keys) counts every known game as above.
 */
export function libraryAbove(have, files = libraryCache.files(), generationOf = storedGeneration) {
  const above = new Set();
  let known = 0;
  let unknown = 0;
  let highest = null;
  for (const f of files) {
    const gen = generationOf(f);
    if (!Number.isInteger(gen)) {
      unknown++;
      continue;
    }
    known++;
    if (have !== null && gen <= have) continue;
    above.add(f.baseTitleId ?? f.titleId);
    highest = Math.max(highest ?? 0, gen);
  }
  return { above: above.size, version: firmwareOf(highest), known, unknown };
}
