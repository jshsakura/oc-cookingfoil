/**
 * Each retro game's content hash (achievements/hash.js romHash: what RetroArch
 * sends to RetroAchievements), worked out in the background after every scan
 * whether or not RetroAchievements is set up. Two servers holding the same dump
 * get the same hash, whatever the file is called or zipped as, so a client that
 * reads several servers can tell one ROM from another.
 *
 * Kept in the index (hashStore scope "retro-rom", by game id) under the file's
 * fileKey: a pass reads only the files whose key moved, one at a time, and
 * forgets the games that left the catalog. A file that can't be read is kept
 * as "" (no hash) until it changes. Requests read the remembered value only.
 */
import fsp from "fs/promises";
import debug from "../debug.js";
import { appDb } from "../db/database.js";
import { hashStore } from "../db/stores.js";
import { fileKey } from "../helpers/hash-cache.js";
import * as activity from "../tasks/activity.js";
import { hashable, romHash } from "./achievements/hash.js";
import { inTurn } from "./disk-turn.js";

// A breath between files, so requests keep their turn while a big library is read.
const PAUSE_MS = 50;

let store = null;
// A pass is reading files, or a queued catalog holds games never hashed yet.
let hashing = false;
let unseen = false;
const hashes = () => (store ??= hashStore(appDb(), "retro-rom"));

async function keyOf(g) {
  try {
    return fileKey(await fsp.stat(g.abs));
  } catch {
    return null;
  }
}

async function compute(g, key) {
  let hash = null;
  try {
    hash = await romHash(g);
  } catch (err) {
    debug.error("retro: hashing %s: %s", g.rel ?? g.abs, err.message);
  }
  hashes().set(g.id, { key, hash: hash ?? "" });
  return hash;
}

/** The hash remembered for a game, or null (not read yet, none for its system, or unreadable). */
export const known = (g) => hashes().get(g.id)?.hash || null;

/** A game's hash now: the remembered one while its file is unchanged, else read and remembered. */
export async function hashOf(g) {
  if (!hashable(g.system, g.abs)) return null;
  const key = await keyOf(g);
  if (!key) return null;
  const hit = hashes().get(g.id);
  return hit?.key === key ? hit.hash || null : compute(g, key);
}

/** Hashes the catalog's new and changed files and forgets the games gone; { hashed }. */
export async function pass(games, { pauseMs = PAUSE_MS } = {}) {
  const ours = games.filter((g) => hashable(g.system, g.abs));
  hashes().prune(new Set(ours.map((g) => g.id)));
  const due = [];
  for (const g of ours) {
    const key = await keyOf(g);
    if (key && hashes().get(g.id)?.key !== key) due.push([g, key]);
  }
  if (!due.length) return { hashed: 0 };
  hashing = true;
  const job = activity.begin("retro-hash", { title: "레트로 게임 파일의 해시를 구합니다", total: due.length });
  try {
    for (const [i, [g, key]] of due.entries()) {
      await compute(g, key);
      job.step(i + 1, g.file);
      if (pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
    }
  } catch (err) {
    job.fail(err);
    throw err;
  } finally {
    hashing = false;
  }
  job.done(`${due.length}개`);
  return { hashed: due.length };
}

/**
 * Whether the hashes of the catalog last queued are still being worked out:
 * a list sent now may change once they are in, so it should not be cached.
 */
export const pending = () => hashing || unseen;

let running = null;
let next = null;
/** A pass over `games`; one at a time, and a catalog that comes in meanwhile is read after it. */
export function queue(games) {
  if (games.some((g) => hashable(g.system, g.abs) && !hashes().get(g.id))) unseen = true;
  if (running) {
    next = games;
    return running;
  }
  running = inTurn(() => pass(games))
    .then((r) => { if (r.hashed) debug.log("retro: %d ROM hashes worked out", r.hashed); })
    .catch((err) => debug.error("retro: ROM hashes: %s", err.message))
    .finally(() => {
      running = null;
      const later = next;
      next = null;
      if (later) queue(later);
      else unseen = false;
    });
  return running;
}
